import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const bff = vi.hoisted(() => ({ readBackendSession: vi.fn() }));
vi.mock('../_lib/bff', async () => {
  const actual = await vi.importActual('../_lib/bff');
  return { ...actual, readBackendSession: bff.readBackendSession };
});

import { GET } from './route';

// Atrás do Nginx o Next monta a URL com o host interno; o redirect não pode herdá-lo.
const internal = (query: string) =>
  new NextRequest(`https://localhost:3000/api/dashboard/session${query}`);

beforeEach(() => vi.clearAllMocks());

it('após rotacionar a sessão, devolve redirect relativo ao destino pedido', async () => {
  bff.readBackendSession.mockResolvedValue({ id: 'u1' });
  const response = await GET(internal('?next=%2Fdashboard%2Falunos'));
  expect(response.status).toBe(307);
  expect(response.headers.get('location')).toBe('/dashboard/alunos');
});

it('com a sessão expirada, volta ao login sem expor o host interno', async () => {
  bff.readBackendSession.mockRejectedValue(new Error('expirada'));
  const response = await GET(internal('?next=%2Fdashboard'));
  expect(response.status).toBe(307);
  expect(response.headers.get('location')).toBe('/entrar?erro=sessao-expirada');
});

it('ignora destino fora do dashboard', async () => {
  bff.readBackendSession.mockResolvedValue({ id: 'u1' });
  const response = await GET(internal('?next=%2F%2Fevil.com'));
  expect(response.headers.get('location')).toBe('/dashboard');
});
