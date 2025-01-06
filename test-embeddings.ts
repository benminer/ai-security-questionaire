import { Answer } from "./models/answer";
import { getQuestionNearestNeighbors, getQuestionsFromCsvs, getEmbeddings, getSimilarAnswers } from "./vector-search";
import { writeFileSync, readFileSync } from "node:fs";



// Generate data used to create the vector search index.
// const questionData = getQuestionsFromCsvs(["rfi-question-source-clean.csv", "security-questions-v2-source-clean.csv"]);

// const embeddingData = await getEmbeddings(questionData.questions);
// const jsonlData = embeddingData.map(item => JSON.stringify(item)).join('\n');
// writeFileSync('embeddings.json', jsonlData);

// Save answers to the database.
// const answers: Record<string, string> = {}
// for (const answer of questionData.answers) {
//     answers[answer.question] = answer.answer;
// }

// Answer.batchCreate({answers})

// // Get nearest neighbors for a question.
// const neighbors = await getQuestionNearestNeighbors(["Do you scan for vulnerabilities in the environment?", "Please provide documentation describing your Information Security Management Program (ISMP):"]);
const neighbors = await getSimilarAnswers(["Have you completed a CDP Questionnaire?", "Are you certified?"])
console.log(JSON.stringify(neighbors));
