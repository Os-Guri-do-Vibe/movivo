import { createServer } from 'node:http';
import { URL } from 'node:url';

const PORT = 3101;
const PROTOCOL_ID = '11111111-1111-4111-8111-111111111111';
const HANDOFF_ID = '22222222-2222-4222-8222-222222222222';
const PARQ_ID = '33333333-3333-4333-8333-333333333333';
const CHECKIN_ID = '44444444-4444-4444-8444-444444444444';
const createdAt = '2026-08-03T12:00:00.000Z';
const resolvedIds = new Set();
const eventStreams = new Set();
const anamnesisSessions = new Map();
let realtimeVisible = false;

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
  subscriptionStatus: 'TRIAL',
  protocolStatus: 'PENDING_REVIEW',
  churnRisk: {
    score: 1,
    signals: [{ code: 'SEM_MENSAGEM', label: 'Sem mensagem recebida há 14 dias' }],
  },
};

const studentDetail = {
  ...studentSummary,
  requiresProfessionalReview: false,
  anamnesisStatus: 'COMPLETED',
  currentProtocol: {
    id: PROTOCOL_ID,
    version: 1,
    currentWeek: 2,
    totalWeeks: 8,
    signedAt: '2026-08-05T12:00:00.000Z',
  },
  routine: {
    primaryGoal: 'SAUDE',
    trainingStatus: 'RETOMANDO',
    experience: 'INICIANTE',
    daysPerWeek: 3,
    preferredDays: ['SEG', 'QUA', 'SEX'],
    sessionDuration: '45_60',
    location: 'ACADEMIA',
    preferredPeriod: 'MANHA',
  },
  workoutHistory: { status: 'UNAVAILABLE', reason: 'Depende de workout_completions (Sprint 8).' },
  // US-8.2: cadastro anterior à captura de UTM — origem não capturada, nunca inferida.
  acquisition: null,
  // As 6 origens da timeline, do evento mais recente para o mais antigo.
  timeline: [
    {
      at: '2026-08-10T12:00:00.000Z',
      kind: 'HANDOFF',
      title: 'Atendimento humano resolvido',
      detail: null,
    },
    {
      at: '2026-08-09T12:00:00.000Z',
      kind: 'CONVERSATION',
      title: '12 mensagens trocadas no dia',
      detail: null,
    },
    {
      at: '2026-08-08T12:00:00.000Z',
      kind: 'CHECKIN',
      title: 'Check-in da semana 2',
      detail: null,
    },
    { at: '2026-08-05T12:00:00.000Z', kind: 'SUBSCRIPTION', title: 'Trial iniciado', detail: null },
    {
      at: '2026-08-04T12:00:00.000Z',
      kind: 'PROTOCOL',
      title: 'Protocolo v1 gerado',
      detail: null,
    },
    {
      at: '2026-08-03T12:00:00.000Z',
      kind: 'ANAMNESIS',
      title: 'Anamnese concluída',
      detail: null,
    },
  ],
  adherence: {
    checkinsSent: 2,
    checkinsResponded: 1,
    responseRate: metric(50, 'PERCENT', 'Adesão declarada via check-in.'),
  },
  aiQuality: {
    blockedRate: metric(0, 'PERCENT', 'Respostas bloqueadas neste aluno.'),
    blocked: 0,
    validated: 12,
    occurrences: [],
  },
  health: { parqState: 'CLEARED', painReports: [], evolution: [] },
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
  ],
  // US-7.1: o RT CREF cai na Fila do Profissional (`landingPathForRole`), que exige
  // students.read + students.health.read — as duas precisam estar aqui.
  PROFESSIONAL: ['control_center.students.read', 'control_center.students.health.read'],
  USER: [],
};

const protocolContent = {
  promptVersion: 'methodology-2026-07',
  goal: 'GAIN_MUSCLE',
  phase: 'HIPERTROFIA',
  weeklyFrequency: 3,
  sessions: [
    {
      dayLabel: 'Treino A',
      focus: 'Membros inferiores',
      exercises: [
        {
          exerciseId: 'goblet_squat',
          name: 'Agachamento goblet',
          sets: 3,
          reps: { min: 8, max: 10 },
          loadStrategy: 'DOUBLE_PROGRESSION',
          restSeconds: 90,
          notes: 'Movimento controlado.',
        },
      ],
    },
  ],
  generalNotes: 'Manter retorno semanal com o profissional responsável.',
};

const items = [
  {
    id: CHECKIN_ID,
    kind: 'CHECKIN',
    severity: 'SAFETY',
    createdAt,
    ageMinutes: 190,
    title: 'Check-in exige revisão profissional',
    summary: 'Sinalização de segurança registrada no check-in.',
    status: 'OPEN',
  },
  {
    id: HANDOFF_ID,
    kind: 'HANDOFF',
    severity: 'SAFETY',
    createdAt,
    ageMinutes: 130,
    title: 'Relato exige atenção profissional',
    summary: 'Conteúdo anonimizado para supervisão.',
    status: 'OPEN',
  },
  {
    id: PARQ_ID,
    kind: 'PARQ',
    severity: 'ALERT',
    createdAt,
    ageMinutes: 70,
    title: 'PAR-Q aguardando liberação',
    summary: 'Um cuidado a mais antes de começar.',
    status: 'BLOCKED_PENDING_CLEARANCE',
  },
  {
    id: PROTOCOL_ID,
    kind: 'PROTOCOL',
    severity: 'ROUTINE',
    createdAt,
    ageMinutes: 10,
    title: 'Protocolo para Revisão: Maria Teste',
    summary: 'Hipertrofia · 3x por semana',
    status: 'PENDING_REVIEW',
  },
];

const realtimeItem = {
  id: '55555555-5555-4555-8555-555555555555',
  kind: 'PROTOCOL',
  severity: 'ROUTINE',
  createdAt,
  ageMinutes: 0,
  title: 'Novo protocolo recebido em tempo real',
  summary: 'Evento sem dados pessoais invalidou a fila.',
  status: 'PENDING_REVIEW',
};

const replay = {
  conversationId: 'anonymous-conversation',
  startedAt: createdAt,
  messages: [
    { role: 'USER', content: '[PESSOA] relatou dificuldade.', createdAt },
    { role: 'ASSISTANT', content: 'Retorno acolhido e encaminhado.', createdAt },
  ],
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
  if (request.method === 'POST' && url.pathname === '/__reset') {
    resolvedIds.clear();
    realtimeVisible = false;
    return json(response, 200, { status: 'ok' });
  }
  if (request.method === 'POST' && url.pathname === '/__emit') {
    realtimeVisible = true;
    const event = 'event: queue.updated\ndata: {"invalidate":true}\n\n';
    for (const stream of eventStreams) stream.write(event);
    return json(response, 200, { status: 'emitted' });
  }

  // --- Onboarding v2 (Sprint 6) — sessão em memória, um smoke por processo ---
  if (request.method === 'POST' && url.pathname === '/api/v1/anamnesis/start') {
    const token = 'e2e-onboarding-token';
    anamnesisSessions.set(token, {
      currentStep: 1,
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
        currentStep: session.currentStep,
        phoneVerified: session.phoneVerified,
        primaryGoal: null,
        consents: [
          {
            type: 'TERMS_OF_SERVICE',
            version: 'terms-e2e-v1',
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
        step1: null,
        step2: null,
        healthCompleted: false,
        parqCompleted: false,
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
    const stepMatch = /^\/step\/([123])$/.exec(rest ?? '');
    if (stepMatch && request.method === 'PATCH') {
      const body = await readBody(request);
      // O gate PAR-Q é do SERVIDOR: o mock guarda as respostas e decide o `outcome` no
      // submit, como a API real. Sem isso o E2E não conseguiria provar que a variante da
      // tela de sucesso segue o servidor, e não um cálculo do cliente (TASK-6.12.1).
      if (stepMatch[1] === '3')
        session.parqBlocked = (body.parq?.answers ?? []).some((a) => a.answer === true);
      session.currentStep = Number(stepMatch[1]) + 1;
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
          'movivo_refresh=refresh-initial; HttpOnly; SameSite=Strict; Path=/api/v1/auth',
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
          'movivo_refresh=refresh-rotated; HttpOnly; SameSite=Strict; Path=/api/v1/auth',
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
            state: 'OK',
            href: '/dashboard/alunos',
            headline: {
              label: 'Alunos cadastrados',
              metric: metric(12, 'COUNT', 'Alunos cadastrados.'),
            },
            details: [],
            reason: null,
          },
          {
            pillar: 'FINANCE',
            label: 'Financeiro',
            state: 'OK',
            href: '/dashboard/financeiro',
            headline: { label: 'MRR contratado', metric: metric(468, 'BRL', 'MRR contratado.') },
            details: [],
            reason: null,
          },
        ],
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
  if (request.method === 'GET' && url.pathname === '/api/v1/professional/dashboard/queue/events') {
    response.writeHead(200, {
      'Cache-Control': 'private, no-store, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    });
    response.write(': heartbeat\n\n');
    eventStreams.add(response);
    request.on('close', () => eventStreams.delete(response));
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/v1/professional/dashboard/queue') {
    // Espelha `DashboardService.queue()` (achado 2026-08-18): a Fila de supervisão só
    // lista protocolo + PAR-Q bloqueado — handoff/check-in ficam fora desta tela.
    const openItems = [...items, ...(realtimeVisible ? [realtimeItem] : [])].filter(
      (item) => !resolvedIds.has(item.id) && (item.kind === 'PROTOCOL' || item.kind === 'PARQ'),
    );
    const mandatory = openItems.filter((item) => item.kind === 'PARQ');
    const optional = openItems.filter((item) => item.kind === 'PROTOCOL');
    return json(response, 200, {
      mandatory,
      optional,
      counts: {
        mandatory: mandatory.length,
        optional: optional.length,
        total: openItems.length,
      },
    });
  }
  if (request.method === 'GET' && url.pathname === '/api/v1/professional/dashboard/operations') {
    return json(response, 200, {
      funnel: { formStarted: 100, protocolSent: 80, firstWorkout: null, converted: 22 },
      sla: {
        protocolDeliveryMinutes: 132,
        coachP95Seconds: null,
        protocolBreached: true,
        coachBreached: false,
      },
      replays: [replay],
    });
  }

  const detail =
    /^\/api\/v1\/professional\/dashboard\/queue\/(protocol|handoff|parq|checkin)\/([^/]+)$/i.exec(
      url.pathname,
    );
  if (request.method === 'GET' && detail) {
    const kind = detail[1].toUpperCase();
    const item = items.find((entry) => entry.kind === kind);
    if (!item) return json(response, 404, { message: 'Not found' });
    const body = { item, context: { goal: 'Hipertrofia', level: 'Intermediário' }, replay };
    if (kind === 'PROTOCOL') {
      body.protocol = {
        id: PROTOCOL_ID,
        version: 1,
        status: 'DRAFT',
        approvalStatus: 'PENDING_REVIEW',
        content: protocolContent,
        signedAt: null,
        signatureHash: null,
      };
    }
    if (kind === 'HANDOFF' || kind === 'CHECKIN')
      body.handoff = { reason: item.summary, level: 'SAFETY', status: 'OPEN' };
    if (kind === 'PARQ')
      body.parq = { flags: ['Resposta positiva no questionário'], state: item.status };
    return json(response, 200, body);
  }

  const resolution =
    request.method === 'POST' &&
    /^\/api\/v1\/professional\/dashboard\/handoffs\/([^/]+)\/resolve$/.exec(url.pathname);
  if (resolution) {
    const body = await readBody(request);
    if (
      body.confirmation !== true ||
      typeof body.resolution !== 'string' ||
      typeof body.notes !== 'string'
    ) {
      return json(response, 400, { message: 'Invalid resolution' });
    }
    resolvedIds.add(resolution[1]);
    return json(response, 200, { status: 'RESOLVED' });
  }

  if (
    request.method === 'POST' &&
    /\/professional\/dashboard\/(protocols\/[^/]+\/sign|parq\/[^/]+\/release)$/.test(url.pathname)
  ) {
    if (url.pathname.includes('/parq/')) {
      const body = await readBody(request);
      if (body.decision !== 'RELEASED' || body.confirmation !== true) {
        return json(response, 400, { message: 'Invalid PAR-Q decision' });
      }
    }
    return json(response, 200, { status: 'ok' });
  }
  if (
    request.method === 'PATCH' &&
    /\/professional\/dashboard\/protocols\/[^/]+$/.test(url.pathname)
  ) {
    return json(response, 200, { status: 'PENDING_REVIEW' });
  }
  return json(response, 404, { message: 'Not found' });
}).listen(PORT, '127.0.0.1');
