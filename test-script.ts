import { params, storage } from "@ampt/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

const API_KEY = params("GEMINI_API_KEY");

const testCsv = await storage().readBuffer("testing-questionnaire.csv");

if (!testCsv) {
  console.error("Failed to read CSV file");
  process.exit(1);
}

const listOfQuestions = testCsv
  .toString("utf-8")
  .split("\n")
  .slice(1)
  .map((line) => line.split(",")[0]);

const genAI = new GoogleGenerativeAI(API_KEY);

const tunedModel = genAI.getGenerativeModel({
  model: "tunedModels/trimmedhackathoncsv2-xxhoqvk2q6pn",
});

// const prompt =
//   "You are going to receive a CSV with questions and blank answers. Using your knowledge of previous Scope3 questionnaires, answer these questions to the best of your ability. For things you are not sure about, put 'Unknown'.";

const prompt = `
Your role is to expedite the process of RFI forms (Request for Information), you've been trained on previous completed RFI forms.

Using your knowledge of previous Scope3 questionnaires, answer these questions to the best of your ability. For things you are not sure about, put 'Unknown'.

While you should answer each question on individually, your response should be in a JSON format, as an array of objects where each object has a "question" and "answer" property.
Be sure to maintain the original question order, and assure that the question is identical to the question in the input.

Most importantly, NEVER hallucinate answers, if you are not sure about an answer, put 'Unknown'. 

For any questions asking for a Date, the current date is ${new Date().toISOString()}. Please format the date as YYYY-MM-DD, if applicable.

The questions are the following lines:
${listOfQuestions.join("\n")}
`;

const result = await tunedModel.generateContent(prompt);

const resultJson = result.response.text();
console.log(resultJson);
