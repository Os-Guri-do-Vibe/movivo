/**
 * Catálogo do painel "Sistema → Scripts": toda rotina agendada e todo script do repositório.
 *
 * Três famílias:
 *  - `CRON`: varreduras agendadas no BullMQ (`upsertJobScheduler`). O botão enfileira um job
 *    extra na MESMA fila, com `force: true` — o agendamento padrão não é tocado.
 *  - `ROUTINE`: rotinas internas (timer em memória ou acionamento manual) que rodam dentro
 *    do processo da API; o botão executa na hora.
 *  - `TERMINAL`: scripts de linha de comando (precisam de argumento, acesso à VPS/Docker ou
 *    são destrutivos). Ficam listados para o mapa ser completo, mas NÃO executam pelo painel.
 *
 * `system-scripts.catalog.spec.ts` falha se surgir um cron ou script novo fora desta lista.
 */
import { QUEUE, type QueueName } from '../jobs/jobs.config';

interface ScriptBase {
  id: string;
  name: string;
  description: string;
}

export interface CronScript extends ScriptBase {
  kind: 'CRON';
  /** Fila BullMQ do scheduler e o `schedulerId` passado a `upsertJobScheduler`. */
  queue: QueueName;
  schedulerId: string;
  /** Padrão cron + fuso, como registrado no scheduler (usado pelo teste de deriva). */
  cron: string;
  schedule: string;
  runEffect: string;
  /** Rótulo de cada campo do retorno do scan, para o resumo da última execução. */
  resultLabels: Readonly<Record<string, string>>;
}

export interface RoutineScript extends ScriptBase {
  kind: 'ROUTINE';
  schedule: string | null;
  runEffect: string;
}

export interface TerminalScript extends ScriptBase {
  kind: 'TERMINAL';
  /** Caminho relativo à raiz do repositório. */
  file: string;
  command: string;
  notRunnableReason: string;
}

export type ScriptDefinition = CronScript | RoutineScript | TerminalScript;

export const CRON_SCRIPTS: readonly CronScript[] = [
  {
    id: 'workout-daily-scan',
    kind: 'CRON',
    name: 'Link diário de treino',
    description:
      'Envia por WhatsApp o link do treino do dia a cada aluno com protocolo ativo. Quando o último treino previsto ficou sem registro, a mesma mensagem leva uma pergunta curta sobre ele (no máximo 2 por semana, nunca em dias seguidos), em um balão separado. No mesmo horário, abre o alerta para o profissional CREF de quem faltou à 3ª sessão seguida ou a mais de 60% das sessões. A varredura roda a cada minuto e dispara às 04:00 do fuso de cada aluno.',
    queue: QUEUE.workoutDaily,
    schedulerId: 'daily-workout-scan',
    cron: '* * * * * (UTC)',
    schedule: 'Todo dia às 04:00 (fuso de cada aluno)',
    runEffect:
      'Enfileira agora o envio do link de treino de hoje aos alunos elegíveis que ainda não o receberam hoje. Quem já recebeu não recebe de novo. A entrega em si acontece na fila do WhatsApp.',
    resultLabels: {
      eligible: 'elegíveis',
      sent: 'na fila de envio',
      asked: 'com a pergunta sobre o treino sem registro',
      alerted: 'alertas de frequência abertos',
    },
  },
  {
    id: 'checkin-weekly-scan',
    kind: 'CRON',
    name: 'Check-in semanal',
    description:
      'Convida o aluno por WhatsApp a responder o check-in da semana, que ajusta o protocolo. A varredura roda a cada minuto e dispara no domingo, no horário do fuso de cada aluno.',
    queue: QUEUE.checkinWeekly,
    schedulerId: 'weekly-checkin-scan',
    cron: '* * * * * (UTC)',
    schedule: 'Domingo às 18:00 (fuso de cada aluno)',
    runEffect:
      'Enfileira agora o convite de check-in aos alunos elegíveis que ainda não têm o check-in desta semana. Quem já foi convidado não recebe outro. A entrega em si acontece na fila do WhatsApp.',
    resultLabels: { eligible: 'elegíveis', sent: 'na fila de envio' },
  },
  {
    id: 'protocol-renewal-scan',
    kind: 'CRON',
    name: 'Renovação de mesociclo',
    description:
      'Detecta protocolos com mesociclo vencido e envia o convite para o formulário de renovação. Reenvia o convite quando o anterior expirou.',
    queue: QUEUE.protocolRenewalScan,
    schedulerId: 'protocol-renewal-scan',
    cron: '0 9 * * * (America/Sao_Paulo)',
    schedule: 'Todo dia às 09:00 (Brasília)',
    runEffect:
      'Varre agora os protocolos vencidos e envia o convite de renovação a quem ainda não tem um convite válido.',
    resultLabels: { created: 'convites na fila de envio' },
  },
  {
    id: 'subscription-period-scan',
    kind: 'CRON',
    name: 'Encerramento de período pago',
    description:
      'Leva a EXPIRED as assinaturas ACTIVE cujo período pago terminou sem renovação e avisa o aluno por WhatsApp com os links de renovação e cancelamento.',
    queue: QUEUE.subscriptionPeriodScan,
    schedulerId: 'subscription-period-scan',
    cron: '5 * * * * (America/Sao_Paulo)',
    schedule: 'Toda hora, no minuto 5 (Brasília)',
    runEffect:
      'Varre agora as assinaturas com período vencido, encerra o acesso de quem não renovou e envia o aviso de fim de plano.',
    resultLabels: { expired: 'encerradas' },
  },
];

export const ROUTINE_SCRIPTS: readonly RoutineScript[] = [
  {
    id: 'finance-recurring-expenses',
    kind: 'ROUTINE',
    name: 'Despesas recorrentes',
    description:
      'Materializa no livro-caixa uma linha por período de cada despesa recorrente (mensal, trimestral, anual) até hoje. Sem agendamento: só roda quando acionada.',
    schedule: null,
    runEffect:
      'Cria no livro-caixa as despesas recorrentes que ainda não foram lançadas. É idempotente: rodar de novo não duplica lançamento.',
  },
  {
    id: 'exercise-catalog-refresh',
    kind: 'ROUTINE',
    name: 'Atualização do catálogo de exercícios',
    description:
      'Recarrega do banco o catálogo de exercícios usado pela geração e pela validação de protocolos.',
    schedule: 'A cada 5 minutos (timer interno da API)',
    runEffect: 'Recarrega agora o catálogo de exercícios em memória. Não envia mensagem a ninguém.',
  },
];

const OPERATOR_ONLY =
  'Exige argumento, acesso à VPS/Docker ou é uma operação pontual — só no terminal.';
const ARGUMENT_REQUIRED = 'Exige um argumento (telefone, e-mail ou ID) — só no terminal.';

export const TERMINAL_SCRIPTS: readonly TerminalScript[] = [
  {
    id: 'check-protocol-queue-state',
    kind: 'TERMINAL',
    name: 'Estado do protocolo na fila',
    description:
      'Leitura pontual: mostra status, aprovação e urgência de revisão do protocolo de um aluno.',
    file: 'apps/api/src/scripts/check-protocol-queue-state.ts',
    command: 'node --enable-source-maps dist/scripts/check-protocol-queue-state.js <telefone>',
    notRunnableReason: ARGUMENT_REQUIRED,
  },
  {
    id: 'diagnose-protocol-fallback',
    kind: 'TERMINAL',
    name: 'Investigar protocolo em fallback',
    description:
      'Reexecuta a geração de protocolo de um aluno, sem gravar, para explicar por que caiu no template de fallback.',
    file: 'apps/api/src/scripts/diagnose-protocol-fallback.ts',
    command: 'node --enable-source-maps dist/scripts/diagnose-protocol-fallback.js <telefone>',
    notRunnableReason: ARGUMENT_REQUIRED,
  },
  {
    id: 'enqueue-protocol-auto-release',
    kind: 'TERMINAL',
    name: 'Reenfileirar liberação automática',
    description:
      'Enfileira o job de liberação automática que faltou para um protocolo de revisão opcional.',
    file: 'apps/api/src/scripts/enqueue-protocol-auto-release.ts',
    command: 'node --enable-source-maps dist/scripts/enqueue-protocol-auto-release.js <telefone>',
    notRunnableReason: ARGUMENT_REQUIRED,
  },
  {
    id: 'generate-workout-magic-link',
    kind: 'TERMINAL',
    name: 'Gerar link mágico de treino',
    description:
      'Gera o link de acesso ao treino de um aluno sem esperar o envio diário (teste manual).',
    file: 'apps/api/src/scripts/generate-workout-magic-link.ts',
    command: 'pnpm exec tsx src/scripts/generate-workout-magic-link.ts <telefone>',
    notRunnableReason: ARGUMENT_REQUIRED,
  },
  {
    id: 'redteam-prompt-injection',
    kind: 'TERMINAL',
    name: 'Red team de prompt injection',
    description:
      'Ataca o modelo real com casos de injeção de prompt (dados sintéticos) e mede a taxa de aprovação. Consome tokens.',
    file: 'apps/api/src/scripts/redteam-prompt-injection.ts',
    command: 'REDTEAM_PROVIDER=openai pnpm exec tsx src/scripts/redteam-prompt-injection.ts',
    notRunnableReason: 'Consome tokens do provedor e exige chave no ambiente — só no terminal.',
  },
  {
    id: 'eval-agenda',
    kind: 'TERMINAL',
    name: 'Avaliação da agenda flexível',
    description:
      'Roda 50 frases de aluno (dados sintéticos) pelo leitor de pedidos de agenda e pelo classificador de intenção, com o modelo real, e mede o acerto. Consome tokens.',
    file: 'apps/api/src/scripts/eval-agenda.ts',
    command: 'EVAL_PROVIDER=deepseek pnpm exec tsx src/scripts/eval-agenda.ts',
    notRunnableReason: 'Consome tokens do provedor e exige chave no ambiente — só no terminal.',
  },
  {
    id: 'reenqueue-blocked-parq',
    kind: 'TERMINAL',
    name: 'Reenfileirar PAR-Q bloqueado',
    description:
      'Migração única: reenfileira a geração de protocolo dos alunos presos no antigo gate de PAR-Q. Aceita --dry-run.',
    file: 'apps/api/src/scripts/reenqueue-blocked-parq.ts',
    command: 'pnpm exec tsx src/scripts/reenqueue-blocked-parq.ts --dry-run',
    notRunnableReason: OPERATOR_ONLY,
  },
  {
    id: 'render-sample-pdf',
    kind: 'TERMINAL',
    name: 'PDF de amostra do protocolo',
    description: 'Gera um PDF de protocolo de exemplo para conferir mudanças visuais.',
    file: 'apps/api/src/scripts/render-sample-pdf.ts',
    command: 'pnpm exec tsx src/scripts/render-sample-pdf.ts <saida.pdf>',
    notRunnableReason: 'Grava um arquivo local — só no terminal.',
  },
  {
    id: 'reprocess-protocol-fallback',
    kind: 'TERMINAL',
    name: 'Reprocessar protocolo em fallback',
    description:
      'Regera o conteúdo de um protocolo que nasceu como fallback e ainda não foi assinado. Segue pendente de assinatura CREF.',
    file: 'apps/api/src/scripts/reprocess-protocol-fallback.ts',
    command: 'node --enable-source-maps dist/scripts/reprocess-protocol-fallback.js <telefone>',
    notRunnableReason: ARGUMENT_REQUIRED,
  },
  {
    id: 'resend-protocol-delivery',
    kind: 'TERMINAL',
    name: 'Reenviar entrega do protocolo',
    description: 'Reenvia por WhatsApp a entrega do protocolo ativo de um aluno.',
    file: 'apps/api/src/scripts/resend-protocol-delivery.ts',
    command: 'pnpm exec tsx src/scripts/resend-protocol-delivery.ts <telefone>',
    notRunnableReason: ARGUMENT_REQUIRED,
  },
  {
    id: 'reset-staff-mfa',
    kind: 'TERMINAL',
    name: 'Zerar MFA de conta interna',
    description:
      'Remove o segundo fator de uma conta interna e revoga as sessões dela. Exige confirmar a identidade da pessoa fora do sistema.',
    file: 'apps/api/src/scripts/reset-staff-mfa.ts',
    command:
      'cd /opt/movivo && docker compose run --rm migrate node dist/scripts/reset-staff-mfa.js <email>',
    notRunnableReason: 'Recuperação de acesso: por desenho, não existe caminho pela interface.',
  },
  {
    id: 'rotate-health-cipher',
    kind: 'TERMINAL',
    name: 'Rotacionar cifra de dados de saúde',
    description:
      'Decifra e verifica (padrão) ou recifra com a chave ativa (--apply) os campos de saúde. Preservar backup e chaves antigas.',
    file: 'apps/api/src/scripts/rotate-health-cipher.ts',
    command: 'pnpm exec tsx src/scripts/rotate-health-cipher.ts --apply --actor=<uuid>',
    notRunnableReason: 'Manutenção de chaves de criptografia — só no terminal, com backup.',
  },
  {
    id: 'db-migrate',
    kind: 'TERMINAL',
    name: 'Migrações do banco',
    description: 'Aplica as migrações Drizzle pendentes pela conexão de migração.',
    file: 'apps/api/src/core/database/migrate.ts',
    command: 'pnpm --filter @movivo/api db:migrate',
    notRunnableReason: OPERATOR_ONLY,
  },
  {
    id: 'db-seed',
    kind: 'TERMINAL',
    name: 'Seed do banco',
    description: 'Popula o banco com os dados-base (papéis, catálogo, configurações).',
    file: 'apps/api/src/core/database/seed.ts',
    command: 'pnpm --filter @movivo/api db:seed',
    notRunnableReason: OPERATOR_ONLY,
  },
  {
    id: 'db-seed-workout-demo',
    kind: 'TERMINAL',
    name: 'Seed de treino de demonstração',
    description: 'Cria um aluno e um treino de demonstração para testar o diário de treino.',
    file: 'apps/api/src/core/database/seed-workout-demo.ts',
    command: 'pnpm --filter @movivo/api db:seed:workout',
    notRunnableReason: 'Cria dados de demonstração — só em ambiente local.',
  },
  {
    id: 'db-backfill-transitions',
    kind: 'TERMINAL',
    name: 'Backfill de transições de status',
    description:
      'Reconstrói os marcos passados de assinatura em user_status_transitions (actor BACKFILL). Idempotente.',
    file: 'apps/api/src/core/database/backfill-status-transitions.ts',
    command: 'pnpm --filter @movivo/api db:backfill-transitions',
    notRunnableReason: OPERATOR_ONLY,
  },
  {
    id: 'build-share-card-assets',
    kind: 'TERMINAL',
    name: 'Regerar assets do card de compartilhamento',
    description:
      'Regera as máscaras e ilustrações musculares do card de treino quando a biblioteca de origem muda.',
    file: 'apps/api/scripts/build-share-card-assets.mjs',
    command: 'node apps/api/scripts/build-share-card-assets.mjs',
    notRunnableReason: 'Grava arquivos no repositório — só no terminal.',
  },
  {
    id: 'build-web',
    kind: 'TERMINAL',
    name: 'Build do site',
    description: 'Compila o app web injetando as variáveis públicas NEXT_PUBLIC_*.',
    file: 'scripts/build-web.mjs',
    command: 'node scripts/build-web.mjs',
    notRunnableReason: OPERATOR_ONLY,
  },
  {
    id: 'gen-local-secrets-sh',
    kind: 'TERMINAL',
    name: 'Gerar secrets locais (bash)',
    description: 'Gera os Docker Secrets do ambiente local.',
    file: 'scripts/gen-local-secrets.sh',
    command: 'pnpm run infra:secrets',
    notRunnableReason: OPERATOR_ONLY,
  },
  {
    id: 'gen-local-secrets-ps1',
    kind: 'TERMINAL',
    name: 'Gerar secrets locais (PowerShell)',
    description: 'Versão Windows do gerador de Docker Secrets do ambiente local.',
    file: 'scripts/gen-local-secrets.ps1',
    command: 'pwsh scripts/gen-local-secrets.ps1',
    notRunnableReason: OPERATOR_ONLY,
  },
  {
    id: 'infra',
    kind: 'TERMINAL',
    name: 'Atalhos da infraestrutura local',
    description:
      'Atalhos interativos: psql, pools, redis-cli, sentinel e status da base de conhecimento.',
    file: 'scripts/infra.sh',
    command: 'bash scripts/infra.sh <psql|psql-admin|pools|redis-cli|sentinel|knowledge-status>',
    notRunnableReason: OPERATOR_ONLY,
  },
  {
    id: 'provision-security',
    kind: 'TERMINAL',
    name: 'Provisionar segurança',
    description:
      'Provisiona de forma idempotente segredos, certificados internos e o Vault do ambiente.',
    file: 'scripts/provision-security.py',
    command: 'python3 scripts/provision-security.py --environment local',
    notRunnableReason: OPERATOR_ONLY,
  },
  {
    id: 'renew-security-certificates',
    kind: 'TERMINAL',
    name: 'Renovar certificados internos',
    description:
      'Renova os certificados internos quando entram na janela de 30 dias e recria os serviços afetados.',
    file: 'scripts/renew-security-certificates.sh',
    command: 'APP_DIR=/opt/movivo bash renew-security-certificates.sh',
    notRunnableReason: 'Recria serviços de produção — só na VPS.',
  },
  {
    id: 'setup-branch-protection',
    kind: 'TERMINAL',
    name: 'Proteção da branch main',
    description: 'Configura a branch protection da main no GitHub.',
    file: 'scripts/setup-branch-protection.sh',
    command: 'bash scripts/setup-branch-protection.sh',
    notRunnableReason: OPERATOR_ONLY,
  },
  {
    id: 'start-local',
    kind: 'TERMINAL',
    name: 'Subir o ambiente local',
    description: 'Provisiona a segurança local e sobe toda a stack Docker.',
    file: 'scripts/start-local.sh',
    command: 'pnpm run infra:up',
    notRunnableReason: OPERATOR_ONLY,
  },
  {
    id: 'unlock-vps-storage',
    kind: 'TERMINAL',
    name: 'Destravar o armazenamento da VPS',
    description:
      'Abre o volume criptografado da VPS após reinício e sobe o Vault e a stack de produção.',
    file: 'scripts/unlock-vps-storage.sh',
    command: 'bash scripts/unlock-vps-storage.sh',
    notRunnableReason: 'Usa a chave de armazenamento do operador — só na estação do operador.',
  },
  {
    id: 'verify-access-links',
    kind: 'TERMINAL',
    name: 'Verificar links de acesso',
    description: 'Teste de segurança dos links de acesso, apenas contra PostgreSQL descartável.',
    file: 'scripts/verify-access-links.mjs',
    command: 'node scripts/verify-access-links.mjs',
    notRunnableReason: 'Só contra banco descartável de teste.',
  },
  {
    id: 'verify-infra',
    kind: 'TERMINAL',
    name: 'Verificar infraestrutura local',
    description: 'Checagem da definição de pronto do ambiente local.',
    file: 'scripts/verify-infra.sh',
    command: 'pnpm run infra:verify',
    notRunnableReason: OPERATOR_ONLY,
  },
  {
    id: 'verify-knowledge-infra',
    kind: 'TERMINAL',
    name: 'Verificar infraestrutura da base de conhecimento',
    description: 'Verifica o contrato operacional da base de conhecimento (config ou runtime).',
    file: 'scripts/verify-knowledge-infra.sh',
    command: 'pnpm run infra:knowledge:verify',
    notRunnableReason: OPERATOR_ONLY,
  },
  {
    id: 'verify-nginx-logs',
    kind: 'TERMINAL',
    name: 'Verificar sanitização dos logs do Nginx',
    description: 'Autoteste: garante que segredo arbitrário não atravessa o coletor de logs.',
    file: 'scripts/verify-nginx-logs.py',
    command: 'python3 scripts/verify-nginx-logs.py',
    notRunnableReason: OPERATOR_ONLY,
  },
  {
    id: 'verify-provider-secret-update',
    kind: 'TERMINAL',
    name: 'Verificar atualização de segredo de provedor',
    description: 'Valida o provisionamento de segredos sem rede nem credencial real.',
    file: 'scripts/verify-provider-secret-update.py',
    command: 'python3 scripts/verify-provider-secret-update.py',
    notRunnableReason: OPERATOR_ONLY,
  },
  {
    id: 'verify-security',
    kind: 'TERMINAL',
    name: 'Smoke de segurança',
    description:
      'Smoke de segurança no contêiner da API, sem alterar dados. Emite só nomes e contagens.',
    file: 'scripts/verify-security.mjs',
    command: 'docker compose exec -T api node --input-type=module < scripts/verify-security.mjs',
    notRunnableReason: OPERATOR_ONLY,
  },
  {
    id: 'verify-vault-restore',
    kind: 'TERMINAL',
    name: 'Verificar restauração do Vault',
    description:
      'Valida a recuperação do Vault Transit em armazenamento Raft descartável e isolado.',
    file: 'scripts/verify-vault-restore.py',
    command: 'python3 scripts/verify-vault-restore.py',
    notRunnableReason: OPERATOR_ONLY,
  },
  {
    id: 'hostinger-vps-mcp',
    kind: 'TERMINAL',
    name: 'MCP da Hostinger (VPS)',
    description: 'Sobe o servidor MCP da Hostinger restrito a VPS para uso no Claude Code.',
    file: 'scripts/mcp/hostinger-vps.sh',
    command: 'bash scripts/mcp/hostinger-vps.sh',
    notRunnableReason: 'Usa o token da Hostinger do operador — só no terminal.',
  },
];

export const ALL_SCRIPTS: readonly ScriptDefinition[] = [
  ...CRON_SCRIPTS,
  ...ROUTINE_SCRIPTS,
  ...TERMINAL_SCRIPTS,
];
