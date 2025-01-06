import { data } from "@ampt/data";
import { events } from "@ampt/sdk";
import { createHash } from "node:crypto";
import { splitEvery } from "ramda";
import { DateTime } from "luxon";
import { v4 as uuidv4 } from "uuid";

import { Answer } from "./answer";
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
  OTHER = "other",
}

export interface QuestionnaireRow {
  id: string;
  name: string;
  text: string;
  json: string[] | undefined;
  error: string | undefined;
  type: QuestionnaireType;
  customerType: CustomerType;
  state: QuestionnaireState;
  dateCreated: number;
  dateCompleted: number | undefined;
  approvedAt: number | undefined;
}

enum QuestionnaireQueryMap {
  Name = "label1",
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
  name: string;
  text: string;
  dateCreated: number;
  state: QuestionnaireState = QuestionnaireState.LOADED;

  json: string[] | undefined;
  error: string | undefined;
  dateCompleted: number | undefined;
  type: QuestionnaireType;
  customerType: CustomerType;
  approvedAt: number | undefined;
  totalAnswersApproved: number = 0;

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
      type,
      customerType,
      approvedAt,
    } = params;
    this.id = id;
    this.name = name;
    this.text = text;
    this.json = json;
    this.error = error;
    this.state = state;
    this.dateCreated = dateCreated || DateTime.now().toMillis();
    this.dateCompleted = dateCompleted;
    this.type = type;
    this.customerType = customerType;
    this.approvedAt = approvedAt;
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
        await Answer.batchCreate({
          questionnaireId: questionnaire.id,
          answers,
        });
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

  static async onCreated(event: { item: { value: QuestionnaireRow } }) {
    const item = event.item.value;
    const questionnaire = Questionnaire.fromRow(item as QuestionnaireRow);
    console.info(`Processing ${questionnaire.name}...`);
    const questions = await extractQuestions(questionnaire.text);
    console.info("extracted questions", questions);

    if (questions?.length) {
      questionnaire.json = questions;
      questionnaire.state = QuestionnaireState.PROCESSING;
      await questionnaire.save();
      await questionnaire.batchProcessAnswers();
    } else {
      console.error("Error extracting questions", {
        name: questionnaire.name,
        questions,
      });
      questionnaire.state = QuestionnaireState.ERROR;
      questionnaire.error = "Error extracting questions";
      await questionnaire.save();
    }
  }

  static async create(params: {
    text: string;
    name: string;
    type?: QuestionnaireType;
    customerType?: CustomerType;
  }) {
    const {
      text,
      name,
      type = QuestionnaireType.OTHER,
      customerType = CustomerType.OTHER,
    } = params;

    const id = uuidv4();
    const questionnaire = new Questionnaire({
      id,
      text,
      name,
      json: undefined,
      error: undefined,
      state: QuestionnaireState.LOADED,
      dateCreated: DateTime.now().toMillis(),
      dateCompleted: undefined,
      type,
      customerType,
      approvedAt: undefined,
    });

    await questionnaire.save();
    return questionnaire;
  }

  static fromRow(row: QuestionnaireRow) {
    return new Questionnaire(row);
  }

  static async getByName(name: string) {
    const { items = [] } = await data.getByLabel<QuestionnaireRow>(
      QuestionnaireQueryMap.Name,
      `questionnaire:${name}*`
    );
    return items[0] ? Questionnaire.fromRow(items[0].value) : null;
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
          start: lastKey,
        }
      );

    return {
      questionnaires: items.map((item) => item.value),
      lastKey: _lastKey,
    };
  }

  static async get(id: string): Promise<Questionnaire | null> {
    const dbQuestionnaire = await data.get<QuestionnaireRow>(
      `${Questionnaire.prefix}:${id}`
    );

    if (dbQuestionnaire) {
      const answers = await Answer.listByQuestionnaireId(id);
      const questionnaire = Questionnaire.fromRow(dbQuestionnaire);

      questionnaire.totalAnswersApproved = answers.filter((answer) => answer.approved).length;

      return questionnaire;
    }

    return null;
  }

  static async list(): Promise<Questionnaire[]> {
    const { items } = await data.get<QuestionnaireRow>(
      `${Questionnaire.prefix}:*`
    );
    return items.map((item) => Questionnaire.fromRow(item.value));
  }

  static async approve(id: string): Promise<Questionnaire | null> {
    const questionnaire = await Questionnaire.get(id);

    if (questionnaire) {
      questionnaire.approvedAt = DateTime.now().toMillis();
      await questionnaire.save();
      return questionnaire;
    }

    return null;
  }

  async save() {
    await data.set(`${Questionnaire.prefix}:${this.id}`, this.toJson(), {
      [QuestionnaireQueryMap.Name]: `questionnaire-${this.name}`,
    });
    console.info("saved questionnaire", this.id, this.name);
  }

  async delete(params: { removeAnswers: boolean }) {
    if (
      this.state === QuestionnaireState.COMPLETED ||
      this.state === QuestionnaireState.ERROR
    ) {
      const { removeAnswers } = params || { removeAnswers: false };
      await data.remove(`${Questionnaire.prefix}:${this.id}`);
      console.info(`Deleted questionnaire ${this.name}`);
      if (removeAnswers) {
        const answers = await Answer.listByQuestionnaireId(this.id);
        await Promise.all(answers.map((answer) => answer.delete()));
        console.info(
          `Deleted ${answers.length} answers for questionnaire ${this.name}`
        );
      }
    } else {
      throw new Error(
        `Cannot Delete Questionnaire while in ${this.state} state!`
      );
    }
  }

  async batchProcessAnswers() {
    if (this.json && this.state === QuestionnaireState.PROCESSING) {
      this.state = QuestionnaireState.ANSWERING;
      await this.save();

      console.info(
        `answering ${this.json?.length} questions for questionnaire ${this.id}`
      );

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

  toJson(): QuestionnaireRow {
    return {
      id: this.id,
      text: this.text,
      name: this.name,
      json: this.json,
      type: this.type,
      customerType: this.customerType,
      dateCreated: this.dateCreated,
      dateCompleted: this.dateCompleted,
      approvedAt: this.approvedAt,
      error: this.error,
      state: this.state,
    };
  }
}
