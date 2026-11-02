import type { CompanionExpression } from '../../components/Companion'
import type { TaskMood } from '../tasks/domain'

const visualExpressionByMood: Record<TaskMood, CompanionExpression> = {
  calm: 'calm',
  alert: 'alert',
  anxious: 'anxious',
  panic: 'panic',
  late: 'late',
  happy: 'happy',
}

export function getCompanionExpression(mood: TaskMood): CompanionExpression {
  return visualExpressionByMood[mood]
}
