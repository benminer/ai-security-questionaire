// import { VertexAI } from "@google-cloud/vertexai";
// import fs from "node:fs";

// const PROJECT_ID = "scope3-dev";
// const PROJECT_LOCATION = "us-central1";

// const vertexai = new VertexAI({
//   project: PROJECT_ID,
//   location: PROJECT_LOCATION,
//   googleAuthOptions: {
//     credentials: JSON.parse(
//       fs.readFileSync("./google-credentials.json", "utf8")
//     ),
//   },
// });

// const model = vertexai.getGenerativeModel({
//   model: "6900839540643069952",
// });

// const prompt = `
// Answer the following questions. Include questions exactly as provided. In the response, return only JSON data where each question is an object with question and answer.
// `;

// const result = await model.generateContent({
//   systemInstruction: prompt,
//   contents: [
//     {
//       role: "user",
//       parts: [
//         {
//           text: "Please provide an overview of total number of clients for whom you provide emissions measurement services and technology. ",
//         },
//       ],
//     },
//   ],
// });

// const response = await result.response;
// console.log(JSON.stringify(response, null, 2));
