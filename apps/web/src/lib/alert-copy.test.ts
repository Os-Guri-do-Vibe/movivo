import { describe, expect, it } from 'vitest';

import {
  alertCopyFor,
  alertOriginNote,
  alertSourceLabel,
  isConversationSource,
} from './alert-copy';

describe('alertCopyFor', () => {
  it('traduz os motivos técnicos para a intervenção compreensível pelo CREF', () => {
    expect(alertCopyFor({ level: 'ALERT', reason: 'FORA_DE_ESCOPO' })).toMatchObject({
      title: 'Assunto fora do escopo do AI Coach',
    });
    expect(alertSourceLabel('PROTOCOL_RENEWAL')).toBe('Renovação de protocolo');
  });

  it('usa um texto genérico coerente com o nível para motivos desconhecidos', () => {
    expect(alertCopyFor({ level: 'SAFETY', reason: 'NOVO_MOTIVO' }).title).toBe(
      'Sinal de segurança',
    );
    expect(alertCopyFor({ level: 'ALERT', reason: 'NOVO_MOTIVO' }).title).toBe(
      'Acompanhamento solicitado pelo AI Coach',
    );
  });

  it('descreve a origem de alertas que não nascem de uma conversa', () => {
    expect(alertOriginNote('WORKOUT')).toBe('Gerado a partir do registro de treino do aluno.');
    expect(alertOriginNote('CHECKIN')).toBe('Gerado a partir do check-in semanal.');
    expect(alertOriginNote('DESCONHECIDA')).toBeNull();
    expect(alertOriginNote(null)).toBeNull();
  });

  it('reconhece a origem conversacional e rotula origens desconhecidas', () => {
    expect(isConversationSource(null)).toBe(true);
    expect(isConversationSource('CONVERSATION')).toBe(true);
    expect(isConversationSource('WORKOUT')).toBe(false);
    expect(alertSourceLabel(null)).toBeNull();
    expect(alertSourceLabel('OUTRA')).toBe('Acompanhamento');
  });
});
