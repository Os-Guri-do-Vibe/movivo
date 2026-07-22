/**
 * `AiCoachModule` — **esqueleto vazio registrado** (TASK-0.3.6).
 *
 * Módulo AI COACH do C4 nível 3 (`ARQUITETURA.md` §4). Nesta sprint é só a casca:
 * nenhuma lógica de negócio, nenhum controller, nenhum provider. Existe para que a
 * sprint de implementação (Sprint 4) encaixe código sem reestruturar o app.
 *
 * Conteúdo previsto pelo diagrama de Rafael:
 *  - `ContextService`
 *  - `LLMRouter`
 *  - `RAGService`
 *  - `ValidatorService`
 *
 * Regras que já valem para quem implementar:
 *  - LLM principal **GPT-4.1 (OpenAI)**, fallback **Claude Sonnet 4.5 (Anthropic)**, ambos com Zero Data Retention + DPA/SCC. **DeepSeek é proibido em qualquer fluxo** (ADR-005-R / §12.11).
 *  - Isolamento de contexto por titular é obrigatório: o contexto de conversa é montado sempre com `RedisKeyBuilder.forUser(userId, ...)`. Vazamento aqui é vazamento de dado de saúde.
 *  - Toda resposta passa pelo `ValidatorService` (compliance CREF + guardrails de linguagem) antes de sair. Resposta fora do escopo seguro ⇒ handoff para o profissional CREF.
 *
 * # Fronteira do módulo (regra §12.5 — sem imports circulares)
 * Este módulo pode depender do **CORE** (config, banco, Redis, logger) por DI, já que
 * todos os providers do CORE são globais. Não pode importar outro módulo de domínio:
 * a comunicação entre domínios é por evento (`EventBusModule`) ou por fila (`JobsModule`).
 */
import { Module } from '@nestjs/common';

@Module({})
export class AiCoachModule {}
