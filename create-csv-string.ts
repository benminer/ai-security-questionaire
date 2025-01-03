import { readFileSync } from "node:fs";

const file = readFileSync("blank-csv-1.csv", "utf-8");
console.log(JSON.stringify(file));
