import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { params } from '@ampt/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import type { Request, Response } from 'express'

import { type CustomerType, QuestionnaireType } from '@models'
import { getSimilarAnswers } from '@vector-search'

const genAI = new GoogleGenerativeAI(params('GEMINI_API_KEY'))
export const gemini = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
const tunedModel = genAI.getGenerativeModel({
  model: 'tunedModels/trainingcsv1-ih2fyjh9ms5l'
})

export interface AnalyseDataRequest extends Request {
  body: {
    text: string
  }
}

const cleanQuestion = (question: string) =>
  question.trim().replace(/^[?|!|.]/, '')

export const extractQuestions = async (text: string) => {
  try {
    const result = await gemini.generateContent([
      `${text}. Extract only the questions in a JSON format as an array of strings. Not all questions ended with a question mark. Each question should be an element in the array. Keep the questions in the same order from the text. Return only the JSON data`
    ])
    const resultText = result.response.text()
    const questions = JSON.parse(resultText.replace(/```(json)?/g, ''))
    return questions
  } catch (error) {
    console.error('Error extracting questions:', error)
    return null
  }
}

export const answerQuestionBatch = async (params: {
  questions: string[]
  type: QuestionnaireType
  customerType: CustomerType
}) => {
  const { questions, type, customerType } = params
  const [info, policies, methodology, _previousAnswers] = await Promise.all([
    readFile(path.join('system-prompt-files', 'info.txt'), 'utf-8'),
    readFile(path.join('system-prompt-files', 'policies.txt'), 'utf-8'),
    readFile(path.join('system-prompt-files', 'methodology.txt'), 'utf-8'),
    getSimilarAnswers(questions)
  ])

  const previousAnswers: string[] = (_previousAnswers ?? []).reduce(
    (acc, curr) => {
      if (curr.neighbors.length) {
        acc.push(`${cleanQuestion(curr.question)}\n${curr.neighbors[0].answer}`)
      }
      return acc
    },
    [] as string[]
  )

  const contents = questions.map((q) => ({
    role: 'user',
    parts: [
      {
        text: cleanQuestion(q)
      }
    ]
  }))

  const result = await gemini.generateContent({
    systemInstruction: `
      You are an expert at answering RFI and security questions for Scope3. 
      IMPORTANT: You must ONLY return a valid JSON object with no additional text or markdown formatting. The JSON object must use the question as key and answer as the value. Answer to the best of your ability. Keep answers concise and to the point.
      Like this:
      {
        'This is the provided Question': 'This is the answer to the question'
      }
      For multi-line answers, join them with a newline, the JSON should not be nested!
      Note that these questions are all regarding Scope3, and may not always be phrased as a question.
      ${
        // Only add this instruction if the questionnaire type is not OTHER
        type !== QuestionnaireType.OTHER
          ? `This is a ${type} questionnaire for a potential ${customerType} customer. Use this information to better answer the questions.`
          : ''
      }

      ${
        previousAnswers.length
          ? `Here are some previous answers to similar questions:
      ${previousAnswers.join('\n')}
      \n`
          : ''
      }
      Here is some context:
      ${info}
      \n
      ${policies}
      \n
      ${methodology}
      `,
    contents
  })
  const resultText = result.response.text()
  console.log({ resultText })
  const questionAnswers = resultText.replace(/```(json)?/g, '')
  const parsed = JSON.parse(questionAnswers)
  return parsed
}

export const analyseData = async (req: AnalyseDataRequest, res: Response) => {
  try {
    const data = req.body.text
    console.log('\nraw input data:', data)

    // Send the prompt with the JSON data to the model
    const result = await gemini.generateContent([
      `${data}. Extract only the questions in a JSON format as an array of strings. Return only the JSON data`
    ])

    const resultText = result.response.text()

    const questions = JSON.parse(resultText.replace(/```(json)?/g, ''))

    console.log('\nextracted questions:', questions)

    return answerQuestions(questions, res)
  } catch (error) {
    console.error('Error extracting questions:', error)

    return res.status(500).send({ questions: null, error })
  }
}

export const answerQuestions = async (questions: object, res: Response) => {
  try {
    const prompt =
      'Answer the following questions. Include questions exactly as provided. In the response, return only JSON data where each question is an object with question and answer.'

    const modelInput = `${prompt} The questions are:\n\n${JSON.stringify(
      questions
    )}`

    console.log('\n\nmodelInput\n', modelInput)

    const result = await tunedModel.generateContent(modelInput)

    const resultText = result.response.text()
    console.log('\n tuned model result text:', resultText)
    const questionAnswers = JSON.parse(resultText.replace(/```(json)?/g, ''))
    console.log('\ntuned model response:', questionAnswers)

    return res.status(200).send({ questions: questionAnswers, error: null })
  } catch (error) {
    console.error('Error answering questions:', error)
    return res.status(500).send({ questions: null, error })
  }
}
