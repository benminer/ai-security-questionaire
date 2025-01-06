import { Answer } from "./models/answer";
import { getQuestionsFromCsvs, getEmbeddings } from "./vector-search";
import { writeFileSync } from "node:fs";

// Generate data used to create the vector search index.
const questionData = getQuestionsFromCsvs([
  "csvs/rfi-question-source-clean.csv",
  "csvs/security-questions-v2-source-clean.csv",
]);

const embeddingData = await getEmbeddings(questionData.questions);
const jsonlData = embeddingData.map((item) => JSON.stringify(item)).join("\n");
writeFileSync("embeddings.json", jsonlData);

// Save answers to the database.
const answers: Record<string, string> = {};
for (const answer of questionData.answers) {
  answers[answer.question] = answer.answer;
}

await Answer.batchCreate({ answers });

console.log("Answers hydrated");
process.exit(0);
