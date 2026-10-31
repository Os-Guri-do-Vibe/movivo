import { Module } from '@nestjs/common';

import { JobsModule } from '../jobs/jobs.module';
import { MenstrualCycleService } from './menstrual-cycle.service';
import { OnboardingProjection } from './onboarding-projection';
import { StudentStateReader } from './student-state.reader';

/** Estado do Aluno: leitura em fatias para os agentes, projeção da anamnese e registro do ciclo. */
@Module({
  imports: [JobsModule],
  providers: [StudentStateReader, OnboardingProjection, MenstrualCycleService],
  exports: [StudentStateReader, OnboardingProjection],
})
export class StudentStateModule {}
