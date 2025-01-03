import { http } from "@ampt/sdk";
import express, { Router } from "express";
import { analyseData } from "./gemini";

// Create express app and router
const app = express();
const api = Router();

app.use(express.json());

// Mount api to /api base route
app.use("/api", api);

api.post("/gemini", (req, res) => {
  return analyseData(req, res);
});

// Expose the app to the Internet
http.node.use(app);
