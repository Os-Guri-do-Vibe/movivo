import { Module } from '@nestjs/common';

import { OnboardingProjection } from './onboarding-projection';
import { StudentStateReader } from './student-state.reader';

/** Estado do Aluno: leitura em fatias para os agentes e projeção da anamnese. */
@Module({
  providers: [StudentStateReader, OnboardingProjection],
  exports: [StudentStateReader, OnboardingProjection],
})
export class StudentStateModule {}
