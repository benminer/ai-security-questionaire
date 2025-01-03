import * as aiplatform from "@google-cloud/aiplatform";
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { Answer, AnswerRow } from "./models/answer";

const API_ENDPOINT = "14814207.us-central1-506564556600.vdb.vertexai.goog";
const INDEX_ENDPOINT =
  "projects/506564556600/locations/us-central1/indexEndpoints/1296082316589793280";
const DEPLOYED_INDEX_ID = "ai_hackathon_security_ques_1735921282266";
const PROJECT_ID = "scope3-dev";
const LOCATION = "us-central1";

interface Embedding {
  id: string;
  question: string;
  embedding: number[];
}

interface Prediction {
  structValue: {
    fields: {
      embeddings: {
        structValue: {
          fields: {
            values: {
              listValue: {
                values: { numberValue: number }[];
              };
            };
          };
        };
      };
    };
  };
}

async function getEmbeddings(
  texts: string[],
  model = "text-embedding-005",
  task = "RETRIEVAL_QUERY",
  dimensionality = 0,
  apiEndpoint = "us-central1-aiplatform.googleapis.com"
): Promise<{ id: string; question: string; embedding: number[] }[]> {
  const { PredictionServiceClient } = aiplatform.v1;
  const { helpers } = aiplatform;
  const clientOptions = { apiEndpoint: apiEndpoint };
  const endpoint = `projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${model}`;

  async function callPredict() {
    const instances: aiplatform.protos.google.protobuf.IValue[] = texts.map(
      (e) => helpers.toValue({ content: e, task_type: task })
    ) as aiplatform.protos.google.protobuf.IValue[];

    const parameters = helpers.toValue(
      dimensionality > 0 ? { outputDimensionality: dimensionality } : {}
    );
    const request = { endpoint, instances, parameters };
    const client = new PredictionServiceClient(clientOptions);
    const [response] = await client.predict(request);
    const predictions = response.predictions;

    const embeddings: Embedding[] = (
      predictions as unknown as Prediction[]
    ).map((p, index) => {
      const embeddingsProto = p.structValue.fields.embeddings;
      const valuesProto = embeddingsProto.structValue.fields.values;
      const embedding = valuesProto.listValue.values.map((v) => v.numberValue);
      return {
        id: Answer.hash(texts[index]),
        question: texts[index],
        embedding: embedding,
      };
    });
    return embeddings;
  }

  return callPredict();
}

export async function getQuestionNearestNeighbors(query: string) {
  const queryEmbeddings = await getEmbeddings([query]);
  const queryEmbedding = queryEmbeddings[0].embedding;

  const endpointClient = new aiplatform.v1.MatchServiceClient({
    apiEndpoint: API_ENDPOINT,
  });

  const response = await endpointClient.findNeighbors({
    indexEndpoint: INDEX_ENDPOINT,
    deployedIndexId: DEPLOYED_INDEX_ID,
    queries: [
      {
        datapoint: {
          featureVector: queryEmbedding,
        },
        neighborCount: 3,
      },
    ],
    returnFullDatapoint: false,
  });

  return response?.[0].nearestNeighbors?.[0].neighbors;
}

export function getQuestionsFromCsvs(files: string[]): { questions: string[]; answers: AnswerRow[] } {
  const questions: string[] = [];
  const answers: AnswerRow[] = [];

  for (const file of files) {
    const fileData = readFileSync(file, "utf-8");
    const records = parse(fileData, {
      columns: true,
      skip_empty_lines: true,
      record_delimiter: [],
    });

    if (records.length) {
      // Only include questions that are not empty + whose answers are not empty
      const validQuestions = records.filter(
        (record: { Question: string; Answer: string }) =>
          !!record.Question &&
          !!record.Answer &&
          record.Question.length > 0 &&
          record.Answer.length > 0
      );

      questions.push(
        ...validQuestions.map((record: { Question: string }) => record.Question)
      );
      answers.push(
        ...validQuestions.map(
          (record: { Question: string; Answer: string }) => ({
            question: record.Question,
            answer: record.Answer,
            id: Answer.hash(record.Answer),
          })
        )
      );
    }
  }

  return {
    questions,
    answers,
  };
}
