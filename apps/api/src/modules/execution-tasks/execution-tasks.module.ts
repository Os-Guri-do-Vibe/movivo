import { Module, type OnModuleInit } from '@nestjs/common';

import { AgentTaskRegistry } from '../../core/agents/agent-task-registry';
import {
  answerCases,
  answerEvidenceCases,
  recipeCases,
  answerTask,
  classifyCases,
  classifyTask,
  riskCases,
  riskTask,
  specialistAnswerTasks,
  substituteCases,
  substituteTask,
} from '../conversation/tasks';
import { foodLogCases, foodLogChecks, foodLogTask } from '../nutrition/food-log-task';
import { commentExamCases, commentExamTask, readExamTask } from '../medical/exam-tasks';
import { habitsCases, habitsTask, recoveryCases, recoveryTask } from '../progress/analyst-tasks';
import { trainingFollowUpTask, trainingTalkTask } from '../progress/training-follow-up-tasks';
import { nutritionFollowUpTask, nutritionTalkTask } from '../progress/nutrition-follow-up-tasks';
import { cycleReviewTask, cycleWrapUpTask } from '../reassessment/reassessment-tasks';
import { photoComparisonTask } from '../reassessment/photo-tasks';
import { memoryCurationTask } from '../progress/memory-tasks';
import { followUpCases } from '../progress/follow-up-cases';
import { qualityReviewTask } from '../progress/message-quality-tasks';
import {
  commitmentNudgeTask,
  reengagementMessageTask,
  reengagementPlanTask,
  trackingGapTask,
} from '../progress/reengagement-tasks';
import { missedSessionMessageTask, missedSessionPlanTask } from '../progress/missed-session-tasks';
import { painAssessmentTask, painGuidanceTask } from '../progress/pain-tasks';
import {
  enduranceReviewTask,
  strengthReviewTask,
  workoutFeedbackTask,
} from '../progress/workout-feedback-tasks';
import { preferencesCases, preferencesTask, reviewCases, reviewTask } from '../progress/tasks';
import { screenshotCases } from '../vision/vision-cases';
import { imageKindTask, mealPhotoTask, workoutScreenshotTask } from '../vision/vision-tasks';
import { foodLogAckTask } from '../nutrition/food-chat-tasks';
import { mealAdaptTask } from '../nutrition/meal-adapt-task';
import {
  specialistTalkTask,
  trainingDailyTask,
  wellbeingDailyTask,
} from '../progress/daily-specialists-tasks';
import {
  dayReviewTask,
  loggingGapMessageTask,
  loggingGapPlanTask,
  mealReminderTask,
} from '../progress/meal-routine-tasks';

/**
 * Catálogo das tarefas do dia a dia do aluno (leitura de print de treino, foto e texto de
 * refeição, classificação e resposta de conversa, sentinela de texto, revisão semanal e preferências), com os casos de avaliação. Sem workers nem controladores: a aplicação e a linha de
 * comando de avaliação registram as MESMAS tarefas.
 */
@Module({})
export class ExecutionTasksModule implements OnModuleInit {
  constructor(private readonly registry: AgentTaskRegistry) {}

  onModuleInit(): void {
    this.registry.register(workoutScreenshotTask, screenshotCases);
    this.registry.register(mealPhotoTask, []);
    this.registry.register(imageKindTask, []);
    this.registry.register(mealAdaptTask, []);
    this.registry.register(foodLogAckTask, []);
    this.registry.register(mealReminderTask, []);
    this.registry.register(dayReviewTask, []);
    this.registry.register(trainingDailyTask, followUpCases[trainingDailyTask.id] ?? []);
    this.registry.register(wellbeingDailyTask, []);
    this.registry.register(specialistTalkTask, []);
    this.registry.register(loggingGapPlanTask, []);
    this.registry.register(loggingGapMessageTask, []);
    this.registry.register(foodLogTask, foodLogCases, foodLogChecks);
    this.registry.register(classifyTask, classifyCases);
    this.registry.register(answerTask, [...answerCases, ...answerEvidenceCases]);
    for (const task of Object.values(specialistAnswerTasks)) {
      this.registry.register(task, task === specialistAnswerTasks.NUTRITION ? recipeCases : []);
    }
    this.registry.register(substituteTask, substituteCases);
    this.registry.register(riskTask, riskCases);
    this.registry.register(reviewTask, reviewCases);
    this.registry.register(preferencesTask, preferencesCases);
    this.registry.register(recoveryTask, recoveryCases);
    this.registry.register(habitsTask, habitsCases);
    this.registry.register(painAssessmentTask, []);
    this.registry.register(painGuidanceTask, []);
    this.registry.register(strengthReviewTask, []);
    this.registry.register(enduranceReviewTask, []);
    this.registry.register(workoutFeedbackTask, []);
    this.registry.register(missedSessionPlanTask, []);
    this.registry.register(missedSessionMessageTask, []);
    this.registry.register(memoryCurationTask, []);
    this.registry.register(reengagementPlanTask, followUpCases[reengagementPlanTask.id] ?? []);
    this.registry.register(reengagementMessageTask, []);
    this.registry.register(commitmentNudgeTask, []);
    this.registry.register(trackingGapTask, followUpCases[trackingGapTask.id] ?? []);
    this.registry.register(qualityReviewTask, []);
    this.registry.register(photoComparisonTask, []);
    this.registry.register(cycleReviewTask, []);
    this.registry.register(cycleWrapUpTask, []);
    this.registry.register(nutritionFollowUpTask, followUpCases[nutritionFollowUpTask.id] ?? []);
    this.registry.register(trainingFollowUpTask, followUpCases[trainingFollowUpTask.id] ?? []);
    this.registry.register(trainingTalkTask, []);
    this.registry.register(nutritionTalkTask, []);
    this.registry.register(readExamTask, []);
    this.registry.register(commentExamTask, commentExamCases);
  }
}
