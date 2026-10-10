import { describe, expect, it } from 'vitest';

import {
  isSubscribeIntent,
  isSubscriptionManagementIntent,
  normalizeBrazilianPhone,
} from './subscription-access';

describe('normalizeBrazilianPhone — casamento exato, sem heurística de 9º dígito', () => {
  it.each([
    ['11987654321', '+5511987654321'],
    ['(11) 98765-4321', '+5511987654321'],
    ['5511987654321', '+5511987654321'],
    ['1133334444', '+551133334444'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeBrazilianPhone(input)).toBe(expected);
  });

  it.each(['', '123', '119876543210123', '00551198765432', '9998765432100'])(
    '%s → null',
    (input) => {
      expect(normalizeBrazilianPhone(input)).toBeNull();
    },
  );

  it('nunca "conserta" o número: sem o 9º dígito vira outro telefone, não o mesmo', () => {
    expect(normalizeBrazilianPhone('1187654321')).toBe('+551187654321');
    expect(normalizeBrazilianPhone('1187654321')).not.toBe(normalizeBrazilianPhone('11987654321'));
  });
});

describe('isSubscriptionManagementIntent', () => {
  it.each([
    'quero cancelar minha assinatura',
    'Cancelar plano',
    'Como faço para cancelar o meu plano?',
    'quero cancelar',
    'Cancelar!',
    'sair',
    'cancelamento da mensalidade',
    'gostaria de encerrar minha assinatura',
    'não quero mais pagar',
    'parem de me cobrar',
    'quero meu dinheiro de volta, estorno por favor',
    'direito de arrependimento',
    'preciso de reembolso',
    'CANCELAR ASSINATURA',
    'cancelar a cobrança',
    'quero parar de pagar',
  ])('reconhece "%s"', (text) => {
    expect(isSubscriptionManagementIntent(text)).toBe(true);
  });

  it.each([
    'qual a técnica do agachamento?',
    'quero cancelar o treino de hoje',
    'posso trocar o exercício?',
    'bom dia!',
    'dor no joelho depois do treino',
    'treinei hoje',
    '',
    '   ',
  ])('não confunde "%s" com cancelamento', (text) => {
    expect(isSubscriptionManagementIntent(text)).toBe(false);
  });

  it('texto gigante não é pedido de cancelamento (e não pesa no regex)', () => {
    expect(isSubscriptionManagementIntent(`cancelar assinatura ${'a'.repeat(300)}`)).toBe(false);
  });
});

describe('isSubscribeIntent', () => {
  it.each([
    'quero assinar',
    'quero voltar a assinar',
    'quero assinar de novo',
    'Gostaria de reativar minha assinatura',
    'como faço para renovar meu plano?',
    'me manda o link de pagamento',
    'como eu pago?',
    'vou voltar a pagar',
    'assinar novamente',
  ])('reconhece "%s"', (text) => {
    expect(isSubscribeIntent(text)).toBe(true);
  });

  it.each([
    'quero renovar meu treino',
    'qual a técnica do agachamento?',
    'bom dia',
    'cancelar assinatura',
    '',
  ])('não confunde "%s" com pedido de assinatura', (text) => {
    expect(isSubscribeIntent(text)).toBe(false);
  });
});
