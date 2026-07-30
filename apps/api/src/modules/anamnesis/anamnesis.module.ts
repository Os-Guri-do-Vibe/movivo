/**
 * `AnamnesisModule` — **esqueleto vazio registrado** (TASK-0.3.6).
 *
 * Módulo ANAMNESIS do C4 nível 3 (`ARQUITETURA.md` §4). Nesta sprint é só a casca:
 * nenhuma lógica de negócio, nenhum controller, nenhum provider. Existe para que a
 * sprint de implementação (Sprint 2) encaixe código sem reestruturar o app.
 *
 * Conteúdo previsto pelo diagrama de Rafael:
 *  - `FormSessionService`
 *  - `ConsentService`
 *  - `PAR-Q Gate`
 *
 * Regras que já valem para quem implementar:
 *  - Todo dado coletado aqui é **dado pessoal sensível de saúde** (LGPD Art. 11): cifra com `pgcrypto` em repouso, RLS no acesso, consentimento explícito e granular registrado antes da coleta.
 *  - O **PAR-Q é um gate de segurança**, não um formulário: resposta positiva encaminha para o profissional CREF, nunca para a IA.
 *  - Guardrail de linguagem: nunca "diagnóstico", "tratamento" ou "cura" em nenhum texto deste módulo.
 *
 * # Fronteira do módulo (regra §12.5 — sem imports circulares)
 * Este módulo pode depender do **CORE** (config, banco, Redis, logger) por DI, já que
 * todos os providers do CORE são globais. Não pode importar outro módulo de domínio:
 * a comunicação entre domínios é por evento (`EventBusModule`) ou por fila (`JobsModule`).
 */
import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

import { JobsModule } from '../jobs/jobs.module';
import { AnamnesisController } from './anamnesis.controller';
import { AnamnesisService } from './anamnesis.service';
import { ConsentController } from './consent.controller';
import { ConsentService } from './consent.service';

/**
 * US-1.2 (CONSENT) e US-1.3 (FormSession + gate PAR-Q) vivem no mesmo bounded
 * context (ONBOARDING & ANAMNESIS, `ARQUITETURA.md` §7) — um módulo só, sem
 * imports circulares (consome apenas o CORE por DI).
 *
 * `ThrottlerModule` local: rate limit de 60 req/min por IP em todo `/anamnesis/*`
 * (Rafael §1217). ponytail: storage em memória (single-instance MVP); trocar por
 * storage Redis quando a API escalar horizontalmente.
 */
@Module({
  imports: [
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 60 }] }),
    // Fila `protocol-generation` (US-2.4): o submit é o gatilho do pipeline de protocolo.
    JobsModule,
  ],
  controllers: [ConsentController, AnamnesisController],
  providers: [ConsentService, AnamnesisService],
  exports: [ConsentService, AnamnesisService],
})
export class AnamnesisModule {}
