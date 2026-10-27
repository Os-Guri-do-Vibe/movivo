import { Module } from '@nestjs/common';

import { PublishedMethodologyModule } from '../methodology/published-methodology.module';
import { EvaluationService } from './evaluation.service';

/** Avaliação das tarefas de agente contra casos de referência (gate de qualidade e segurança). */
@Module({
  imports: [PublishedMethodologyModule],
  providers: [EvaluationService],
  exports: [EvaluationService],
})
export class EvaluationModule {}
