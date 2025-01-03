import * as aiplatform from "@google-cloud/aiplatform";
import { writeFileSync, readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";


const API_ENDPOINT="14814207.us-central1-506564556600.vdb.vertexai.goog"
const INDEX_ENDPOINT="projects/506564556600/locations/us-central1/indexEndpoints/1296082316589793280"
const DEPLOYED_INDEX_ID="ai_hackathon_security_ques_1735921282266"
const PROJECT_ID = "scope3-dev"
const LOCATION = "us-central1"

async function getEmbeddings(
  texts,
  model = "text-embedding-005",
  task = "RETRIEVAL_QUERY",
  dimensionality = 0,
  apiEndpoint = "us-central1-aiplatform.googleapis.com"
) {
  const { PredictionServiceClient } = aiplatform.v1;
  const { helpers } = aiplatform;
  const clientOptions = { apiEndpoint: apiEndpoint };
  const endpoint = `projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${model}`;

  async function callPredict() {
    const instances = texts.map((e) =>
      helpers.toValue({ content: e, task_type: task })
    );
    const parameters = helpers.toValue(
      dimensionality > 0
        ? { outputDimensionality: dimensionality }
        : {}
    );
    const request = { endpoint, instances, parameters };
    const client = new PredictionServiceClient(clientOptions);
    const [response] = await client.predict(request);
    const predictions = response.predictions;
    const embeddings = predictions.map((p, index) => {
      const embeddingsProto = p.structValue.fields.embeddings;
      const valuesProto = embeddingsProto.structValue.fields.values;
      const embedding = valuesProto.listValue.values.map((v) => v.numberValue);
      return {
        id: index.toString(),
        question: texts[index],
        embedding: embedding,
      };
    });
    return embeddings;
  }

  return callPredict();
}

async function getQuestionNearestNeighbors(query) {
  const queryEmbeddings = await getEmbeddings([query]);
  const queryEmbedding = queryEmbeddings[0].embedding;

  const endpointClient = new aiplatform.v1.MatchServiceClient({
    apiEndpoint: API_ENDPOINT,
  });

  // TypeScript thinks this await is unnecessary. It is NOT. Google's API types are borked,
  // and this function returns a Promise we must wait for.
  const response = await endpointClient.findNeighbors({
    indexEndpoint: INDEX_ENDPOINT,
    deployedIndexId: DEPLOYED_INDEX_ID,
    queries: [{
      datapoint: {
        featureVector: queryEmbedding
      },
      neighborCount: 3
    }],
    returnFullDatapoint: false
  })

  return response?.[0].nearestNeighbors?.[0].neighbors
}

function getQuestionsFromCsvs(files) {
  const questions = []

  for (const file of files) {
    const fileData = readFileSync(file, 'utf-8');
    const records = parse(fileData, {
      columns: true,
      skip_empty_lines: true,
      record_delimiter: [],
    });

    if (records.length) {
      questions.push(...records.map(record => record.Question));
    }
  }

  return questions.filter((q) => q.length > 0)
}

// Generate data used to create the vector search index.
// const questionData = getQuestionsFromCsvs(["rfi-question-source-clean.csv", "security-question-source-clean.csv"]);
// const embeddingData = await getEmbeddings(questionData);
// const jsonlData = embeddingData.map(item => JSON.stringify(item)).join('\n');
// writeFileSync('embeddings.json', jsonlData);


// Get nearest neighbors for a question.
// const neighbors = await getQuestionNearestNeighbors("Does Scope3 have a security incident management process in place?");
// console.log(neighbors);


