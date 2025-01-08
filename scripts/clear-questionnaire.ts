import { Questionnaire } from '@models'

const questionnaires = await Questionnaire.list()

await Promise.all(
  questionnaires.map(async (questionnaire) => {
    await questionnaire.delete({ removeAnswers: true, force: true })
  })
)

console.log('done')
