import { data } from "@ampt/data";
import { events } from "@ampt/sdk";
import { createHash } from "node:crypto";
import { splitEvery, flatten } from "ramda";
import { DateTime } from "luxon";
import { v4 as uuidv4 } from "uuid";

import { answerQuestionBatch, extractQuestions } from "../gemini";

const hashQuestion = (question: string) => {
  return createHash("sha256").update(question).digest("hex").slice(0, 12);
};

export enum QuestionnaireState {
  LOADED = "loaded",
  PROCESSING = "processing",
  ANSWERING = "answering",
  ERROR = "error",
  COMPLETED = "completed",
}

export enum QuestionnaireType {
  GENERIC_INBOUND_SALES_REQUEST = "generic_inbound_sales_request",
  RFP = "rfp",
  SECURITY_QUESTIONNAIRE = "security_questionnaire",
  GDPR_QUESTIONNAIRE = "gdpr_questionnaire",
  OTHER = "other",
}

export enum CustomerType {
  GMP = "gmp",
  CSP = "csp",
  RTDP = "rtdp",
  BRAND_SAFETY = "brand_safety",
  AI = "ai",
}

export interface QuestionnaireRow {
  id: string;
  text: string;
  json: string[] | undefined;
  error: string | undefined;
  type: QuestionnaireType;
  customerType: CustomerType;
  state: QuestionnaireState;
  dateCreated: number;
  dateCompleted: number | undefined;
}

interface QuestionnaireAnswer {
  question: string;
  answer: string;
  id: string;
  approved: boolean | undefined;
}

export class Questionnaire {
  static prefix = "questionnaire";
  static answerPrefix = "questionnaire.answer";
  static processAnswersEvent = "questionnaire.answer.batch";

  id: string;
  text: string;
  dateCreated: number;
  state: QuestionnaireState = QuestionnaireState.LOADED;

  json: string[] | undefined;
  error: string | undefined;
  dateCompleted: number | undefined;
  type: QuestionnaireType;
  customerType: CustomerType;

  constructor(params: QuestionnaireRow) {
    const {
      id,
      text,
      json,
      error,
      state,
      dateCreated,
      dateCompleted,
      type,
      customerType,
    } = params;
    this.id = id;
    this.text = text;
    this.json = json;
    this.error = error;
    this.state = state;
    this.dateCreated = dateCreated || DateTime.now().toMillis();
    this.dateCompleted = dateCompleted;
    this.type = type;
    this.customerType = customerType;
  }

  static initListeners() {
    data.on(`created:${Questionnaire.prefix}:*`, Questionnaire.onCreated);
    events.on(Questionnaire.processAnswersEvent, Questionnaire.onAnswerBatch);
  }

  static async onAnswerBatch(event: {
    body: {
      id: string;
      totalBatches: number;
      batchNumber: number;
      batch: string[];
    };
  }) {
    const { id, totalBatches, batchNumber, batch } = event.body;
    const questionnaire = await Questionnaire.get(id);
    if (questionnaire && questionnaire.state === QuestionnaireState.ANSWERING) {
      try {
        const answers = await answerQuestionBatch({
          questions: batch,
          type: questionnaire.type,
          customerType: questionnaire.customerType,
        });
        console.info("answers", answers);
        await Questionnaire.saveAnswers(id, answers);
      } catch (e) {
        console.error("Error answering batch", e);
        questionnaire.error = "Error answering batch";
        questionnaire.state = QuestionnaireState.ERROR;
        await questionnaire.save();
      } finally {
        if (
          batchNumber === totalBatches - 1 &&
          questionnaire.state === QuestionnaireState.ANSWERING
        ) {
          questionnaire.state = QuestionnaireState.COMPLETED;
          console.info(`Questionnaire ${questionnaire.id} completed`);
          questionnaire.dateCompleted = DateTime.now().toMillis();
          await questionnaire.save();
        }
      }
    }
  }

  static async getAnswer(id: string, questionHash: string) {
    const answer = await data.get<QuestionnaireAnswer>(
      `${Questionnaire.answerPrefix}:${id}:${questionHash}`
    );
    return answer;
  }

  static async updateAnswer(params: {
    id: string;
    _question: string;
    _answer: string;
    approved?: boolean;
  }): Promise<QuestionnaireAnswer> {
    const { id, _question, _answer, approved = undefined } = params;
    const question = _question.trim();
    const answer = _answer.trim();
    const questionId = hashQuestion(question);
    const result = await data.set<QuestionnaireAnswer>(
      `${Questionnaire.answerPrefix}:${id}:${questionId}`,
      {
        question,
        answer,
        id: questionId,
        approved,
      },
      { overwrite: true, meta: true }
    );

    return result.value;
  }

  static async saveAnswers(
    id: string,
    answers: { [question: string]: string }
  ) {
    const keyValuePairs = splitEvery(
      25,
      Object.entries(answers).map(([_question, _answer]) => {
        const question = _question.trim();
        const answer = _answer.trim();
        const questionId = hashQuestion(question);
        return {
          key: `${Questionnaire.answerPrefix}:${id}:${questionId}`,
          value: {
            question,
            answer,
            id: questionId,
            approved: undefined,
          },
        };
      })
    );

    // data.set is limited to 25 keys at a time, so we need to split the array into chunks of 25
    await Promise.all(
      keyValuePairs.map((pair: { key: string; value: QuestionnaireAnswer }[]) =>
        data.set(pair)
      )
    );
  }

  static async onCreated(event: { item: { value: QuestionnaireRow } }) {
    const item = event.item.value;
    const questionnaire = Questionnaire.fromRow(item as QuestionnaireRow);
    const questions = await extractQuestions(questionnaire.text);
    console.info("extracted questions", questions);

    if (questions?.length) {
      questionnaire.json = questions;
      questionnaire.state = QuestionnaireState.PROCESSING;
      await questionnaire.save();
    } else {
      questionnaire.state = QuestionnaireState.ERROR;
      questionnaire.error = "Error extracting questions";
      await questionnaire.save();
    }
  }

  static async create(params: {
    text: string;
    type: QuestionnaireType;
    customerType: CustomerType;
  }) {
    const id = uuidv4();
    const questionnaire = new Questionnaire({
      id,
      text: params.text,
      json: undefined,
      error: undefined,
      state: QuestionnaireState.LOADED,
      dateCreated: DateTime.now().toMillis(),
      dateCompleted: undefined,
      type: params.type,
      customerType: params.customerType,
    });
    await questionnaire.save();
    return questionnaire;
  }

  static fromRow(row: QuestionnaireRow) {
    return new Questionnaire(row);
  }

  static async get(id: string): Promise<Questionnaire | null> {
    const questionnaire = await data.get<QuestionnaireRow>(
      `${Questionnaire.prefix}:${id}`
    );

    if (questionnaire) {
      return Questionnaire.fromRow(questionnaire);
    }

    return null;
  }

  static async list(): Promise<Questionnaire[]> {
    const { items } = await data.get<QuestionnaireRow>(
      `${Questionnaire.prefix}:*`
    );
    return items.map((item) => Questionnaire.fromRow(item.value));
  }

  static async getAnswers(id: string): Promise<QuestionnaireAnswer[]> {
    const { items } = await data.get<QuestionnaireAnswer>(
      `${Questionnaire.answerPrefix}:${id}:*`
    );
    return items.map((item) => item.value);
  }

  async save() {
    await data.set(`${Questionnaire.prefix}:${this.id}`, this.toJson());
  }

  async approveAllAnswers() {
    const answers = await Questionnaire.getAnswers(this.id);
    await Promise.all(
      answers.map((answer) =>
        Questionnaire.updateAnswer({
          id: this.id,
          _question: answer.question,
          _answer: answer.answer,
          approved: true,
        })
      )
    );
  }

  async approveAnswer(params: {
    questionHash: string;
  }): Promise<QuestionnaireAnswer | null> {
    const { questionHash } = params;
    const answer = await Questionnaire.getAnswer(this.id, questionHash);
    if (answer) {
      return await Questionnaire.updateAnswer({
        id: this.id,
        _question: answer.question,
        _answer: answer.answer,
        approved: true,
      });
    }
    return null;
  }

  async reprocessAnswer(params: {
    questionHash: string;
  }): Promise<QuestionnaireAnswer | null> {
    const { questionHash } = params;
    const answer = await data.get<QuestionnaireAnswer>(
      `${Questionnaire.answerPrefix}:${this.id}:${questionHash}`
    );
    if (answer) {
      const newAnswer = await answerQuestionBatch({
        questions: [answer.question],
        type: this.type,
        customerType: this.customerType,
      });
      if (Object.keys(newAnswer).length && newAnswer[answer.question]) {
        return await Questionnaire.updateAnswer({
          id: this.id,
          _question: answer.question,
          _answer: newAnswer[answer.question],
        });
      }
    }
    return null;
  }

  async batchProcessAnswers() {
    if (this.json && this.state === QuestionnaireState.PROCESSING) {
      this.state = QuestionnaireState.ANSWERING;
      await this.save();
      const batches = splitEvery(10, this.json);
      await Promise.all(
        batches.map(async (batch, index) =>
          events.publish(
            Questionnaire.processAnswersEvent,
            { after: index * 50 }, // delay each batch by 50ms
            {
              id: this.id,
              totalBatches: batches.length,
              batchNumber: index,
              batch,
            }
          )
        )
      );
    }
  }

  toJson() {
    return {
      id: this.id,
      text: this.text,
      json: this.json,
      type: this.type,
      customerType: this.customerType,
      dateCreated: this.dateCreated,
      dateCompleted: this.dateCompleted,
      error: this.error,
      state: this.state,
    };
  }
}
