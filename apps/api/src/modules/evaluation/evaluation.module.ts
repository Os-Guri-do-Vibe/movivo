import { Module } from '@nestjs/common';

import { EvaluationService } from './evaluation.service';

/** Avaliação das tarefas de agente contra casos de referência (gate de qualidade e segurança). */
@Module({
  providers: [EvaluationService],
  exports: [EvaluationService],
})
export class EvaluationModule {}
