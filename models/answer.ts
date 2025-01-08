import { createHash } from 'node:crypto'
import { data } from '@ampt/data'
import { events } from '@ampt/sdk'
import { splitEvery } from 'ramda'
import { v4 as uuidv4 } from 'uuid'

import { answerQuestion, answerQuestionBatch } from '@gemini'
import {
  CustomerType,
  Questionnaire,
  QuestionnaireState,
  QuestionnaireType
} from '@models/questionnaire'

export interface AnswerRow {
  id: string
  question: string
  answer: string | undefined
  approved: boolean | undefined
  // This is optional so we can hydrate previous questionnaire answers
  questionnaireId: string | undefined
  uuid: string
}

export type CreateAnswerParams = Omit<AnswerRow, 'id' | 'approved' | 'uuid'>

enum AnswerQueryMap {
  QuestionnaireId = 'label1',
  QuestionHash = 'label2'
}

export class Answer {
  static prefix = 'answer'
  static label = 'questionnaire'
  static label2 = 'answerhash'

  static processAnswersEvent = 'answer:process'

  uuid: string
  id: string
  question: string
  questionnaireId: string | undefined
  answer: string | undefined
  approved: boolean | undefined

  static hash(question: string) {
    return createHash('sha256').update(question).digest('hex').slice(0, 12)
  }

  static initListeners() {
    data.on(
      `created:${Answer.prefix}:*`,
      { timeout: 60000 * 5 },
      Answer.onCreated
    )
    events.on(
      Answer.processAnswersEvent,
      { timeout: 60000 * 5 },
      Answer.onAnswerProcessEvent
    )
  }

  constructor(params: AnswerRow) {
    this.uuid = params.uuid
    this.id = params.id
    this.questionnaireId = params.questionnaireId
    this.question = params.question
    this.answer = params.answer
    this.approved = params.approved
  }

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

  static async onAnswerProcessEvent(event: { body: AnswerRow }) {
    const { body } = event
    const unanswered = Answer.fromRow(body)
    console.log(`processing answer: ${unanswered.question}`)

    let type: QuestionnaireType = QuestionnaireType.OTHER
    let customerType: CustomerType = CustomerType.OTHER

    if (unanswered.questionnaireId) {
      const questionnaire = await Questionnaire.get(unanswered.questionnaireId)
      if (questionnaire) {
        type = questionnaire.type
        customerType = questionnaire.customerType
      }
    }

    const answer = await answerQuestion({
      question: unanswered.question,
      type,
      customerType
    })

    await unanswered.update({ answer })

    console.log(`Answered question ${unanswered.question}`)

    if (unanswered.questionnaireId) {
      const answers = await Answer.listByQuestionnaireId(
        unanswered.questionnaireId
      )
      // if all answers are answered, update the questionnaire state to COMPLETED
      if (answers.every((answer) => Boolean(answer.answer))) {
        const questionnaire = await Questionnaire.get(
          unanswered.questionnaireId
        )
        if (questionnaire) {
          questionnaire.state = QuestionnaireState.COMPLETED
          console.log(
            `all answers for questionnaire ${questionnaire.name} are answered, setting state to COMPLETED`
          )
          await questionnaire.save()
        }
      }
    }
  }

  static async create(params: CreateAnswerParams) {
    const answer = new Answer({
      ...params,
      id: Answer.hash(params.question),
      uuid: uuidv4(),
      approved: undefined
    })
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
        const indexes = {
          [AnswerQueryMap.QuestionHash]: `${Answer.label2}:${questionId}`
        }
        const uuid = uuidv4()
        return {
          key: `${Answer.prefix}:${uuid}`,
          value: {
            questionnaireId,
            question,
            answer,
            id: questionId,
            uuid,
            approved: undefined
          },
          ...(questionnaireId
            ? {
                ...indexes,
                [AnswerQueryMap.QuestionnaireId]: `${Answer.label}:${questionnaireId}:${questionId}`
              }
            : indexes)
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
    const answer = await data.getByLabel<AnswerRow>(
      AnswerQueryMap.QuestionHash,
      `${Answer.label2}:${questionHash}`
    )
    return answer.items.map((answer) => new Answer(answer.value))?.[0] ?? null
  }

  static async listByQuestionnaireId(id: string) {
    const { items, next: nextPage } = await data.getByLabel<AnswerRow>(
      AnswerQueryMap.QuestionnaireId,
      `${Answer.label}:${id}:*`
    )

    const results = items.map((answer) => new Answer(answer.value))

    let next = nextPage
    while (next) {
      const { items, next: nextPage } = await next()
      results.push(...items.map((answer) => new Answer(answer.value)))
      next = nextPage
    }

    return results
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

  async publishAnswerEvent() {
    await events.publish(
      Answer.processAnswersEvent,
      {
        after: Math.floor(Math.random() * 1000) // delay each answer by a random amount b/w 0-1000ms to avoid rate limiting
      },
      this.toJson()
    )
  }

  toJson() {
    return {
      id: this.id,
      uuid: this.uuid,
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
      meta, // if set to true, return the item
      [AnswerQueryMap.QuestionHash]: `${Answer.label2}:${this.id}`
    }

    await data.set<AnswerRow>(
      `${Answer.prefix}:${this.uuid}`,
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
