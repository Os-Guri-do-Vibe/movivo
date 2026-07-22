/**
 * Enums nativos do PostgreSQL usados pelas tabelas-base (TASK-0.4.1).
 *
 * ## Por que `CREATE TYPE ... AS ENUM` e não `VARCHAR + CHECK`
 * O DDL de referência de Rafael (§7.1) usa `VARCHAR` com `CHECK IN (...)`.
 * Optamos por enum nativo porque:
 *  1. o valor inválido é rejeitado no *parse* do literal, antes do plano de
 *     execução — a mensagem de erro nomeia o tipo e os valores válidos;
 *  2. ocupa 4 bytes, não o texto inteiro, em tabelas que vão a milhões de linhas
 *     (`conversations`, `ai_jobs`);
 *  3. o `drizzle-kit` gera `ALTER TYPE ... ADD VALUE` ao evoluir, em vez de um
 *     `ALTER TABLE ... DROP CONSTRAINT / ADD CONSTRAINT` que exige varredura completa.
 * O custo conhecido é a remoção de valor, que exige recriar o tipo. Nenhum dos
 * enums abaixo tem valor previsto para remoção.
 *
 * ## Fonte de verdade dos valores
 * Onde `@movivo/shared` já declara o enum (`ProtocolStatus`, `SubscriptionStatus`),
 * o tipo do banco é derivado **do pacote compartilhado**, não recopiado. Assim
 * backend, frontend e banco não podem divergir sem quebrar a compilação.
 */
import { ProtocolStatus, SubscriptionStatus } from '@movivo/shared';
import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * `pgEnum` exige uma tupla não-vazia; `Object.values` devolve `string[]`.
 * Este helper faz a ponte mantendo o valor em runtime idêntico ao do pacote
 * compartilhado — se um valor for adicionado lá, ele aparece aqui sozinho e o
 * `db:generate` acusa o diff.
 */
function valuesOf<T extends Record<string, string>>(source: T): [T[keyof T], ...T[keyof T][]] {
  const values = Object.values(source) as T[keyof T][];
  const [first, ...rest] = values;
  if (first === undefined) throw new Error('enum compartilhado sem valores');
  return [first, ...rest];
}

// ---------------------------------------------------------------------------
// USER
// ---------------------------------------------------------------------------

/**
 * Ciclo de vida do usuário (Rafael §7.1).
 * `ONBOARDING` = cadastrou-se e ainda não concluiu a anamnese; `TRIAL` = 7 dias
 * sem cartão (Eduardo, `07-relatorio-eduardo.md`); `CHURNED` = cancelou/expirou.
 */
export const userStatusEnum = pgEnum('user_status', [
  'ONBOARDING',
  'TRIAL',
  'ACTIVE',
  'CHURNED',
  'PAUSED',
]);

// ---------------------------------------------------------------------------
// ANAMNESE
// ---------------------------------------------------------------------------

/**
 * Estado da sessão de anamnese. O formulário é conversacional em 3 blocos com
 * salvamento de progresso (Lucas §MVP / Sofia), então `IN_PROGRESS` é o estado
 * normal e duradouro — não uma exceção.
 */
export const anamnesisStatusEnum = pgEnum('anamnesis_status', [
  'IN_PROGRESS',
  'SUBMITTED',
  'EXPIRED',
  'PROCESSED',
]);

// ---------------------------------------------------------------------------
// LGPD / CONSENTIMENTO
// ---------------------------------------------------------------------------

/**
 * Finalidades de tratamento consentidas separadamente (Alexandre,
 * `06-relatorio-alexandre.md`). `HEALTH_DATA` é o consentimento **específico e
 * destacado** exigido pelo Art. 11, II, "a" da LGPD para dado sensível de saúde:
 * ele não pode estar embutido no aceite genérico de `TERMS_OF_SERVICE`, e por
 * isso é um valor próprio e não uma flag dentro de outro consentimento.
 */
export const consentTypeEnum = pgEnum('consent_type', [
  'DATA_PROCESSING',
  'HEALTH_DATA',
  'MARKETING',
  'TERMS_OF_SERVICE',
]);

// ---------------------------------------------------------------------------
// PROTOCOLO
// ---------------------------------------------------------------------------

/**
 * Estados do protocolo, derivados de `@movivo/shared`.
 *
 * Divergência consciente do DDL de Rafael: ele lista também `ARCHIVED`, que o
 * enum compartilhado (US-0.1) não tem. Mantemos a paridade com `@movivo/shared`
 * — ter no banco um estado que o backend e o frontend não sabem representar é
 * pior que não tê-lo. Se `ARCHIVED` voltar a ser necessário, entra primeiro no
 * pacote compartilhado e o `db:generate` propaga o `ALTER TYPE` sozinho.
 */
export const protocolStatusEnum = pgEnum('protocol_status', valuesOf(ProtocolStatus));

// ---------------------------------------------------------------------------
// CONVERSA (WhatsApp)
// ---------------------------------------------------------------------------

/** Sentido da mensagem do ponto de vista da plataforma. */
export const messageDirectionEnum = pgEnum('message_direction', ['INBOUND', 'OUTBOUND']);

/** Tipo de mídia/mensagem da API do WhatsApp Business via AraraHQ. */
export const messageTypeEnum = pgEnum('message_type', [
  'TEXT',
  'IMAGE',
  'AUDIO',
  'TEMPLATE',
  'SYSTEM',
]);

// ---------------------------------------------------------------------------
// ASSINATURA
// ---------------------------------------------------------------------------

/**
 * Planos vigentes: **plano único por período** — Mensal R$39 / Trimestral R$99 /
 * Anual R$349 (Eduardo, `07-relatorio-eduardo.md`).
 *
 * Divergência consciente do DDL de Rafael: ele lista `BASICO`/`PRO`, tiering que
 * foi **explicitamente rejeitado** por Eduardo (retenção vem do compromisso de
 * período, não de gate de feature) e consolidado no `CLAUDE.md`. Modelar
 * `BASICO`/`PRO` no banco reintroduziria uma decisão de negócio já revertida.
 */
export const subscriptionPlanEnum = pgEnum('subscription_plan', ['MONTHLY', 'QUARTERLY', 'ANNUAL']);

/** Estados da assinatura, derivados de `@movivo/shared`. */
export const subscriptionStatusEnum = pgEnum('subscription_status', valuesOf(SubscriptionStatus));

/** Gateways suportados no MVP (Lucas §MVP). PIX recorrente automático é Fase 2. */
export const paymentProviderEnum = pgEnum('payment_provider', ['STRIPE', 'ASAAS']);

// ---------------------------------------------------------------------------
// JOBS DE IA
// ---------------------------------------------------------------------------

/** Naturezas de job de IA rastreadas para auditoria e custo (Rafael §7.1/§8.1). */
export const aiJobTypeEnum = pgEnum('ai_job_type', [
  'PROTOCOL_GENERATION',
  'AI_RESPONSE',
  'CHECKIN_ADJUSTMENT',
]);

/**
 * Ciclo de vida do job. `DLQ` é estado terminal explícito, e não um `FAILED` com
 * contador alto, porque o SLO de `<0,5% em DLQ` (`ARQUITETURA.md` §8) precisa ser
 * consultável com um predicado simples e indexável.
 */
export const aiJobStatusEnum = pgEnum('ai_job_status', [
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'DLQ',
]);
