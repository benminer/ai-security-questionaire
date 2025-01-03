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

// enable event listeners
Questionnaire.initListeners();

// Create express app and router
const app = express();
const api = Router();

app.use(cors());
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
      !req.body.type ||
      !Object.values(QuestionnaireType).includes(req.body.type)
    ) {
      res.status(400).send({ error: "Invalid questionnaire type" });
      return;
    }

    if (
      !req.body.customerType ||
      !Object.values(CustomerType).includes(req.body.customerType)
    ) {
      res.status(400).send({ error: "Invalid customer type" });
      return;
    }

    const questionnaire = await Questionnaire.create({
      text: req.body.text,
      type: req.body.type,
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

api.get(
  "/questionnaire/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const questionnaire = await Questionnaire.get(req.params.id);
    res.status(200).send(questionnaire);
    return;
  })
);

api.get(
  "/questionnaire/:id/answers",
  asyncHandler(async (req: Request, res: Response) => {
    const answers = await Questionnaire.getAnswers(req.params.id);
    res.status(200).send(answers);
    return;
  })
);

// Expose the app to the Internet
http.node.use(app);
