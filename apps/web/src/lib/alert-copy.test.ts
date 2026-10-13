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

  it('alerta de 3ª falta seguida: texto com o nome completo do aluno para o profissional CREF', () => {
    const copy = alertCopyFor({
      level: 'ALERT',
      reason: 'FALTAS_SEGUIDAS',
      studentName: 'Maria Souza Lima',
    });
    expect(copy.title).toBe('Faltas seguidas nos treinos');
    expect(copy.detail).toBe(
      'O aluno Maria Souza Lima faltou pela 3ª sessão de treino seguida. Entre em contato para entender o motivo.',
    );
  });

  it('alerta de mais de 60% de faltas: texto com o nome completo do aluno', () => {
    const copy = alertCopyFor({
      level: 'ALERT',
      reason: 'FALTAS_FREQUENTES',
      studentName: ' Pedro Alves ',
    });
    expect(copy.title).toBe('Muitas faltas nos treinos');
    expect(copy.detail).toBe(
      'O aluno Pedro Alves faltou a mais de 60% das sessões de treino das últimas duas semanas. Entre em contato para entender o motivo.',
    );
  });

  it('sem o nome do aluno, o alerta de frequência usa o texto genérico', () => {
    for (const studentName of [undefined, null, '  ']) {
      const copy = alertCopyFor({ level: 'ALERT', reason: 'FALTAS_SEGUIDAS', studentName });
      expect(copy.detail).toBe(
        'O aluno faltou pela 3ª sessão de treino seguida. Entre em contato para entender o motivo.',
      );
    }
  });

  it('rotula a origem dos alertas de frequência', () => {
    expect(alertSourceLabel('ATTENDANCE_STREAK')).toBe('Frequência de treino');
    expect(alertSourceLabel('ATTENDANCE_RATE')).toBe('Frequência de treino');
    expect(alertOriginNote('ATTENDANCE_STREAK')).toBe(
      'Gerado a partir da frequência de treinos do aluno.',
    );
    expect(isConversationSource('ATTENDANCE_RATE')).toBe(false);
  });

  it('rotula o alerta de dor informada como motivo de treino sem registro', () => {
    expect(alertCopyFor({ level: 'ALERT', reason: 'AUSENCIA_DOR' })).toMatchObject({
      title: 'Dor como motivo de treino sem registro',
    });
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
