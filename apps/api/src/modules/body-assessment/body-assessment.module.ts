import { Module } from '@nestjs/common';

import { StudentStateModule } from '../student-state/student-state.module';
import { PhysiqueAssessmentService } from './physique-assessment.service';

/** Avaliação física por foto: a leitura inicial que alimenta o primeiro protocolo. */
@Module({
  imports: [StudentStateModule],
  providers: [PhysiqueAssessmentService],
  exports: [PhysiqueAssessmentService],
})
export class BodyAssessmentModule {}
