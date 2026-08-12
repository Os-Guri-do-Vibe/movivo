import { describe, expect, it } from 'vitest';

import { sanitizeAnalyticsProperties, sanitizeAnalyticsUrl } from './analytics-privacy';

describe('dashboard analytics privacy', () => {
  it('remove query, hash e identificadores das URLs do dashboard', () => {
    expect(
      sanitizeAnalyticsUrl(
        'https://movivo.com/dashboard/alunos/11111111-1111-4111-8111-111111111111?token=segredo#saude',
      ),
    ).toBe('https://movivo.com/dashboard/alunos/:id');
    expect(
      sanitizeAnalyticsUrl(
        '/dashboard/fila/protocol/11111111-1111-4111-8111-111111111111?next=privado',
      ),
    ).toBe('/dashboard/fila/protocol/:id');
  });

  it('não altera páginas públicas', () => {
    expect(sanitizeAnalyticsUrl('https://movivo.com/?utm_source=campanha')).toBe(
      'https://movivo.com/?utm_source=campanha',
    );
  });

  it('remove tokens opacos das rotas públicas sensíveis', () => {
    expect(
      sanitizeAnalyticsUrl(
        'https://movivo.com/anamnese/tkA_segredo_que_identifica_a_sessao?utm_source=campanha',
      ),
    ).toBe('https://movivo.com/anamnese/:token');
    expect(sanitizeAnalyticsUrl('/protocolo/token-de-acesso#treino')).toBe('/protocolo/:token');
    expect(sanitizeAnalyticsUrl('/conta/11111111-1111-4111-8111-111111111111')).toBe('/conta/:id');
  });

  it('sanitiza propriedades de navegação sem tocar nas demais', () => {
    expect(
      sanitizeAnalyticsProperties({
        $pathname: '/dashboard/alunos/aluno-secreto?aba=saude',
        setor: 'cref',
      }),
    ).toEqual({ $pathname: '/dashboard/alunos/:id', setor: 'cref' });
  });
});
