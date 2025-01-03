import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Request, Response } from "express";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { params } from "@ampt/sdk";

const genAI = new GoogleGenerativeAI(params("GEMINI_API_KEY"));
export const gemini = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
const tunedModel = genAI.getGenerativeModel({
  model: "tunedModels/trainingcsv1-ih2fyjh9ms5l",
});

export interface AnalyseDataRequest extends Request {
  body: {
    text: string;
  };
}

export const extractQuestions = async (text: string) => {
  try {
    const result = await gemini.generateContent([
      `${text}. Extract only the questions in a JSON format as an array of strings. Return only the JSON data`,
    ]);
    const resultText = result.response.text();
    const questions = JSON.parse(resultText.replace(/```(json)?/g, ""));
    return questions;
  } catch (error) {
    console.error("Error extracting questions:", error);
    return null;
  }
};

export const answerQuestionBatch = async (questions: string[]) => {
  const [info, policies] = await Promise.all([
    readFile(path.join("system-prompt-files", "info.txt"), "utf-8"),
    readFile(path.join("system-prompt-files", "policies.txt"), "utf-8"),
  ]);
  const result = await gemini.generateContent({
    systemInstruction: `
      You are an expert at answering RFI and security questions for Scope3. Answer to the best of your ability. Keep answers concise and to the point.
      Be sure to return the answer in JSON format, with the question as the key and the answer as the value.
      Note that these questions are all regarding Scope3, and may not always be phrased as a question.
      Here is some context:
      ${info}
      \n
      ${policies}
      `,
    contents: [
      {
        role: "user",
        parts: [{ text: questions.join("\n") }],
      },
    ],
  });
  const resultText = result.response.text();
  const questionAnswers = JSON.parse(resultText.replace(/```(json)?/g, ""));
  return questionAnswers;
};

export const analyseData = async (req: AnalyseDataRequest, res: Response) => {
  try {
    const data = req.body.text;
    console.log("\nraw input data:", data);

    // Send the prompt with the JSON data to the model
    const result = await gemini.generateContent([
      `${data}. Extract only the questions in a JSON format as an array of strings. Return only the JSON data`,
    ]);

    const resultText = result.response.text();

    const questions = JSON.parse(resultText.replace(/```(json)?/g, ""));

    console.log("\nextracted questions:", questions);

    return answerQuestions(questions, res);
  } catch (error) {
    console.error("Error extracting questions:", error);

    return res.status(500).send({ questions: null, error });
  }
};

export const answerQuestions = async (questions: object, res: Response) => {
  try {
    const prompt =
      "Answer the following questions. Include questions exactly as provided. In the response, return only JSON data where each question is an object with question and answer.";

    const modelInput = `${prompt} The questions are:\n\n${JSON.stringify(
      questions
    )}`;

    console.log("\n\nmodelInput\n", modelInput);

    const result = await tunedModel.generateContent(modelInput);

    const resultText = result.response.text();
    console.log("\n tuned model result text:", resultText);
    const questionAnswers = JSON.parse(resultText.replace(/```(json)?/g, ""));
    console.log("\ntuned model response:", questionAnswers);

    return res.status(200).send({ questions: questionAnswers, error: null });
  } catch (error) {
    console.error("Error answering questions:", error);
    return res.status(500).send({ questions: null, error });
  }
};
