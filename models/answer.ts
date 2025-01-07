import { createHash } from 'node:crypto'
import { data } from '@ampt/data'
import { splitEvery } from 'ramda'

import { answerQuestionBatch } from '@gemini'
import {
  CustomerType,
  Questionnaire,
  QuestionnaireType
} from '@models/questionnaire'

export interface AnswerRow {
  id: string
  question: string
  answer: string
  approved: boolean | undefined
  // This is optional so we can hydrate previous questionnaire answers
  questionnaireId: string | undefined
}

enum AnswerQueryMap {
  QuestionnaireId = 'label1'
}

export class Answer {
  static prefix = 'answer'
  static label = 'questionnaire'

  id: string
  questionnaireId: string | undefined
  question: string
  answer: string
  approved: boolean | undefined

  static hash(question: string) {
    return createHash('sha256').update(question).digest('hex').slice(0, 12)
  }

  constructor(params: AnswerRow) {
    this.id = params.id
    this.questionnaireId = params.questionnaireId
    this.question = params.question
    this.answer = params.answer
    this.approved = params.approved
  }

  static async create(params: AnswerRow) {
    const answer = new Answer(params)
    await answer.save()
    return answer
  }

  static async batchCreate(params: {
    questionnaireId?: string
    answers: { [question: string]: string }
  }) {
    const { questionnaireId, answers } = params
    // data.set is limited to 25 keys at a time, so we need to split the array into chunks of 25
    const keyValuePairs = splitEvery(
      25,
      Object.entries(answers).map(([_question, _answer]) => {
        const question = _question.trim()
        const answer = _answer.trim()
        const questionId = Answer.hash(question)
        return {
          key: `${Answer.prefix}:${questionId}`,
          value: {
            questionnaireId,
            question,
            answer,
            id: questionId,
            approved: undefined
          },
          ...(questionnaireId
            ? {
                [AnswerQueryMap.QuestionnaireId]: `${Answer.label}:${questionnaireId}:${questionId}`
              }
            : {})
        }
      })
    )

    await Promise.all(
      keyValuePairs.map(
        (pair: { key: string; value: AnswerRow; label1?: string }[]) =>
          data.set(pair)
      )
    )

    console.info(`Saved ${Object.keys(answers).length} answers`)
  }

  static async getByQuestionHash(questionHash: string) {
    const answer = await data.get<AnswerRow>(`${Answer.prefix}:${questionHash}`)
    return answer ? new Answer(answer) : null
  }

  static async listByQuestionnaireId(id: string) {
    const { items } = await data.getByLabel<AnswerRow>(
      AnswerQueryMap.QuestionnaireId,
      `${Answer.label}:${id}:*`
    )
    return items.map((answer) => new Answer(answer.value))
  }

  static async getByQuestionnaireIdAndHash(
    questionnaireId: string,
    questionHash: string
  ) {
    const { items } = await data.getByLabel<AnswerRow>(
      AnswerQueryMap.QuestionnaireId,
      `${Answer.label}:${questionnaireId}:${questionHash}`
    )

    if (items.length > 1) {
      throw new Error('Multiple answers found for questionnaire and question')
    }

    if (items.length === 1) {
      return new Answer(items[0].value)
    }

    return null
  }

  static async approveForQuestionnaire(questionnaireId: string) {
    const answers = await Answer.listByQuestionnaireId(questionnaireId)
    await Promise.all(
      answers.map((answer) => answer.update({ approved: true }))
    )
  }

  static fromRow(row: AnswerRow) {
    return new Answer(row)
  }

  async update(params: { approved?: boolean; answer?: string }) {
    const { approved, answer } = params

    if (approved !== this.approved) {
      this.approved = approved
    }

    if (answer) {
      this.answer = answer.trim()
    }

    await this.save({ overwrite: true, meta: true })
  }

  async reprocess() {
    let type: QuestionnaireType = QuestionnaireType.OTHER
    let customerType: CustomerType | undefined = CustomerType.OTHER

    if (this.questionnaireId) {
      const questionnaire = await Questionnaire.get(this.questionnaireId)
      if (questionnaire) {
        type = questionnaire.type
        customerType = questionnaire.customerType
      }
    }

    const newAnswer = await answerQuestionBatch({
      questions: [this.question],
      type,
      customerType
    })

    if (
      newAnswer &&
      Object.keys(newAnswer).length &&
      newAnswer[this.question]
    ) {
      await this.update({
        answer: newAnswer[this.question]
      })
    } else {
      console.error('Something Went Wron Re-Processing', {
        questionnaireId: this.questionnaireId,
        question: this.question,
        newAnswer
      })
      throw new Error('Something went wrong re-processing')
    }
  }

  toJson() {
    return {
      id: this.id,
      questionnaireId: this.questionnaireId,
      question: this.question,
      answer: this.answer,
      approved: this.approved
    }
  }

  async delete() {
    await data.remove(`${Answer.prefix}:${this.id}`)
  }

  async save(params?: { overwrite: boolean; meta: boolean }) {
    const { overwrite = false, meta = true } = params || {}
    const options = {
      overwrite, // if set to true, overwrite the item if it already exists
      meta // if set to true, return the item
    }

    await data.set<AnswerRow>(
      `${Answer.prefix}:${this.id}`,
      this.toJson(),
      // Set an Index so we can query by Questionnare ID, if it set
      this.questionnaireId
        ? {
            ...options,
            [AnswerQueryMap.QuestionnaireId]: `${Answer.label}:${this.questionnaireId}:${this.id}`
          }
        : options
    )
  }
}
