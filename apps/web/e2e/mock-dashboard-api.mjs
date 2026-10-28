import { createServer } from 'node:http';
import { URL } from 'node:url';

const PORT = 3101;
const CASE_ID = '11111111-1111-4111-8111-111111111111';
const createdAt = '2026-08-03T12:00:00.000Z';
const anamnesisSessions = new Map();

const controlCenterMeta = {
  generatedAt: '2026-08-11T15:00:00.000Z',
  timezone: 'America/Sao_Paulo',
  dataQuality: [],
};

function metric(value, unit, definition, status = 'AVAILABLE') {
  return { value, unit, status, definition };
}

const STUDENT_ID = '66666666-6666-4666-8666-666666666666';

/** Fixture da Base de alunos e da ficha (US-7.4) — mesmo aluno nas duas telas. */
const studentSummary = {
  id: STUDENT_ID,
  name: 'Pessoa Teste',
  email: 'pessoa@movivo.test',
  phoneNumber: '+5511999999999',
  status: 'ACTIVE',
  subscriptionStatus: 'TRIALING',
  subscriptionPlan: null,
  planStatus: 'ACTIVE',
  enrolledAt: '2026-08-01T12:00:00.000Z',
  churnRisk: {
    score: 1,
    signals: [{ code: 'SEM_MENSAGEM', label: 'Sem mensagem recebida há 14 dias' }],
  },
};

const studentDetail = {
  ...studentSummary,
  anamnesisStatus: 'SUBMITTED',
  // Cadastro anterior à captura de UTM: origem não capturada, nunca inferida.
  acquisition: null,
  plan: {
    training: { version: 1, publishedAt: '2026-08-04T12:00:00.000Z' },
    nutrition: { version: 1, publishedAt: '2026-08-04T12:00:00.000Z' },
    strategy: 'Energia e consistência',
    goal: 'HEALTH',
  },
  adherence: {
    windowDays: 28,
    planned: 8,
    done: 5,
    rate: metric(62.5, 'PERCENT', 'Sessões concluídas sobre as agendadas e vencidas.'),
  },
  checkins: {
    sent: 2,
    answered: 1,
    responseRate: metric(50, 'PERCENT', 'Adesão declarada via check-in.'),
  },
  executions: [],
  exceptions: [],
  decisions: [],
  // Do evento mais recente para o mais antigo.
  timeline: [
    {
      at: '2026-08-10T12:00:00.000Z',
      kind: 'EXCEPTION',
      code: 'EXCEPTION_RESOLVED',
      params: { kind: 'SAFETY' },
    },
    {
      at: '2026-08-09T12:00:00.000Z',
      kind: 'CONVERSATION',
      code: 'CONVERSATION_DAY',
      params: { messages: 12 },
    },
    {
      at: '2026-08-05T12:00:00.000Z',
      kind: 'SUBSCRIPTION',
      code: 'SUBSCRIPTION_CREATED',
      params: { plan: 'MONTHLY', status: 'TRIALING' },
    },
    {
      at: '2026-08-04T12:00:00.000Z',
      kind: 'PLAN',
      code: 'PLAN_PUBLISHED',
      params: { version: 1 },
    },
    {
      at: '2026-08-03T12:00:00.000Z',
      kind: 'ANAMNESIS',
      code: 'ANAMNESIS_SUBMITTED',
      params: { status: 'SUBMITTED' },
    },
  ],
  aiQuality: {
    blockedRate: metric(0, 'PERCENT', 'Respostas retidas neste aluno.'),
    blocked: 0,
    validated: 12,
  },
  health: { parqState: 'LIBERADO', painReports: [] },
};

const capabilitiesByRole = {
  ADMIN: [
    'control_center.overview.read',
    'control_center.marketing.read',
    'control_center.marketing.write',
    'control_center.students.read',
    'control_center.students.health.read',
    'control_center.system.read',
    'control_center.system.operate',
    'control_center.finance.read',
    'control_center.finance.write',
    'control_center.support.read',
    'control_center.compliance.read',
    'control_center.audit.read',
    'control_center.ai.config.read',
    'control_center.ai.config.write',
    'control_center.admin.destructive.request',
    'control_center.exceptions.read',
    'control_center.exceptions.resolve',
    'control_center.agents.read',
  ],
  // O profissional cai na Fila de exceções (`landingPathForRole`), que exige exceptions.read.
  PROFESSIONAL: [
    'control_center.students.read',
    'control_center.students.health.read',
    'control_center.exceptions.read',
    'control_center.exceptions.resolve',
  ],
  USER: [],
};

const exceptionCase = {
  id: CASE_ID,
  kind: 'SAFETY',
  priority: 'URGENT',
  status: 'OPEN',
  domain: 'TRAINING',
  summary: 'Relato de dor durante o treino pede avaliação profissional.',
  createdAt,
  assignedStaffId: null,
  studentId: STUDENT_ID,
  studentName: 'Maria Teste',
  canResolve: true,
};

// CORS permissivo: o onboarding v2 chama esta API direto do browser (cross-origin
// localhost:3000 → 127.0.0.1:3101), diferente do dashboard, que passa por BFF same-origin.
// Só existe neste mock de teste — a API real tem sua própria política de CORS.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': '*',
  'Access-Control-Allow-Headers': '*',
};

function json(response, status, body, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS, ...headers });
  response.end(JSON.stringify(body));
}

function authenticated(request) {
  return request.headers.authorization?.startsWith('Bearer access-') === true;
}

function authenticatedRole(request) {
  const token = request.headers.authorization;
  if (token === 'Bearer access-admin') return 'ADMIN';
  if (token === 'Bearer access-user') return 'USER';
  return authenticated(request) ? 'PROFESSIONAL' : null;
}

async function readBody(request) {
  let body = '';
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`);
  if (request.method === 'OPTIONS') {
    response.writeHead(204, CORS_HEADERS);
    return response.end();
  }
  if (url.pathname === '/api/v1/health') return json(response, 200, { status: 'ok' });
  // --- Onboarding v2 (Sprint 6) — sessão em memória, um smoke por processo ---
  if (request.method === 'POST' && url.pathname === '/api/v1/anamnesis/start') {
    const token = 'e2e-onboarding-token';
    anamnesisSessions.set(token, {
      currentStep: 1,
      completedSteps: [],
      phoneVerified: false,
      code: null,
      parqBlocked: false,
    });
    return json(response, 201, {
      token,
      expiresAt: '2099-01-01T00:00:00.000Z',
      currentStep: 1,
    });
  }
  const sessionMatch = /^\/api\/v1\/anamnesis\/session\/([^/]+)(\/.*)?$/.exec(url.pathname);
  if (sessionMatch) {
    const [, token, rest] = sessionMatch;
    const session = anamnesisSessions.get(token);
    if (!session) return json(response, 404, { message: 'sessão não encontrada' });

    if (!rest && request.method === 'GET') {
      return json(response, 200, {
        status: 'IN_PROGRESS',
        flow: 'INITIAL',
        currentStep: session.currentStep,
        completedSteps: session.completedSteps,
        phoneVerified: session.phoneVerified,
        primaryGoal: null,
        consentsPending: false,
        blocks: {},
        consents: [
          {
            type: 'TERMS_OF_SERVICE',
            version: 'terms-2026-10-v2',
            title: null,
            body: [],
            label: 'Li e aceito os Termos de Uso.',
            required: true,
          },
          {
            type: 'HEALTH_DATA',
            version: 'health-e2e-v1',
            title: 'Saúde',
            body: [],
            label: 'Autorizo o tratamento dos meus dados de saúde.',
            required: true,
          },
          {
            type: 'AI_DISCLOSURE',
            version: 'ai-e2e-v1',
            title: 'IA',
            body: [],
            label: 'Estou ciente de que a MOVIVO usa inteligência artificial.',
            required: true,
          },
          {
            type: 'MARKETING',
            version: 'marketing-e2e-v1',
            title: null,
            body: [],
            label: 'Quero receber novidades.',
            required: false,
          },
        ],
        outcome: null,
        expiresAt: '2099-01-01T00:00:00.000Z',
      });
    }
    if (rest === '/phone/send-code' && request.method === 'POST') {
      session.code = '123456';
      return json(response, 200, {
        sent: true,
        resendAvailableAt: '2099-01-01T00:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
      });
    }
    if (rest === '/phone/verify' && request.method === 'POST') {
      const body = await readBody(request);
      if (body.code !== session.code) return json(response, 400, { message: 'código incorreto' });
      session.phoneVerified = true;
      return json(response, 200, { phoneVerified: true });
    }
    if (rest === '/consents' && request.method === 'POST') {
      return json(response, 200, {});
    }
    const stepMatch = /^\/step\/([1-8])$/.exec(rest ?? '');
    if (stepMatch && request.method === 'PATCH') {
      const body = await readBody(request);
      // O gate PAR-Q é do SERVIDOR: o mock guarda as respostas e decide o `outcome` no
      // submit, como a API real. Sem isso o E2E não conseguiria provar que a variante da
      // tela de sucesso segue o servidor, e não um cálculo do cliente (TASK-6.12.1).
      if (stepMatch[1] === '6')
        session.parqBlocked = (body.parq?.answers ?? []).some((a) => a.answer === true);
      const done = Number(stepMatch[1]);
      session.completedSteps = [...new Set([...session.completedSteps, done])].sort();
      session.currentStep = Math.min(done + 1, 8);
      return json(response, 200, { currentStep: session.currentStep });
    }
    if (rest === '/submit' && request.method === 'POST') {
      return json(response, 200, {
        status: 'SUBMITTED',
        outcome: session.parqBlocked ? 'PENDING_REVIEW' : 'READY',
      });
    }
  }

  if (request.method === 'POST' && url.pathname === '/api/v1/auth/login') {
    const body = await readBody(request);
    if (body.password !== 'senha-segura') return json(response, 401, { message: 'Unauthorized' });
    const role =
      body.email === 'usuario@movivo.test'
        ? 'USER'
        : body.email === 'admin@movivo.test'
          ? 'ADMIN'
          : 'PROFESSIONAL';
    return json(
      response,
      200,
      { accessToken: `access-${role.toLowerCase()}`, user: { id: 'professional-1', role } },
      {
        'Set-Cookie':
          'movivo_refresh=refresh-initial; Max-Age=2592000; HttpOnly; SameSite=Strict; Path=/api/v1/auth',
      },
    );
  }
  if (request.method === 'POST' && url.pathname === '/api/v1/auth/refresh') {
    return json(
      response,
      200,
      {
        accessToken: 'access-rotated',
        user: { id: 'professional-1', role: 'PROFESSIONAL' },
      },
      {
        'Set-Cookie':
          'movivo_refresh=refresh-rotated; Max-Age=2592000; HttpOnly; SameSite=Strict; Path=/api/v1/auth',
      },
    );
  }
  if (url.pathname === '/api/v1/auth/me') {
    const role = authenticatedRole(request);
    return role
      ? json(response, 200, {
          userId: '11111111-1111-4111-8111-111111111111',
          role,
          capabilities: capabilitiesByRole[role] ?? [],
        })
      : json(response, 401, { message: 'Unauthorized' });
  }
  if (request.method === 'POST' && url.pathname === '/api/v1/auth/logout') {
    return json(response, 204, {});
  }

  if (!authenticated(request)) return json(response, 401, { message: 'Unauthorized' });
  if (request.method === 'GET' && url.pathname === '/api/v1/control-center/overview') {
    return json(response, 200, {
      data: {
        pillars: [
          {
            pillar: 'STUDENTS',
            label: 'Alunos',
            state: 'ATTENTION',
            href: '/dashboard/alunos',
            headline: {
              label: 'Treinos nos primeiros 30 dias pagos (meta ≥8)',
              metric: metric(5.5, 'COUNT', 'Média de treinos registrados na coorte paga.'),
            },
            details: [
              {
                label: 'Taxa de reporte de treino',
                metric: metric(72, 'PERCENT', 'Alunos com ao menos 1 treino registrado.'),
              },
              {
                label: 'Em risco de cancelamento',
                metric: metric(3, 'COUNT', 'Alunos com sinal de risco comercial.'),
              },
              {
                label: 'Alertas de segurança e PAR-Q bloqueado',
                metric: metric(0, 'COUNT', 'Alertas SAFETY abertos mais PAR-Q bloqueado.'),
              },
            ],
            signals: [],
            reason: '3 aluno(s) com sinal de risco de cancelamento.',
          },
          {
            pillar: 'FINANCE',
            label: 'Financeiro',
            state: 'OK',
            href: '/dashboard/financeiro',
            headline: { label: 'MRR contratado', metric: metric(1638, 'BRL', 'MRR contratado.') },
            details: [
              { label: 'Lucro do período', metric: metric(420.5, 'BRL', 'Receita menos despesa.') },
              {
                label: 'Receita em risco (30 dias)',
                metric: metric(0, 'BRL', 'Renovações em risco.'),
              },
              { label: 'Inadimplência', metric: metric(4, 'PERCENT', 'Cobranças que falharam.') },
            ],
            signals: [],
            reason: null,
          },
          {
            pillar: 'MARKETING',
            label: 'Marketing',
            state: 'OK',
            href: '/dashboard/analytics',
            headline: { label: 'Cadastros iniciados', metric: metric(120, 'COUNT', 'Cadastros.') },
            details: [
              {
                label: 'Taxa de conclusão da anamnese',
                metric: metric(68, 'PERCENT', 'Enviados sobre iniciados.'),
              },
              { label: 'Conversão do trial', metric: metric(35, 'PERCENT', 'Trial para pago.') },
              {
                label: 'CAC do canal principal (meta_ads)',
                metric: metric(54, 'BRL', 'Custo de aquisição.'),
              },
            ],
            signals: [],
            reason: null,
          },
          {
            pillar: 'AI',
            label: 'IA',
            state: 'OK',
            href: '/dashboard/ia/agentes',
            headline: {
              label: 'Resposta bloqueada pela validação',
              metric: metric(1.2, 'PERCENT', 'Bloqueadas sobre validadas.'),
            },
            details: [
              {
                label: 'Resposta do coach (p95)',
                metric: metric(9000, 'MILLISECONDS', 'Tempo ruim de resposta.'),
              },
              {
                label: 'Trabalhos de IA com falha (30 dias)',
                metric: metric(3, 'COUNT', 'Falhas e DLQ.'),
              },
            ],
            signals: [{ label: 'Personas', state: 'OK', text: 'Masculina v3 · Feminina v2' }],
            reason: null,
          },
          {
            pillar: 'SYSTEM',
            label: 'Sistema',
            state: 'ATTENTION',
            href: '/dashboard/sistema',
            headline: {
              label: 'Resposta do AI Coach em até 30 segundos',
              metric: metric(96.4, 'PERCENT', 'Ao menos 95% em até 30s.'),
            },
            details: [
              {
                label: 'Orçamento de erro consumido',
                metric: metric(72, 'PERCENT', 'Margem de erro já usada.'),
              },
            ],
            signals: [
              { label: 'WhatsApp', state: 'ATTENTION', text: 'Aguardando leitura do QR Code' },
            ],
            reason: 'WhatsApp: Aguardando leitura do QR Code.',
          },
        ],
      },
      meta: controlCenterMeta,
    });
  }
  // Aba "Conversas": uma conversa longa (força a rolagem interna do chat) com formatação do WhatsApp.
  if (request.method === 'GET' && url.pathname === '/api/v1/control-center/conversations') {
    return json(response, 200, {
      data: {
        // Lista longa como a de produção: cada conversa leva um `sr-only` (texto para leitor de
        // tela posicionado em absoluto) e foi isso que esticou a página além da janela.
        conversations: Array.from({ length: 40 }, (_, index) => ({
          studentId:
            index === 0 ? STUDENT_ID : `77777777-7777-4777-8777-${String(index).padStart(12, '0')}`,
          name: index === 0 ? 'Ana Souza' : `Aluno ${index}`,
          phoneNumber: `+55119999${String(index).padStart(5, '0')}`,
          lastMessageAt: new Date(Date.UTC(2026, 9, 9, 15, 0) - index * 60_000).toISOString(),
          aiPaused: index % 3 === 0,
          unreadCount: index % 4,
        })),
      },
      meta: controlCenterMeta,
    });
  }
  if (
    request.method === 'GET' &&
    url.pathname === `/api/v1/control-center/conversations/${STUDENT_ID}/messages`
  ) {
    const messages = Array.from({ length: 60 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      direction: index % 2 === 0 ? 'INBOUND' : 'OUTBOUND',
      messageType: 'TEXT',
      content:
        index === 59
          ? '*Treino de hoje* _com calma_\n- agachamento\n- supino'
          : `Mensagem de teste ${index + 1}`,
      createdAt: new Date(Date.UTC(2026, 9, 9, 12, index)).toISOString(),
      origin: index % 2 === 0 ? 'STUDENT' : 'AGENT',
      media: null,
    }));
    return json(response, 200, {
      data: {
        student: { id: STUDENT_ID, name: 'Ana Souza', phoneNumber: '+5511999990001' },
        messages,
        olderCursor: null,
      },
      meta: controlCenterMeta,
    });
  }
  if (request.method === 'GET' && url.pathname === '/api/v1/control-center/students') {
    return json(response, 200, {
      data: {
        students: [studentSummary],
        aiBlockedRate: metric(0, 'PERCENT', 'Respostas bloqueadas na base.'),
        northStar: {
          averageCompletions: metric(
            null,
            'COUNT',
            'Treinos concluídos nos primeiros 30 dias.',
            'UNAVAILABLE',
          ),
          target: 8,
          reportingRate: metric(
            null,
            'PERCENT',
            'Alunos com ao menos 1 registro no período.',
            'UNAVAILABLE',
          ),
          cohortSize: 0,
          bySource: [],
        },
        declaredAdherenceRate: metric(
          null,
          'PERCENT',
          'Adesão declarada via check-in.',
          'UNAVAILABLE',
        ),
      },
      meta: controlCenterMeta,
    });
  }
  if (
    request.method === 'GET' &&
    url.pathname === `/api/v1/control-center/students/${STUDENT_ID}`
  ) {
    return json(response, 200, { data: { student: studentDetail }, meta: controlCenterMeta });
  }
  if (request.method === 'GET' && url.pathname === '/api/v1/control-center/exceptions/summary') {
    return json(response, 200, { open: 1, urgent: 1 });
  }
  if (request.method === 'GET' && url.pathname === '/api/v1/control-center/exceptions') {
    return json(response, 200, [exceptionCase]);
  }
  return json(response, 404, { message: 'Not found' });
}).listen(PORT, '127.0.0.1');
