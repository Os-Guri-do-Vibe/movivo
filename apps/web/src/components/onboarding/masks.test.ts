import { describe, expect, it } from 'vitest';

import {
  CLOCK_HM,
  CLOCK_HMS,
  CLOCK_SLEEP,
  clockToTotal,
  maskClock,
  maskCurrency,
  maskNumber,
  maskRaceTime,
  minutesToClock,
  secondsToClock,
  secondsToRaceTime,
} from './masks';

/** Digita um texto caractere a caractere, como o navegador entrega ao `onChange`. */
function type(mask: (input: string, previous: string) => string, keys: string): string {
  let text = '';
  for (const key of keys) text = mask(text + key, text);
  return text;
}

describe('maskClock', () => {
  it('hh:mm: insere o separador e completa o dígito solitário', () => {
    const mask = (input: string, previous: string) => maskClock(input, previous, CLOCK_HM);
    expect(type(mask, '1')).toBe('01:');
    expect(type(mask, '130')).toBe('01:30');
    expect(type(mask, '0045')).toBe('00:45');
  });

  it('limita minutos e horas aos máximos do campo', () => {
    const mask = (input: string, previous: string) => maskClock(input, previous, CLOCK_SLEEP);
    expect(type(mask, '1')).toBe('1');
    expect(type(mask, '19')).toBe('12:');
    expect(type(mask, '0759')).toBe('07:59');
    expect(type(mask, '07' + '7')).toBe('07:07');
    expect(type(mask, '7')).toBe('07:');
  });

  it('hh:mm:ss: preenche os três campos', () => {
    const mask = (input: string, previous: string) => maskClock(input, previous, CLOCK_HMS);
    expect(type(mask, '1')).toBe('01:');
    expect(type(mask, '12500')).toBe('01:25:00');
    expect(type(mask, '1250099')).toBe('01:25:00');
  });

  it('backspace no separador apaga o dígito anterior', () => {
    expect(maskClock('01', '01:', CLOCK_HM)).toBe('0');
    expect(maskClock('01:3', '01:30', CLOCK_HM)).toBe('01:3');
    expect(maskClock('', '1', CLOCK_HM)).toBe('');
  });
});

describe('maskRaceTime', () => {
  it('até 4 dígitos é mm:ss', () => {
    expect(type(maskRaceTime, '2')).toBe('2');
    expect(type(maskRaceTime, '27')).toBe('27:');
    expect(type(maskRaceTime, '2730')).toBe('27:30');
  });

  it('duração de sessão: 45 e 4500 viram 45:00, 13000 vira 1:30:00', () => {
    expect(type(maskRaceTime, '45')).toBe('45:');
    expect(type(maskRaceTime, '4500')).toBe('45:00');
    expect(type(maskRaceTime, '13000')).toBe('1:30:00');
  });

  it('a partir do 5º dígito vira h:mm:ss', () => {
    expect(type(maskRaceTime, '10530')).toBe('1:05:30');
    expect(type(maskRaceTime, '123456')).toBe('12:34:56');
    expect(type(maskRaceTime, '2000000')).toBe('20:00:00');
  });

  it('dígito que não cabe no campo fecha o campo com zero à esquerda', () => {
    expect(type(maskRaceTime, '1059')).toBe('10:59');
    expect(type(maskRaceTime, '279')).toBe('27:09');
  });
});

describe('maskNumber', () => {
  it('aceita vírgula ou ponto e normaliza para ponto', () => {
    expect(maskNumber('39,9', 3, 1)).toBe('39.9');
    expect(maskNumber('39.97', 3, 1)).toBe('39.9');
  });

  it('descarta o que não é número e respeita o tamanho', () => {
    expect(maskNumber('abc12x', 3, 1)).toBe('12');
    expect(maskNumber('12345', 3, 1)).toBe('123');
    expect(maskNumber('5.5', 1, 0)).toBe('5');
    expect(maskNumber('1.2.3', 3, 1)).toBe('1.2');
  });
});

describe('maskCurrency', () => {
  it('trata o que se digita como centavos e mantém as duas casas decimais', () => {
    expect(maskCurrency('')).toBe('');
    expect(maskCurrency('1')).toBe('R$ 0,01');
    expect(maskCurrency('15')).toBe('R$ 0,15');
    expect(maskCurrency('150')).toBe('R$ 1,50');
    expect(maskCurrency('15000')).toBe('R$ 150,00');
    expect(maskCurrency('123456789')).toBe('R$ 1.234.567,89');
  });

  it('aceita o texto já formatado (apagar o último dígito desloca tudo)', () => {
    expect(maskCurrency('R$ 1,5')).toBe('R$ 0,15');
    expect(maskCurrency('R$ 1.234,56')).toBe('R$ 1.234,56');
  });

  it('limita o tamanho e ignora zeros à esquerda e o que não é número', () => {
    expect(maskCurrency('1234567890')).toBe('R$ 1.234.567,89');
    expect(maskCurrency('0005')).toBe('R$ 0,05');
    expect(maskCurrency('abc')).toBe('');
  });
});

describe('conversões de relógio', () => {
  it('lê hh:mm como minutos e hh:mm:ss como segundos', () => {
    expect(clockToTotal('01:30')).toBe(90);
    expect(clockToTotal('01:25:00')).toBe(5100);
    expect(clockToTotal('27:30')).toBe(1650);
  });

  it('texto incompleto não vira número', () => {
    expect(clockToTotal('01:')).toBeUndefined();
    expect(clockToTotal('')).toBeUndefined();
    expect(clockToTotal('ab')).toBeUndefined();
  });

  it('formata de volta', () => {
    expect(minutesToClock(90)).toBe('01:30');
    expect(secondsToClock(5100)).toBe('01:25:00');
    expect(secondsToRaceTime(1650)).toBe('27:30');
    expect(secondsToRaceTime(3930)).toBe('1:05:30');
  });
});
