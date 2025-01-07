import { readFileSync } from 'node:fs'

const json = readFileSync('google-credentials.json', 'utf-8')
console.log(JSON.stringify(JSON.parse(json)))
