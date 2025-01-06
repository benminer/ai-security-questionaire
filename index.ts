import { http } from "@ampt/sdk";
import cors from "cors";
import asyncHandler from "express-async-handler";
import express, { Router, type Request, type Response } from "express";
import {
  Questionnaire,
  QuestionnaireType,
  CustomerType,
} from "./models/questionnaire";
import { analyseData } from "./gemini";
import { Answer } from "./models/answer";
import { getSimilarAnswers } from "./vector-search";

// enable event listeners
Questionnaire.initListeners();

// Create express app and router
const app = express();
const api = Router();

app.use(
  cors({
    origin: [
      /http:\/\/localhost:[0-9]+/,
      /^https:\/\/[\w-]+\.scope3-admin-staging\.pages\.dev$/,
    ],
  })
);
app.use(express.json());

// Mount api to /api base route
app.use("/api", api);

api.post("/gemini", (req, res) => {
  return analyseData(req, res);
});

api.post(
  "/questionnaire",
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.body.text) {
      res.status(400).send({ error: "Text is required" });
      return;
    }

    if (
      req.body.type &&
      !Object.values(QuestionnaireType).includes(req.body.type)
    ) {
      res.status(400).send({ error: "Invalid questionnaire type" });
      return;
    }

    if (
      req.body.customerType &&
      !Object.values(CustomerType).includes(req.body.customerType)
    ) {
      res.status(400).send({ error: "Invalid customer type" });
      return;
    }

    if (!req.body.name) {
      res.status(400).send({ error: "Name is required" });
      return;
    }

    const nameRegex = /^[a-zA-Z0-9\s-_]+$/;
    if (!nameRegex.test(req.body.name)) {
      res.status(400).send({
        error:
          "Name can only contain letters, numbers, spaces, hyphens and underscores",
      });
      return;
    }

    const existingQuestionnaire = await Questionnaire.getByName(req.body.name);

    if (existingQuestionnaire) {
      res.status(400).send({
        error: `Questionnaire already exists for name ${req.body.name}!`,
      });
      return;
    }

    const questionnaire = await Questionnaire.create({
      text: req.body.text,
      type: req.body.type,
      name: req.body.name,
      customerType: req.body.customerType,
    });
    res.status(200).send(questionnaire);
    return;
  })
);

api.get(
  "/questionnaires",
  asyncHandler(async (_, res: Response) => {
    const questionnaires = await Questionnaire.list();
    res.status(200).send(questionnaires);
    return;
  })
);

api.post(
  "/questionnaire/:id/approve",
  asyncHandler(async (req: Request, res: Response) => {
    const questionnaire = await Questionnaire.get(req.params.id);

    if (!questionnaire) {
      res.status(404).send({ error: "Questionnaire not found" });
      return;
    }

    await Answer.approveForQuestionnaire(questionnaire.id);
    res.status(200).send({ success: true });
    return;
  })
);

api.get(
  "/questionnaire/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const questionnaire = await Questionnaire.get(req.params.id);
    res.status(200).send(questionnaire);
    return;
  })
);

api.post(
  "/questionnaire/:id/answer/:questionHash/reprocess",
  asyncHandler(async (req: Request, res: Response) => {
    const questionHash = req.params.questionHash;
    const [questionnaire, answer] = await Promise.all([
      Questionnaire.get(req.params.id),
      Answer.getByQuestionnaireIdAndHash(req.params.id, questionHash),
    ]);

    if (!questionnaire) {
      res.status(404).send({ error: "Questionnaire not found" });
      return;
    }

    if (!answer) {
      res.status(404).send({ error: "Answer not found" });
      return;
    }

    try {
      await answer.reprocess();
      res.status(200).send(answer);
    } catch (e) {
      res.status(500).send({ error: "Failed to reprocess answer" });
    }
    return;
  })
);

api.patch(
  "/questionnaire/:id/answer/:questionHash",
  asyncHandler(async (req: Request, res: Response) => {
    const { approved, answer: newAnswer } = req.body;
    const questionHash = req.params.questionHash;

    const [questionnaire, answer] = await Promise.all([
      Questionnaire.get(req.params.id),
      Answer.getByQuestionHash(questionHash),
    ]);

    if (!questionnaire) {
      res.status(404).send({ error: "Questionnaire not found" });
      return;
    }

    if (!answer) {
      res.status(404).send({ error: "Answer not found" });
      return;
    }

    await answer.update({ approved, answer: newAnswer });

    res.status(200).send(answer);
    return;
  })
);

api.get(
  "/questionnaire/:id/answers",
  asyncHandler(async (req: Request, res: Response) => {
    const answers = await Answer.listByQuestionnaireId(req.params.id);
    res.status(200).send(answers.map((answer) => answer.toJson()));
    return;
  })
);

api.post(
  "/similarQuestions",
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.body.questions) {
      res.status(400).send({ error: "Questions are required" });
      return;
    }

    if (
      !Array.isArray(req.body.questions) ||
      !req.body.questions.every((q: string) => typeof q === "string")
    ) {
      res.status(400).send({ error: "Questions must be an array of strings" });
      return;
    }

    const questions = req.body.questions;
    const similar = await getSimilarAnswers(questions);
    res.status(200).send(similar);
  })
);

// Expose the app to the Internet
http.node.use(app);
