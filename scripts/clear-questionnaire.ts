import { Questionnaire } from '@models'

const id = 'c84ce66f-b0a5-45a5-b102-01cf58f5de45'
const questionnaire = await Questionnaire.get(id)

if (questionnaire) {
  await questionnaire.delete({ removeAnswers: true })
}
