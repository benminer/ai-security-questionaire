import { answerQuestionBatch } from '@gemini'
import { CustomerType, QuestionnaireType } from '@models/questionnaire'

const questions = [
	'Products Description (please detail all available products)',
	'Pricing Model',
	'Provide any other standards, guidelines or framework your solution incorporates.'
]

const answers = await answerQuestionBatch({
	questions,
	type: QuestionnaireType.OTHER,
	customerType: CustomerType.OTHER
})
console.info(answers)
