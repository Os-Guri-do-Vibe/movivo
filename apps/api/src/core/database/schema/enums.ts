/**
 * Enums nativos do PostgreSQL usados pelas tabelas-base (TASK-0.4.1).
 *
 * ## Por que `CREATE TYPE ... AS ENUM` e não `VARCHAR + CHECK`
 * O DDL de referência de Rafael (§7.1) usa `VARCHAR` com `CHECK IN (...)`.
 * Optamos por enum nativo porque:
 *  1. o valor inválido é rejeitado no *parse* do literal, antes do plano de
 *     execução — a mensagem de erro nomeia o tipo e os valores válidos;
 *  2. ocupa 4 bytes, não o texto inteiro, em tabelas que vão a milhões de linhas
 *     (`conversations`, `model_runs`);
 *  3. o `drizzle-kit` gera `ALTER TYPE ... ADD VALUE` ao evoluir, em vez de um
 *     `ALTER TABLE ... DROP CONSTRAINT / ADD CONSTRAINT` que exige varredura completa.
 * O custo conhecido é a remoção de valor, que exige recriar o tipo. Nenhum dos
 * enums abaixo tem valor previsto para remoção.
 *
 * ## Fonte de verdade dos valores
 * Onde `@movivo/shared` já declara o enum (`SubscriptionStatus`, `ParqState`),
 * o tipo do banco é derivado **do pacote compartilhado**, não recopiado. Assim
 * backend, frontend e banco não podem divergir sem quebrar a compilação.
 */
import { type BiologicalSex, ParqState, SubscriptionStatus } from '@movivo/shared';
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
 * Sexo biológico — parâmetro técnico de prescrição (Alexandre §5.7: **não** é dado
 * sensível de saúde do Art. 11, é dado pessoal comum).
 *
 * Vive como coluna própria em `users.biological_sex` porque o planejamento (energia e
 * referências) o lê a cada geração de plano, e ler o jsonb da anamnese seria um JOIN + parse.
 *
 * O nome dos valores é o do enum compartilhado (`biologicalSexSchema`); o `satisfies`
 * abaixo quebra a compilação se o pacote compartilhado ganhar um valor novo que o banco
 * não conheça — que é exatamente o modo de falha que este arquivo existe para evitar.
 */
const BIOLOGICAL_SEX = {
  MALE: 'MALE',
  FEMALE: 'FEMALE',
} as const satisfies Record<BiologicalSex, BiologicalSex>;

export const biologicalSexEnum = pgEnum('biological_sex', valuesOf(BIOLOGICAL_SEX));

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

/**
 * Papel de autorização (RBAC — Sato §9.2 / US-1.4).
 *
 * `USER` é o titular final: no MVP ele **não** se autentica (acessa pelo WhatsApp
 * e o formulário por token — ADR-006), então nasce sem `password_hash`. Os papéis
 * internos acessam apenas os setores autorizados do Control Center; `PROFESSIONAL`
 * continua representando exclusivamente o profissional CREF.
 *
 * O valor também alimenta o GUC `app.current_role` das políticas RLS (Sato §4.3):
 * é por ele que a policy do profissional/admin difere da do titular. Os contextos
 * de sistema (`SYSTEM`) e anônimo (`ANONYMOUS`) usados no `TenantDatabase` **não**
 * são papéis de usuário — vivem só no GUC de sessão, nunca nesta coluna.
 */
export const userRoleEnum = pgEnum('user_role', [
  'USER',
  'PROFESSIONAL',
  'ADMIN',
  'MARKETING',
  'FINANCE',
  'SUPPORT',
  'ENGINEERING',
  'DPO',
]);

/**
 * Papel de autorização da conta interna (tabela `staff`) — os mesmos 7 papéis
 * não-`USER` de `userRoleEnum` acima, agora só na tabela que representa quem
 * loga em `/entrar` (nunca o titular final).
 */
export const staffRoleEnum = pgEnum('staff_role', [
  'PROFESSIONAL',
  'ADMIN',
  'MARKETING',
  'FINANCE',
  'SUPPORT',
  'ENGINEERING',
  'DPO',
]);

/** Ciclo de vida da conta interna — bem mais simples que o do titular (sem trial/churn). */
export const staffStatusEnum = pgEnum('staff_status', ['ACTIVE', 'INACTIVE', 'SUSPENDED']);

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

/**
 * Estado do gate PAR-Q (US-1.3 / Alexandre §2), derivado de `@movivo/shared`.
 * `BLOQUEADO_AGUARDANDO_CLEARANCE` é a trava real: impede geração automática de
 * protocolo (Sprint 2). Nulo enquanto a sessão não foi submetida.
 */
export const parqStateEnum = pgEnum('parq_state', valuesOf(ParqState));

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
  // Sprint 6 (Alexandre §5.4/§5.8): ciência do uso de IA com supervisão CREF. NÃO é
  // consentimento (é dever de informação, art. 6º VI), mas usa o mesmo mecanismo de
  // prova — versão + IP/UA + carimbo. **Não é revogável**: ver `ConsentService.revoke`.
  // `WHATSAPP_OPERATIONAL_NOTICE` NÃO entra aqui: é aviso, não aceite (§5.2).
  'AI_DISCLOSURE',
]);

// ---------------------------------------------------------------------------
// CONVERSA (WhatsApp)
// ---------------------------------------------------------------------------

/** Sentido da mensagem do ponto de vista da plataforma. */
export const messageDirectionEnum = pgEnum('message_direction', ['INBOUND', 'OUTBOUND']);

/** Tipo de mídia/mensagem do canal WhatsApp. */
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
 * Planos vigentes: **plano único por período** — Mensal, Trimestral, Semestral e Anual.
 * Os valores vivem exclusivamente no catálogo compartilhado, não neste enum.
 *
 * Divergência consciente do DDL de Rafael: ele lista `BASICO`/`PRO`, tiering que
 * foi **explicitamente rejeitado** por Eduardo (retenção vem do compromisso de
 * período, não de gate de feature) e consolidado no `CLAUDE.md`. Modelar
 * `BASICO`/`PRO` no banco reintroduziria uma decisão de negócio já revertida.
 */
// `SEMIANNUAL` acrescentado no fim (decisão do fundador 2026-08-01: 4 planos no MVP) —
// append evita reordenar os valores existentes, gerando um `ALTER TYPE ADD VALUE` limpo.
export const subscriptionPlanEnum = pgEnum('subscription_plan', [
  'MONTHLY',
  'QUARTERLY',
  'ANNUAL',
  'SEMIANNUAL',
]);

/** Estados da assinatura, derivados de `@movivo/shared`. */
export const subscriptionStatusEnum = pgEnum('subscription_status', valuesOf(SubscriptionStatus));

/** Gateways suportados no MVP (Lucas §MVP). PIX recorrente automático é Fase 2. */
export const paymentProviderEnum = pgEnum('payment_provider', ['STRIPE', 'ASAAS']);

// ---------------------------------------------------------------------------
// CICLO DE VIDA DO ALUNO (US-8.3)
// ---------------------------------------------------------------------------

/**
 * Marcos do ciclo de vida gravados em `user_status_transitions` (US-8.3).
 *
 * Não é um espelho de `subscription_status`: é a **sequência de eventos** que o
 * funil e a coorte precisam ler. `ACTIVE` sozinho não distingue "converteu do
 * trial", "voltou da pausa" e "renovou" — três números diferentes na planilha do
 * CFO. A derivação de (status anterior → status novo) para o marco vive em
 * `subscription-lifecycle.ts`, em um ponto só.
 */
export const userLifecycleStatusEnum = pgEnum('user_lifecycle_status', [
  'TRIAL_STARTED',
  'CONVERTED',
  'RENEWED',
  'PAUSED',
  'RESUMED',
  'CANCELED',
]);

/**
 * Quem originou a transição. `BACKFILL` marca dado **reconstruído** a partir das
 * datas de `subscriptions`, nunca observado — uma coorte montada sobre reconstrução
 * tem que se declarar como tal (US-8.3, TASK-8.3.3).
 */
export const statusTransitionActorEnum = pgEnum('status_transition_actor', [
  'SYSTEM',
  'USER',
  'PROFESSIONAL',
  'BACKFILL',
]);
