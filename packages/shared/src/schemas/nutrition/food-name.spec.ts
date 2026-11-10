import { describe, expect, it } from 'vitest';

import { normalizeFoodName } from './food-name';

describe('nome de alimento do protocolo', () => {
  it.each([
    // Os exemplos pedidos.
    ['Ovo, de galinha, inteiro, cozido', 'Ovo de galinha cozido'],
    ['Pão, trigo, francês', 'Pão francês'],
    // Cereais, grãos e hortaliças.
    ['Arroz, integral, cozido', 'Arroz integral cozido'],
    ['Arroz, tipo 1, cozido', 'Arroz branco cozido'],
    ['Feijão, preto, cozido', 'Feijão preto cozido'],
    ['Macarrão, trigo, cru', 'Macarrão cru'],
    ['Pão, trigo, forma, integral', 'Pão de forma integral'],
    ['Pão, aveia, forma', 'Pão de aveia de forma'],
    ['Pão, de queijo, assado', 'Pão de queijo assado'],
    ['Batata, doce, cozida', 'Batata doce cozida'],
    ['Farinha, de centeio, integral', 'Farinha de centeio integral'],
    ['Banana, ouro, crua', 'Banana ouro crua'],
    // Carnes: o corte vira o nome, o preparo vem antes de "com/sem".
    ['Frango, peito, sem pele, cozido', 'Peito de frango cozido sem pele'],
    ['Frango, coxa, com pele, assada', 'Coxa de frango assada com pele'],
    ['Frango, inteiro, sem pele, cozido', 'Frango inteiro cozido sem pele'],
    ['Carne, bovina, patinho, sem gordura, cru', 'Patinho bovino cru sem gordura'],
    ['Carne, bovina, maminha, grelhada', 'Maminha bovina grelhada'],
    [
      'Carne, bovina, contra-filé, com gordura, grelhado',
      'Contra-filé bovino grelhado com gordura',
    ],
    ['Carne, bovina, seca, cozida', 'Carne seca cozida'],
    ['Carne, bovina, charque, cru', 'Charque cru'],
    [
      'Carne, bovina, filé mingnon, sem gordura, grelhado',
      'Filé mignon bovino grelhado sem gordura',
    ],
    [
      'Carne, bovina, miolo de alcatra, sem gordura, cru',
      'Miolo de alcatra bovino cru sem gordura',
    ],
    ['Carne, bovina, almôndegas, fritas', 'Almôndegas bovinas fritas'],
    ['Ovo, de galinha, gema, cozida/10minutos', 'Gema de ovo cozida'],
    ['Ovo, de galinha, clara, cozida/10minutos', 'Clara de ovo cozida'],
    ['Ovo, de codorna, inteiro, cru', 'Ovo de codorna cru'],
    ['Coco, água de', 'Água de coco'],
    ['Cana, caldo de', 'Caldo de cana'],
    ['Arroz, tipo 2, cozido', 'Arroz tipo 2 cozido'],
    ['Porco, bisteca, frita', 'Bisteca de porco frita'],
    ['Pescada, filé, frito', 'Filé de pescada frito'],
    ['Salmão, sem pele, fresco, cru', 'Salmão fresco cru sem pele'],
    // Laticínios e outros.
    ['Leite, de vaca, desnatado, UHT', 'Leite desnatado UHT'],
    ['Leite, de vaca, integral', 'Leite integral'],
    ['Iogurte, natural', 'Iogurte natural'],
    ['Queijo, requeijão, cremoso', 'Requeijão cremoso'],
    ['Queijo, parmesão', 'Queijo parmesão'],
    ['Soja, queijo (tofu)', 'Tofu'],
    ['Nhoque, batata, cozido', 'Nhoque de batata cozido'],
    ['Mortadela', 'Mortadela'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeFoodName(raw)).toBe(expected);
  });

  it('tira o ruído de tabela: tempo de cozimento, espaços repetidos e nas pontas', () => {
    expect(normalizeFoodName('Ovo, de galinha, inteiro, cozido/10minutos')).toBe(
      'Ovo de galinha cozido',
    );
    expect(normalizeFoodName(' Mamão, doce em calda,  drenado ')).toBe(
      'Mamão doce em calda drenado',
    );
    expect(normalizeFoodName('Couve, manteiga, refogada ')).toBe('Couve manteiga refogada');
    expect(normalizeFoodName('')).toBe('');
  });

  it('é idempotente: um nome já normalizado volta igual (planos antigos e novos convivem)', () => {
    for (const name of [
      'Ovo de galinha cozido',
      'Peito de frango cozido sem pele',
      'Pão francês',
      'Tofu',
      'Maminha bovina grelhada',
    ]) {
      expect(normalizeFoodName(name)).toBe(name);
    }
    const once = normalizeFoodName('Frango, peito, sem pele, cozido');
    expect(normalizeFoodName(once)).toBe(once);
  });

  it('corte desconhecido não quebra: cai no nome da carne', () => {
    expect(normalizeFoodName('Carne, bovina, rabada, cozida')).toBe('Carne bovina rabada cozida');
  });
});
