import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Request, Response } from "express";
import { params } from "@ampt/sdk";

const genAI = new GoogleGenerativeAI(params("GEMINI_API_KEY"));
const gemini = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

export interface AnalyseDataRequest extends Request {
  body: {
    text: string;
  };
}

export const analyseData = async (req: AnalyseDataRequest, res: Response) => {
  try {
    const data = req.body.text;

    // Send the prompt with the JSON data to the model
    const result = await gemini.generateContent([
      `${data}. Extract only the questions in a JSON format with a "question" prop. Return only the JSON data`,
    ]);

    const resultJson = result.response.text();

    const questions = JSON.parse(
      resultJson.replace("```json", "").replace("```", "")
    );

    res.send({ questions, error: null });
  } catch (error) {
    console.error("Error generating insights:", error);

    res.send({ insights: null, error: "Error" });
  }
};
