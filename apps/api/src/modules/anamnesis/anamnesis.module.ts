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

import { ConsentController } from './consent.controller';
import { ConsentService } from './consent.service';

/**
 * US-1.2 preencheu a parte de CONSENT. O `ConsentService` fica aqui — e não num
 * `ConsentModule` próprio — porque consentimento e anamnese são o mesmo bounded
 * context (ONBOARDING & ANAMNESIS, `ARQUITETURA.md` §7) e um módulo separado
 * para dois arquivos seria estrutura sem função. `FormSessionService` e o gate
 * PAR-Q entram na US-1.3.
 */
@Module({
  controllers: [ConsentController],
  providers: [ConsentService],
  exports: [ConsentService],
})
export class AnamnesisModule {}
