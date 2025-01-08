import { readFileSync } from 'node:fs'
import assert from 'node:assert'
import { flatten, splitEvery } from 'ramda'
import { params } from '@ampt/sdk'
import * as aiplatform from '@google-cloud/aiplatform'
import { parse } from 'csv-parse/sync'
import { Answer, type AnswerRow } from './models/answer'

const GOOGLE_CLOUD_CREDENTIALS = params('GOOGLE_CREDENTIALS_JSON')
assert(GOOGLE_CLOUD_CREDENTIALS, 'GOOGLE_CLOUD_CREDENTIALS is not defined')
const GOOGLE_CLOUD_PARAMS = params().group('GOOGLE_CLOUD') as Record<
  string,
  string
>
assert(GOOGLE_CLOUD_PARAMS, 'GOOGLE_CLOUD_PARAMS is not defined')

const API_ENDPOINT = GOOGLE_CLOUD_PARAMS.API_ENDPOINT
const INDEX_ENDPOINT = GOOGLE_CLOUD_PARAMS.INDEX_ENDPOINT
const DEPLOYED_INDEX_ID = GOOGLE_CLOUD_PARAMS.DEPLOYED_INDEX_ID
const PROJECT_ID = GOOGLE_CLOUD_PARAMS.PROJECT_ID
const LOCATION = 'us-central1'

const CREDENTIALS = JSON.parse(GOOGLE_CLOUD_CREDENTIALS.trim())
interface Embedding {
  id: string
  question: string
  embedding: number[]
}

interface Prediction {
  structValue: {
    fields: {
      embeddings: {
        structValue: {
          fields: {
            values: {
              listValue: {
                values: { numberValue: number }[]
              }
            }
          }
        }
      }
    }
  }
}

export async function getEmbeddings(
  texts: string[],
  model = 'text-embedding-005',
  task = 'RETRIEVAL_QUERY',
  dimensionality = 0,
  apiEndpoint = 'us-central1-aiplatform.googleapis.com'
): Promise<{ id: string; question: string; embedding: number[] }[]> {
  const { PredictionServiceClient } = aiplatform.v1
  const { helpers } = aiplatform
  const clientOptions = {
    apiEndpoint: apiEndpoint,
    credentials: CREDENTIALS
  }
  const endpoint = `projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${model}`

  async function callPredict(inputs: string[]) {
    const instances: aiplatform.protos.google.protobuf.IValue[] = inputs.map(
      (e) => helpers.toValue({ content: e, task_type: task })
    ) as aiplatform.protos.google.protobuf.IValue[]

    const parameters = helpers.toValue(
      dimensionality > 0 ? { outputDimensionality: dimensionality } : {}
    )
    const request = { endpoint, instances, parameters }
    const client = new PredictionServiceClient(clientOptions)
    const [response] = await client.predict(request)
    const predictions = response.predictions ?? []

    const embeddings: Embedding[] = (
      predictions as unknown as Prediction[]
    ).map((p, index) => {
      const embeddingsProto = p.structValue.fields.embeddings
      const valuesProto = embeddingsProto.structValue.fields.values
      const embedding = valuesProto.listValue.values.map((v) => v.numberValue)
      const text = inputs[index]
      return {
        id: Answer.hash(text),
        embedding: embedding,
        question: text
      }
    })
    return embeddings
  }

  // Only 250 embeddings can be generated at a time
  const batches = splitEvery(250, texts)
  const result: { id: string; question: string; embedding: number[] }[] =
    flatten(await Promise.all(batches.map(callPredict)))

  return result
}

export async function getQuestionNearestNeighbors(questions: string[]) {
  const embeddingsWithMetadata = await getEmbeddings(questions)
  const embeddings = embeddingsWithMetadata.map((e) => e.embedding)
  const endpointClient = new aiplatform.v1.MatchServiceClient({
    apiEndpoint: API_ENDPOINT,
    credentials: CREDENTIALS
  })

  const queries = embeddings.map((embedding) => ({
    datapoint: {
      featureVector: embedding
    },
    neighborCount: 3
  }))

  const response = await endpointClient.findNeighbors({
    indexEndpoint: INDEX_ENDPOINT,
    deployedIndexId: DEPLOYED_INDEX_ID,
    queries,
    returnFullDatapoint: false
  })

  return response?.[0].nearestNeighbors?.map((neighborData, index) => {
    const neighbors: { hash: string; distance: number }[] = []

    for (const neighbor of neighborData?.neighbors ?? []) {
      const datapoint = neighbor.datapoint?.datapointId

      if (datapoint != null && neighbor.distance != null) {
        neighbors.push({
          hash: datapoint,
          distance: neighbor.distance
        })
      }
    }

    return {
      question: questions[index],
      neighbors
    }
  })
}

export async function getSimilarAnswers(questions: string[]): Promise<
  {
    question: string
    neighbors: {
      question: string
      answer: string
      distance: number
    }[]
  }[]
> {
  const nearestNeighbors = await getQuestionNearestNeighbors(questions)

  const answers =
    nearestNeighbors?.map(async (questionData) => {
      const neighbors = await Promise.all(
        questionData.neighbors.map(async (neighbor) => {
          const knownAnswer = await Answer.getByQuestionHash(neighbor.hash)

          if (knownAnswer) {
            return {
              question: knownAnswer.question,
              answer: knownAnswer.answer,
              distance: neighbor.distance
            }
          }
        })
      )

      return {
        question: questionData.question,
        neighbors: neighbors.filter((neighbor) => !!neighbor)
      }
    }) ?? []

  return await Promise.all(answers)
}

export function getQuestionsFromCsvs(files: string[]): {
  questions: string[]
  answers: AnswerRow[]
} {
  const questions: string[] = []
  const answers: AnswerRow[] = []

  for (const file of files) {
    const fileData = readFileSync(file, 'utf-8')
    const records = parse(fileData, {
      columns: true,
      skip_empty_lines: true,
      record_delimiter: []
    })

    if (records.length) {
      // Only include questions that are not empty + whose answers are not empty
      const validQuestions = records.filter(
        (record: { Question: string; Answer: string }) =>
          !!record.Question &&
          !!record.Answer &&
          record.Question.length > 0 &&
          record.Answer.length > 0
      )

      questions.push(
        ...validQuestions.map((record: { Question: string }) => record.Question)
      )

      answers.push(
        ...validQuestions.map(
          (record: { Question: string; Answer: string }) => ({
            question: record.Question,
            answer: record.Answer,
            id: Answer.hash(record.Answer)
          })
        )
      )
    }
  }

  return {
    questions,
    answers
  }
}
