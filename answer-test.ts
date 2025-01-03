import { answerQuestionBatch } from "./gemini";

const questions = [
  "Products Description (please detail all available products)",
  "Pricing Model",
  "Provide any other standards, guidelines or framework your solution incorporates.",
];

const answers = await answerQuestionBatch(questions);
console.info(answers);
