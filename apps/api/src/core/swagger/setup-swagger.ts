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
API do **MOVIVO** — AI Coach de treino individualizado entregue via WhatsApp, com
metodologia e supervisão de profissional de Educação Física registrado no CREF.

### Convenções gerais

- **Prefixo:** toda rota vive sob \`/{globalPrefix}\` (ex.: \`/api/v1/auth/login\`) — regra
  de versionamento fixa da arquitetura (§12.10 do relatório de Rafael).
- **Autenticação:** Bearer JWT (RS256) no header \`Authorization\`, obtido em
  \`POST /auth/login\` e renovado em \`POST /auth/refresh\` (o refresh token em si viaja
  só por cookie \`httpOnly\`, nunca no corpo/JSON). Rotas marcadas com o cadeado exigem
  token de acesso válido.
- **Papéis (RBAC):** \`USER\` (aluno), \`PROFESSIONAL\` (responsável técnico CREF) e
  \`ADMIN\`. Endpoints sob a tag **Admin** exigem \`PROFESSIONAL\` ou \`ADMIN\`, salvo
  exceção indicada na própria operação.
- **Validação:** todo corpo de requisição é validado por um schema Zod de
  \`@movivo/shared\` (a mesma fonte usada para gerar os schemas mostrados aqui — nunca um
  DTO paralelo). Corpo fora do schema retorna \`400\`.
- **Idempotência de webhooks:** \`POST /whatsapp/webhook\` e
  \`POST /subscription/payment-webhook\` são chamados por sistemas externos (AraraHQ,
  Asaas), não pelo app cliente — autenticados pelo mecanismo oficial do provedor, não
  por Bearer JWT.
- **Guardrails de linguagem:** nenhuma resposta da IA (ver módulo AI Coach) usa
  "diagnóstico", "tratamento", "cura" ou promete resultado garantido — a IA é sempre
  apresentada como ferramenta do profissional CREF, nunca como quem decide sozinha.

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
    .addTag('Protocolo', 'Geração e consulta do protocolo de treino vigente do aluno.')
    .addTag('Renovação de Protocolo', 'Renovação de mesociclo e catálogo de substituição.')
    .addTag('Check-in', 'Check-in semanal automático que ajusta o protocolo.')
    .addTag('Treino', 'Acompanhamento diário de execução dos treinos do protocolo.')
    .addTag('Assinatura', 'Plano, trial e ciclo de cobrança da assinatura do aluno.')
    .addTag(
      'Webhook de Pagamento',
      'Callback autenticado do Asaas — não é chamado pelo app cliente.',
    )
    .addTag(
      'WhatsApp',
      'Webhook inbound assinado (HMAC) do provedor de WhatsApp (AraraHQ/EvolutionAPI).',
    )
    .addTag('Link Curto', 'Encurtador interno usado nas mensagens de WhatsApp.')
    .addTag('Health', 'Liveness/readiness da API e das dependências (DB, Redis).')
    .addTag('Admin · Central de Controle', 'Operação diária do profissional CREF sobre os alunos.')
    .addTag('Admin · Dashboard', 'Métricas agregadas de produto, IA e negócio.')
    .addTag(
      'Admin · Config de IA',
      'Seleção de provedor/modelo de LLM e gate de dados de saúde (ADR-005-R2).',
    )
    .addTag('Admin · Auditoria', 'Consulta ao log de auditoria imutável.')
    .addTag(
      'Admin · Catálogo de Exercícios',
      'CRUD do catálogo de exercícios usado na geração de protocolo.',
    )
    .addTag('Admin · FAQ', 'Base de perguntas frequentes servida pelo AI Coach.')
    .addTag('Admin · Financeiro', 'Despesas, custo de IA e indicadores financeiros internos.')
    .addTag(
      'Admin · Tópicos Proibidos',
      'Lista de tópicos fora do escopo seguro da IA (fallback para humano).',
    )
    .addTag(
      'Admin · Base de Conhecimento',
      'Upload e indexação de material-fonte do RAG do AI Coach.',
    )
    .addTag(
      'Admin · Guardrail L1',
      'Regras determinísticas de bloqueio antes de qualquer chamada de LLM.',
    )
    .addTag('Admin · Marketing', 'Atribuição de campanha e custo de mídia paga.')
    .addTag(
      'Admin · Metodologia',
      'Regras de metodologia de treino usadas pelo motor determinístico.',
    )
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
