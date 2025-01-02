import { params, storage } from '@ampt/sdk'
import { GoogleGenerativeAI } from "@google/generative-ai";

const API_KEY = params('GEMINI_API_KEY');

const testCsv = await storage().readBuffer('testing-questionnaire.csv');
const genAI = new GoogleGenerativeAI(API_KEY);

const tunedModel = genAI.getGenerativeModel({
  model: "tunedModels/trimmedhackathoncsv2-xxhoqvk2q6pn"
});

const prompt = "You are going to receive a CSV with questions and blank answers. Using your knowledge of previous Scope3 questionnaires, answer these questions to the best of your ability. For things you are not sure about, put 'Unknown'."

const modelInput = `${prompt}\n\nThe CSV contents are the next lines:\n${testCsv.toString('utf-8')}`

const result = await tunedModel.generateContent(modelInput);

const resultJson = result.response.text();
console.log(resultJson)
