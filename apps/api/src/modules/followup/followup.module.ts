/**
 * `FollowupModule` — pendências de conversa do Coach (perguntas que esperam resposta).
 *
 * Sem LLM e sem dependência de outro domínio: só o CORE (global). Importado por quem cria a
 * pergunta (`WorkoutModule`), por quem confirma ou cancela o envio (`WhatsappModule`) e por
 * quem a lê e resolve ao responder o aluno (`CoachModule`). A fronteira §12.5 fica intacta:
 * o módulo de WhatsApp continua sem falar com o LLM.
 */
import { Module } from '@nestjs/common';

import { FollowupService } from './followup.service';

@Module({
  providers: [FollowupService],
  exports: [FollowupService],
})
export class FollowupModule {}
