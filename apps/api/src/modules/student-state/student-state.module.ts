import { Module } from '@nestjs/common';

import { JobsModule } from '../jobs/jobs.module';
import { CommitmentService } from './commitment.service';
import { MenstrualCycleService } from './menstrual-cycle.service';
import { ObservationService } from './observation.service';
import { OnboardingProjection } from './onboarding-projection';
import { OutreachService } from './outreach.service';
import { StudentMemoryService } from './student-memory.service';
import { StudentStateReader } from './student-state.reader';

/** Estado do Aluno: leitura em fatias para os agentes, projeção da anamnese e registro do ciclo. */
@Module({
  imports: [JobsModule],
  providers: [
    StudentStateReader,
    OnboardingProjection,
    MenstrualCycleService,
    StudentMemoryService,
    ObservationService,
    CommitmentService,
    OutreachService,
  ],
  exports: [
    StudentStateReader,
    OnboardingProjection,
    StudentMemoryService,
    ObservationService,
    CommitmentService,
    OutreachService,
  ],
})
export class StudentStateModule {}
