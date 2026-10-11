import { describe, expect, it } from 'vitest';

import {
  anamnesisStatus,
  experienceLabel,
  goalLabel,
  humanize,
  parqStatus,
  planLabel,
  protocolStatus,
  registrationStatus,
  subscriptionStatus,
  weekdaysLabel,
} from './student-labels';

describe('student-labels', () => {
  it('traduz status e atribui o tom de cor', () => {
    expect(anamnesisStatus('SUBMITTED')).toEqual({ label: 'Enviada', tone: 'positive' });
    expect(subscriptionStatus('TRIALING')).toEqual({ label: 'Em teste', tone: 'neutral' });
    expect(protocolStatus('PENDING_SIGNATURE')?.label).toBe('Aguardando assinatura CREF');
    expect(registrationStatus('CHURNED')?.label).toBe('Cancelado');
  });

  it('reserva o coral (attention) a alerta real', () => {
    expect(parqStatus('BLOQUEADO_AGUARDANDO_CLEARANCE')).toEqual({
      label: 'Bloqueado: aguarda CREF',
      tone: 'attention',
    });
    expect(subscriptionStatus('PAST_DUE')?.tone).toBe('attention');
    expect(subscriptionStatus('CANCELED')?.tone).not.toBe('attention');
    expect(protocolStatus('PENDING_SIGNATURE')?.tone).not.toBe('attention');
  });

  it('devolve null para vazio, para a tela mostrar "Não informado"', () => {
    expect(anamnesisStatus(null)).toBeNull();
    expect(anamnesisStatus('  ')).toBeNull();
    expect(goalLabel(null)).toBeNull();
    expect(weekdaysLabel([])).toBeNull();
  });

  it('usa as mesmas palavras do formulário de anamnese', () => {
    expect(goalLabel('GAIN_MUSCLE')).toBe('Hipertrofia');
    expect(planLabel('QUARTERLY')).toBe('Trimestral');
    expect(experienceLabel('BEGINNER')).toBe('Iniciante');
  });

  it('ordena e abrevia os dias da semana', () => {
    expect(weekdaysLabel(['SUN', 'WED', 'MON'])).toBe('Seg, Qua, Dom');
  });

  it('código sem rótulo vira texto legível; texto já legível passa intacto', () => {
    expect(humanize('NEW_STATE')).toBe('New state');
    expect(humanize('Hipertrofia')).toBe('Hipertrofia');
    expect(goalLabel('Hipertrofia')).toBe('Hipertrofia');
    expect(subscriptionStatus('SOMETHING_NEW')).toEqual({
      label: 'Something new',
      tone: 'neutral',
    });
  });
});
