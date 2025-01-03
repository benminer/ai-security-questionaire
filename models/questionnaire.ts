import { data } from "@ampt/data";
import { events } from "@ampt/sdk";
import { splitEvery, flatten } from "ramda";
import { DateTime } from "luxon";
import { v4 as uuidv4 } from "uuid";

import { answerQuestionBatch, extractQuestions } from "../gemini";

export enum QuestionnaireState {
  LOADED = "loaded",
  PROCESSING = "processing",
  ANSWERING = "answering",
  ERROR = "error",
  COMPLETED = "completed",
}

export interface QuestionnaireRow {
  id: string;
  text: string;
  json: string[] | undefined;
  error: string | undefined;
  state: QuestionnaireState;
  dateCreated: number;
  dateCompleted: number | undefined;
}

export class Questionnaire {
  static prefix = "questionnaire";
  static answerPrefix = "questionnaire.answer.batch";
  static processAnswersEvent = "questionnaire.answer.batch";

  id: string;
  text: string;
  dateCreated: number;
  state: QuestionnaireState = QuestionnaireState.LOADED;

  json: string[] | undefined;
  error: string | undefined;
  dateCompleted: number | undefined;

  constructor(params: QuestionnaireRow) {
    const { id, text, json, error, state, dateCreated, dateCompleted } = params;
    this.id = id;
    this.text = text;
    this.json = json;
    this.error = error;
    this.state = state;
    this.dateCreated = dateCreated || DateTime.now().toMillis();
    this.dateCompleted = undefined;
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
        const answers = await answerQuestionBatch(batch);
        console.info("answers", answers);
        await data.set(
          `${Questionnaire.answerPrefix}:${id}:${batchNumber}`,
          answers
        );
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

  static async create(text: string) {
    const id = uuidv4();
    const questionnaire = new Questionnaire({
      id,
      text,
      json: undefined,
      error: undefined,
      state: QuestionnaireState.LOADED,
      dateCreated: DateTime.now().toMillis(),
      dateCompleted: undefined,
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

  static async getAnswers(
    id: string
  ): Promise<{ [question: string]: string }[]> {
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    const { items } = await data.get<any>(
      `${Questionnaire.answerPrefix}:${id}:*`
    );
    const answers = items.map((item) => item.value);
    // this comes back as an array of arrays
    return flatten(answers);
  }

  async save() {
    await data.set(`${Questionnaire.prefix}:${this.id}`, this.toJson());
  }

  async batchProcessAnswers() {
    if (this.json && this.state === QuestionnaireState.PROCESSING) {
      this.state = QuestionnaireState.ANSWERING;
      await this.save();
      const batches = splitEvery(10, this.json);
      batches.map(async (batch, index) => {
        await events.publish(
          Questionnaire.processAnswersEvent,
          { after: index * 50 }, // delay each batch by 50ms
          {
            id: this.id,
            totalBatches: batches.length,
            batchNumber: index,
            batch,
          }
        );
      });
    }
  }

  toJson() {
    return {
      id: this.id,
      text: this.text,
      json: this.json,
      dateCreated: this.dateCreated,
      dateCompleted: this.dateCompleted,
      error: this.error,
      state: this.state,
    };
  }
}
