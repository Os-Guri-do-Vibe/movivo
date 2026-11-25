import { describe, expect, it } from 'vitest';

import { friendlyMessage, looksPortuguese } from './api-message';

describe('mensagens de erro em português', () => {
  it('troca o texto técnico em inglês por uma frase simples do status', () => {
    expect(
      friendlyMessage(404, 'Cannot GET /api/v1/control-center/methodology/documents/1/discard'),
    ).toBe('Não encontramos o que você pediu. Atualize a página e tente de novo.');
    expect(friendlyMessage(500, 'Internal server error')).toBe(
      'Algo deu errado do nosso lado. Tente de novo em instantes.',
    );
    expect(friendlyMessage(400, 'Bad Request')).toContain('Confira os campos');
    expect(friendlyMessage(0, undefined)).toBe(
      'Não foi possível concluir a operação. Tente de novo.',
    );
  });

  it('mantém a frase do servidor quando ela já está em português', () => {
    const own =
      'Esta versão ainda não passou nos testes. Rode o teste com os agentes antes de publicar.';
    expect(friendlyMessage(409, own)).toBe(own);
    expect(friendlyMessage(422, 'Sessão expirada')).toBe('Sessão expirada');
  });

  it('usa o texto de reserva de quem chamou, se houver', () => {
    expect(friendlyMessage(500, 'Internal server error', 'Não foi possível salvar.')).toBe(
      'Não foi possível salvar.',
    );
  });

  it('reconhece português curto e rejeita inglês técnico', () => {
    expect(looksPortuguese('Valor fora da faixa')).toBe(true);
    expect(looksPortuguese('Não encontrado')).toBe(true);
    expect(looksPortuguese('Cannot POST /x')).toBe(false);
    expect(looksPortuguese('fetch failed')).toBe(false);
    expect(looksPortuguese('')).toBe(false);
  });
});
