import { Module } from '@nestjs/common';

import { CoachingModule } from '../coaching/coaching.module';
import { JobsModule } from '../jobs/jobs.module';
import { StudentStateModule } from '../student-state/student-state.module';
import { MedicalExamService } from './medical-exam.service';

/** Medicina: exames enviados no WhatsApp, lidos e comentados sob supervisão do médico (CRM). */
@Module({
  imports: [CoachingModule, JobsModule, StudentStateModule],
  providers: [MedicalExamService],
})
export class MedicalModule {}
