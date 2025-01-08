<p align="center">
    <div width="100%" align="center">
        <h1>RFI Questionnaire Autocompletion</h1>
    </div>
</p>

## Stack

For means of speed, this project is built on top of the Ampt platform, which runs in isolated AWS accounts on Lambda (Cloud Functions).
The primary data store is DynamoDB, using the `data` package for data operations.
Most of the processing is heavily event-driven, for batching and performance.
The main API is built on top of Express, and is located in the `index.ts` file.

## How it works

Users in the admin UI create questionnaires, from there, we ingest this data into the `questionnaire` table.

Upon creation of a new questionnaire, we ask Gemini to extract the questions from the text:
```js
// gemini.ts Line 22
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
```

Once the questions are extracted, we create "answers" for each question, and set the questionnaire to `PROCESSING` state. Initially, these answers are empty, but as they get saved, we populate them with the answers from Gemini.

```js
  // models/answer.ts Line 72
  static async onCreated(event: { item: { value: AnswerRow } }) {
    const item = event.item.value
    const answer = Answer.fromRow(item as AnswerRow)
    await answer.publishAnswerEvent()

    // update the questionnaire state to ANSWERING if it is processing
    if (answer.questionnaireId) {
      const questionnaire = await Questionnaire.get(answer.questionnaireId)
      if (questionnaire?.state === QuestionnaireState.PROCESSING) {
        questionnaire.state = QuestionnaireState.ANSWERING
        await questionnaire.save()
      }
    }
  }
```

Upon receiving an answer event, we use Gemini to answer the question ([see answer logic](./gemini.ts#L81)).

```js
// gemini.ts Line 81
export const answerQuestion = async (params: {
  question: string
  type: QuestionnaireType
  customerType: CustomerType
}): Promise<string> => {
  const { question: _question, type, customerType } = params
  const question = _question.trim().replace(/^[?|!|.]/, '')
  const systemPrompt = await getSystemPrompt(question, type, customerType)
  const result = await gemini.generateContent({
    systemInstruction: systemPrompt,
    contents: [{ role: 'user', parts: [{ text: question }] }]
  })
  return result.response.text()
}
```

In this function, we load in all of the contextual prompts, located in the `system-prompt-files` [directory](./system-prompt-files).
We also use the `getSimilarAnswers` function to find similar answers to the question, and use this to better answer the question, using the Vertex AI Vector Search API.

Once the answer is saved, we check if all of the answers for the questionnaire are answered, and if so, we set the questionnaire to `COMPLETED` state.

## Future Work

- [ ] Update the Vector DB on a daily interval with the latest answers
- [ ] Add UI for re-processing questions, and seeing previous similar answers
