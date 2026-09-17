/**
 * `CheckinModule` — check-in semanal por formulário web (achado 2026-09-13).
 *
 * Fronteira (§12.5): depende só do CORE (global), `JobsModule` e `ShortLinkModule`
 * (utilitário sem regra de negócio, não conta como import entre domínios). A reação da IA
 * ao check-in (comentário, ajuste de volume, sugestão de substituição) mora no `CoachModule`
 * — este módulo só persiste e enfileira (`QUEUE.checkinWeeklyFeedback`), nunca fala com
 * `LlmRouter`/`ValidationService` diretamente.
 */
import { Module } from '@nestjs/common';

import { JobsModule } from '../jobs/jobs.module';
import { ShortLinkModule } from '../short-link/short-link.module';
import { CheckinController } from './checkin.controller';
import { CheckinScheduler } from './checkin.scheduler';
import { CheckinService } from './checkin.service';

@Module({
  imports: [JobsModule, ShortLinkModule],
  controllers: [CheckinController],
  providers: [CheckinService, CheckinScheduler],
})
export class CheckinModule {}
