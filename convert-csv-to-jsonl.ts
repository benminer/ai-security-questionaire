import { writeFileSync, readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";

const file = readFileSync("training-csv.csv", "utf-8");
const records = parse(file, {
  columns: true,
  skip_empty_lines: true,
  record_delimiter: [],
});

if (records.length) {
  const contents = [];
  for (const { Question, Answer } of records) {
    contents.push({
      role: "user",
      parts: [
        {
          text: Question.trim(),
        },
      ],
    });
    contents.push({
      role: "model",
      parts: [
        {
          text: Answer.trim(),
        },
      ],
    });
  }

  const jsonl = {
    systemInstruction: {
      role: "model",
      parts: [
        {
          text: "You are an assistant aiding in the answering of incoming questionnaires for the company Scope3. Answer as concisely as possible, using 'Yes' or 'No' when applicable.",
        },
      ],
    },
    contents,
  };

  writeFileSync("training-jsonl.jsonl", JSON.stringify(jsonl));
}
