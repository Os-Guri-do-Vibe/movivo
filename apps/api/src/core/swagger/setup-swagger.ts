/**
 * Documentação OpenAPI/Swagger da API MOVIVO.
 *
 * Decisão: montada apenas fora de produção (`!config.isProduction`), mesmo padrão já
 * usado para `disableErrorMessages` no `ValidationPipe` (`main.ts`) — não devolver a um
 * cliente não confiável um mapa completo dos payloads de anamnese/saúde/PAR-Q. Em
 * dev/staging/CI a doc fica sempre disponível para acelerar integração (web, QA,
 * ferramentas externas como Postman/Insomnia via `/docs-json`).
 *
 * Se um dia a MOVIVO abrir uma API pública para parceiros B2B (Fase 8, fora do escopo do
 * MVP — ver `CLAUDE.md`), essa decisão precisa ser revisitada com Sato: nesse cenário a
 * doc pública passaria a ser desejável, mas só para o subconjunto de rotas realmente
 * externas, nunca para os controllers `admin/*`.
 */
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { APP_VERSION } from '@movivo/shared';

import type { AppConfigService } from '../config';

const DESCRICAO = `
API da **MOVIVO** — assessoria de movimento, performance e bem-estar entregue via WhatsApp,
com agentes de IA que operam dentro de políticas versionadas pelos profissionais (CREF, CRN e
CRM), que entram por exceção.

### Convenções gerais

- **Prefixo:** toda rota vive sob \`/{globalPrefix}\` (ex.: \`/api/v1/auth/login\`) — regra
  de versionamento fixa da arquitetura (§12.10 do relatório de Rafael).
- **Autenticação:** Bearer JWT (RS256) no header \`Authorization\`, obtido em
  \`POST /auth/login\` e renovado em \`POST /auth/refresh\` (o refresh token em si viaja
  só por cookie \`httpOnly\`, nunca no corpo/JSON). Rotas marcadas com o cadeado exigem
  token de acesso válido.
- **Papéis (RBAC):** \`USER\` (aluno), \`PROFESSIONAL\` (profissional de um conselho: CREF,
  CRN ou CRM, que define o domínio de atuação) e \`ADMIN\`. Endpoints sob a tag **Admin**
  exigem \`PROFESSIONAL\` ou \`ADMIN\`, salvo exceção indicada na própria operação.
- **Validação:** todo corpo de requisição é validado por um schema Zod de
  \`@movivo/shared\` (a mesma fonte usada para gerar os schemas mostrados aqui — nunca um
  DTO paralelo). Corpo fora do schema retorna \`400\`.
- **Idempotência de webhooks:** \`POST /webhook/whatsapp/evolution\` e
  \`POST /webhook/payment\` são chamados por sistemas externos (EvolutionAPI,
  Asaas), não pelo app cliente — autenticados pelo mecanismo configurado, não
  por Bearer JWT.
- **Guardrails de linguagem:** nenhuma resposta da IA usa "diagnóstico", "tratamento",
  "cura" ou promete resultado garantido — a IA é sempre apresentada como ferramenta de
  apoio, com o respaldo do profissional visível, nunca como quem prescreve sozinha.

Documentação gerada a partir do código-fonte (\`@nestjs/swagger\`) — reflete exatamente as
rotas e schemas de validação em produção, sem edição manual de exemplos desatualizados.
`.trim();

/**
 * Monta e expõe a UI do Swagger. Retorna o path montado (para log de boot) ou
 * `undefined` quando a doc não é montada (produção).
 */
export function setupSwagger(app: INestApplication, config: AppConfigService): string | undefined {
  if (config.isProduction) return undefined;

  const documentBuilder = new DocumentBuilder()
    .setTitle('MOVIVO API')
    .setDescription(DESCRICAO)
    .setVersion(APP_VERSION)
    .setContact('MOVIVO', 'https://github.com/Os-Guri-do-Vibe/movivo', '')
    .addServer(`/${config.globalPrefix}`, 'Servidor atual (respeita o prefixo configurado)')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token obtido em POST /auth/login ou POST /auth/refresh.',
      },
      'access-token',
    )
    .addTag('Auth', 'Login, refresh/rotation de sessão, logout e sanidade de identidade.')
    .addTag('Conta', 'Perfil do usuário autenticado e avatar.')
    .addTag('Anamnese', 'Formulário de anamnese + PAR-Q em blocos, com salvamento de progresso.')
    .addTag('Consentimento', 'Registro de consentimento LGPD da anamnese.')
    .addTag('Plano', 'Plano integrado vigente (treino e nutrição) lido pelo link do aluno.')
    .addTag('Treino', 'Sessões agendadas e registro de execução de qualquer modalidade.')
    .addTag('Alimentação', 'Registro e confirmação das refeições do aluno.')
    .addTag('Check-in', 'Check-ins adaptativos respondidos pelo link do aluno.')
    .addTag('Assinatura', 'Plano, trial e ciclo de cobrança da assinatura do aluno.')
    .addTag(
      'Webhook de Pagamento',
      'Callback autenticado do Asaas — não é chamado pelo app cliente.',
    )
    .addTag('WhatsApp', 'Webhook inbound autenticado pelo token da EvolutionAPI.')
    .addTag('Link Curto', 'Encurtador interno usado nas mensagens de WhatsApp.')
    .addTag('Health', 'Liveness/readiness da API e das dependências (DB, Redis).')
    .addTag('Admin · Central de Controle', 'Visões operacionais da equipe sobre alunos e sistema.')
    .addTag('Admin · Fila de exceções', 'Casos que as políticas não resolveram, por conselho.')
    .addTag('Admin · Agentes de IA', 'Tarefas, níveis de modelo, avaliações e custo dos agentes.')
    .addTag('Admin · Governança do atendimento', 'Simulação das regras de atendimento da IA.')
    .addTag('Estúdio de metodologia', 'Documentos de metodologia por domínio, versionados.')
    .addTag('Admin · Auditoria', 'Consulta ao log de auditoria imutável.')
    .addTag('Admin · Catálogo de Exercícios', 'Catálogo de exercícios usado no planejamento.')
    .addTag('Admin · FAQ', 'Base de perguntas frequentes servida pela IA.')
    .addTag('Admin · Financeiro', 'Despesas, custo de IA e indicadores financeiros internos.')
    .addTag(
      'Admin · Tópicos Proibidos',
      'Lista de tópicos fora do escopo seguro da IA (fallback para humano).',
    )
    .addTag('Admin · Base de Conhecimento', 'Upload e indexação de material-fonte para os agentes.')
    .addTag(
      'Admin · Guardrail L1',
      'Regras determinísticas de bloqueio antes de qualquer chamada de LLM.',
    )
    .addTag('Admin · Marketing', 'Atribuição de campanha e custo de mídia paga.')
    .addTag('Admin · Parceiros', 'Cadastro de parceiros/academias (canal comercial B2B).')
    .build();

  const document = SwaggerModule.createDocument(app, documentBuilder);
  const path = 'docs';
  SwaggerModule.setup(path, app, document, {
    customSiteTitle: 'MOVIVO API — Documentação',
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  return path;
}
