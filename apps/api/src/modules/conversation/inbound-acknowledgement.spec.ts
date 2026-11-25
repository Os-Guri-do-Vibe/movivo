import { describe, expect, it } from 'vitest';

import {
  isAcknowledgementOnly,
  isOnlyAcknowledgements,
  withoutAcknowledgements,
} from './inbound-acknowledgement';

describe('isAcknowledgementOnly', () => {
  it.each([
    'Ok 👌',
    'ok',
    'OK!',
    'okkk',
    '🫡🫡',
    '👍',
    '👍🏽',
    '❤️',
    'valeu',
    'Valeuuu 🙏',
    'blz',
    'beleza, valeu',
    'muito obrigado',
    'obrigada!',
    'tudo certo',
    'tá bom',
    'ta bom',
    'top demais',
    'fechado então',
    'show 💪',
    'combinado',
  ])('"%s" é só confirmação', (text) => {
    expect(isAcknowledgementOnly(text)).toBe(true);
  });

  it.each([
    '',
    '   ',
    'oi',
    'bom dia',
    'bom dia!',
    'tudo bem?',
    'ok?',
    'ok, mas hoje não vou treinar',
    'valeu, e o treino de amanhã?',
    'sim',
    'não',
    'dor no joelho',
    '😭',
    '🤕',
    '😡',
    '👋',
    '...',
    'Bom dia! Amei',
    'a'.repeat(60),
    'ok '.repeat(20),
  ])('"%s" segue o fluxo normal', (text) => {
    expect(isAcknowledgementOnly(text)).toBe(false);
  });
});

describe('isOnlyAcknowledgements', () => {
  it('exige ao menos uma mensagem e que todas sejam confirmação', () => {
    expect(isOnlyAcknowledgements([])).toBe(false);
    expect(isOnlyAcknowledgements(['ok', '👌'])).toBe(true);
    expect(isOnlyAcknowledgements(['ok', 'e o treino?'])).toBe(false);
  });
});

describe('withoutAcknowledgements', () => {
  it('caso Gabriel: o emoji que vem depois do pedido não vira um turno novo', () => {
    expect(withoutAcknowledgements(['Fala Léo , libera o treino pra nois amanh', '🫡🫡'])).toEqual([
      'Fala Léo , libera o treino pra nois amanh',
    ]);
  });

  it('tira a confirmação do meio do lote e mantém a ordem do conteúdo', () => {
    expect(withoutAcknowledgements(['posso trocar o supino?', 'ok', 'tipo por halteres'])).toEqual([
      'posso trocar o supino?',
      'tipo por halteres',
    ]);
  });

  it('lote só de confirmações volta intacto', () => {
    expect(withoutAcknowledgements(['ok', '👌'])).toEqual(['ok', '👌']);
  });

  it('lote sem confirmação não muda', () => {
    expect(withoutAcknowledgements(['oi', 'tudo bem?'])).toEqual(['oi', 'tudo bem?']);
  });
});
