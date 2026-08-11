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
    title: 'Protocolo aguardando revisão',
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
const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': '*' };

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
    anamnesisSessions.set(token, { currentStep: 1, phoneVerified: false, code: null });
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
          { type: 'TERMS_OF_SERVICE', version: 'terms-e2e-v1', title: null, body: [], label: 'Li e aceito os Termos de Uso.', required: true },
          { type: 'HEALTH_DATA', version: 'health-e2e-v1', title: 'Saúde', body: [], label: 'Autorizo o tratamento dos meus dados de saúde.', required: true },
          { type: 'AI_DISCLOSURE', version: 'ai-e2e-v1', title: 'IA', body: [], label: 'Estou ciente de que a MOVIVO usa inteligência artificial.', required: true },
          { type: 'MARKETING', version: 'marketing-e2e-v1', title: null, body: [], label: 'Quero receber novidades.', required: false },
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
      session.currentStep = Number(stepMatch[1]) + 1;
      return json(response, 200, { currentStep: session.currentStep });
    }
    if (rest === '/submit' && request.method === 'POST') {
      return json(response, 200, { status: 'SUBMITTED', outcome: 'READY' });
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
      ? json(response, 200, { userId: 'professional-1', role })
      : json(response, 401, { message: 'Unauthorized' });
  }
  if (request.method === 'POST' && url.pathname === '/api/v1/auth/logout') {
    return json(response, 204, {});
  }

  if (!authenticated(request)) return json(response, 401, { message: 'Unauthorized' });
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
    const openItems = [...items, ...(realtimeVisible ? [realtimeItem] : [])].filter(
      (item) => !resolvedIds.has(item.id),
    );
    return json(response, 200, {
      items: openItems,
      counts: {
        SAFETY: openItems.filter((item) => item.severity === 'SAFETY').length,
        ALERT: openItems.filter((item) => item.severity === 'ALERT').length,
        ROUTINE: openItems.filter((item) => item.severity === 'ROUTINE').length,
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
