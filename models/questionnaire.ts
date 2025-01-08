import { data } from '@ampt/data'
import { DateTime } from 'luxon'
import { v4 as uuidv4 } from 'uuid'

import { extractQuestions } from '@gemini'
import { Answer } from '@models/answer'

export enum QuestionnaireState {
  LOADED = 'loaded',
  PROCESSING = 'processing',
  ANSWERING = 'answering',
  ERROR = 'error',
  COMPLETED = 'completed'
}

export enum QuestionnaireType {
  GENERIC_INBOUND_SALES_REQUEST = 'generic_inbound_sales_request',
  RFP = 'rfp',
  SECURITY_QUESTIONNAIRE = 'security_questionnaire',
  GDPR_QUESTIONNAIRE = 'gdpr_questionnaire',
  OTHER = 'other'
}

export enum CustomerType {
  GMP = 'gmp',
  CSP = 'csp',
  RTDP = 'rtdp',
  BRAND_SAFETY = 'brand_safety',
  AI = 'ai',
  OTHER = 'other'
}

export interface QuestionnaireRow {
  id: string
  name: string
  text: string
  json: string[] | undefined
  error: string | undefined
  type: QuestionnaireType
  customerType: CustomerType
  state: QuestionnaireState
  createdBy: string | undefined
  dateCreated: number
  dateCompleted: number | undefined
  approvedAt: number | undefined
}

enum QuestionnaireQueryMap {
  Name = 'label1'
}

export class Questionnaire {
  static prefix = 'questionnaire'

  id: string
  name: string
  text: string
  dateCreated: number
  createdBy: string | undefined
  state: QuestionnaireState = QuestionnaireState.LOADED

  json: string[] | undefined
  error: string | undefined
  dateCompleted: number | undefined
  type: QuestionnaireType
  customerType: CustomerType
  approvedAt: number | undefined
  totalAnswersApproved = 0

  constructor(params: QuestionnaireRow) {
    const {
      id,
      text,
      name,
      json,
      error,
      state,
      dateCreated,
      dateCompleted,
      createdBy,
      type,
      customerType,
      approvedAt
    } = params
    this.id = id
    this.name = name
    this.text = text
    this.json = json
    this.error = error
    this.state = state
    this.dateCreated = dateCreated || DateTime.now().toMillis()
    this.dateCompleted = dateCompleted
    this.type = type
    this.customerType = customerType
    this.approvedAt = approvedAt
    this.createdBy = createdBy
  }

  static initListeners() {
    data.on(
      `created:${Questionnaire.prefix}:*`,
      { timeout: 60000 * 5 },
      Questionnaire.onCreated
    )
  }

  static async onCreated(event: { item: { value: QuestionnaireRow } }) {
    const item = event.item.value
    const questionnaire = Questionnaire.fromRow(item as QuestionnaireRow)
    console.info(`Processing ${questionnaire.name}...`)
    const questions = await extractQuestions(questionnaire.text)
    if (questions?.length) {
      questionnaire.json = questions
      questionnaire.state = QuestionnaireState.PROCESSING
      await questionnaire.save()
      await Promise.all(
        (questionnaire.json ?? []).map((question: string) =>
          Answer.create({
            question,
            questionnaireId: questionnaire.id,
            answer: undefined
          })
        )
      )
      console.log(
        `Created ${questions.length} answers for questionnaire ${questionnaire.name}`
      )
    } else {
      console.error('Error extracting questions', {
        name: questionnaire.name,
        questions
      })
      questionnaire.state = QuestionnaireState.ERROR
      questionnaire.error = 'Error extracting questions'
      await questionnaire.save()
    }
  }

  static async create(params: {
    text: string
    name: string
    type?: QuestionnaireType
    customerType?: CustomerType
    createdBy: string
  }) {
    const {
      text,
      name,
      type = QuestionnaireType.OTHER,
      customerType = CustomerType.OTHER,
      createdBy
    } = params

    const id = uuidv4()
    const questionnaire = new Questionnaire({
      id,
      text,
      name,
      json: undefined,
      error: undefined,
      createdBy,
      state: QuestionnaireState.LOADED,
      dateCreated: DateTime.now().toMillis(),
      dateCompleted: undefined,
      type,
      customerType,
      approvedAt: undefined
    })

    await questionnaire.save()
    return questionnaire
  }

  static fromRow(row: QuestionnaireRow) {
    return new Questionnaire(row)
  }

  static async getByName(name: string) {
    const { items = [] } = await data.getByLabel<QuestionnaireRow>(
      QuestionnaireQueryMap.Name,
      `questionnaire:${name}*`
    )
    return items[0] ? Questionnaire.fromRow(items[0].value) : null
  }

  static async searchByName(
    name: string,
    lastKey?: string
  ): Promise<{ questionnaires: QuestionnaireRow[]; lastKey?: string } | null> {
    const { items = [], lastKey: _lastKey } =
      await data.getByLabel<QuestionnaireRow>(
        QuestionnaireQueryMap.Name,
        `questionnaire:${name}*`,
        {
          start: lastKey
        }
      )

    return {
      questionnaires: items.map((item) => item.value),
      lastKey: _lastKey
    }
  }

  static async get(id: string): Promise<Questionnaire | null> {
    const dbQuestionnaire = await data.get<QuestionnaireRow>(
      `${Questionnaire.prefix}:${id}`
    )

    if (dbQuestionnaire) {
      const answers = await Answer.listByQuestionnaireId(id)
      const questionnaire = Questionnaire.fromRow(dbQuestionnaire)

      questionnaire.totalAnswersApproved = answers.filter(
        (answer) => answer.approved
      ).length

      return questionnaire
    }

    return null
  }

  static async list(): Promise<Questionnaire[]> {
    const { items } = await data.get<QuestionnaireRow>(
      `${Questionnaire.prefix}:*`
    )

    const questionnaires = items.map(async (item) => {
      const answers = await Answer.listByQuestionnaireId(item.value.id)
      const questionnaire = Questionnaire.fromRow(item.value)

      questionnaire.totalAnswersApproved = answers.filter(
        (answer) => answer.approved
      ).length

      return questionnaire
    })

    return await Promise.all(questionnaires)
  }

  static async approve(id: string): Promise<Questionnaire | null> {
    const questionnaire = await Questionnaire.get(id)

    if (questionnaire) {
      questionnaire.approvedAt = DateTime.now().toMillis()
      await questionnaire.save()
      return questionnaire
    }

    return null
  }

  async save() {
    await data.set(`${Questionnaire.prefix}:${this.id}`, this.toJson(), {
      [QuestionnaireQueryMap.Name]: `questionnaire-${this.name}`
    })
    console.info('saved questionnaire', this.id, this.name)
  }

  async delete(params: { removeAnswers: boolean; force?: boolean }) {
    const { removeAnswers = false, force = false } = params
    if (
      this.state === QuestionnaireState.COMPLETED ||
      this.state === QuestionnaireState.ERROR ||
      force
    ) {
      await data.remove(`${Questionnaire.prefix}:${this.id}`)
      console.info(`Deleted questionnaire ${this.name}`)
      if (removeAnswers) {
        const answers = await Answer.listByQuestionnaireId(this.id)
        await Promise.all(answers.map((answer) => answer.delete()))
        console.info(
          `Deleted ${answers.length} answers for questionnaire ${this.name}`
        )
      }
    } else {
      throw new Error(
        `Cannot Delete Questionnaire while in ${this.state} state!`
      )
    }
  }

  toJson(): QuestionnaireRow {
    return {
      id: this.id,
      text: this.text,
      name: this.name,
      json: this.json,
      createdBy: this.createdBy,
      type: this.type,
      customerType: this.customerType,
      dateCreated: this.dateCreated,
      dateCompleted: this.dateCompleted,
      approvedAt: this.approvedAt,
      error: this.error,
      state: this.state
    }
  }
}
