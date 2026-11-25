/**
 * Alimentos de referência dos casos de avaliação do plano alimentar (valores por 100 g no padrão
 * da TACO). O banco real tem a tabela inteira; os casos usam esta lista fixa para o resultado
 * não depender da base carregada.
 */
import type { FoodRow } from '../calc/menu';

const row = (
  id: string,
  name: string,
  category: string,
  energyKcal: number,
  proteinG: number,
  carbsG: number,
  fatG: number,
  fiberG = 0,
): FoodRow => ({
  id,
  name,
  category,
  per100g: { energyKcal, proteinG, carbsG, fatG, fiberG },
});

const CER = 'Cereais e derivados';
const CAR = 'Carnes e derivados';
const PES = 'Pescados e frutos do mar';
const LEG = 'Leguminosas e derivados';
const LEI = 'Leite e derivados';
const FRU = 'Frutas e derivados';
const VER = 'Verduras, hortaliças e derivados';
const OVO = 'Ovos e derivados';
const NOZ = 'Nozes e sementes';
const GOR = 'Gorduras e óleos';

export const EVAL_FOOD_ROWS: readonly FoodRow[] = [
  row('eval-arroz-integral', 'Arroz, integral, cozido', CER, 124, 2.6, 25.8, 1, 2.7),
  row('eval-arroz-branco', 'Arroz, tipo 1, cozido', CER, 128, 2.5, 28.1, 0.2, 1.6),
  row('eval-macarrao', 'Macarrão, trigo, cozido', CER, 102, 3.4, 19.9, 0.5, 1.2),
  row('eval-pao-frances', 'Pão, trigo, francês', CER, 300, 8, 58.6, 3.1, 2.3),
  row('eval-pao-forma-integral', 'Pão, trigo, forma, integral', CER, 253, 9.4, 49.9, 3.4, 6.9),
  row('eval-aveia', 'Aveia, flocos, crua', CER, 394, 13.9, 66.6, 8.5, 9.1),
  row('eval-cuscuz', 'Cuscuz, milho, cozido', CER, 113, 2.2, 25.3, 0.7, 2.1),
  row('eval-frango', 'Frango, peito, sem pele, grelhado', CAR, 159, 32, 0, 2.5),
  row('eval-frango-coxa', 'Frango, sobrecoxa, sem pele, assada', CAR, 233, 28.5, 0, 12.2),
  row('eval-carne-moida', 'Carne, bovina, acém, moído, cozido', CAR, 212, 26.7, 0, 10.9),
  row('eval-patinho', 'Carne, bovina, patinho, sem gordura, grelhado', CAR, 219, 35.9, 0, 7.3),
  row('eval-porco', 'Porco, lombo, assado', CAR, 210, 35.7, 0, 6.4),
  row('eval-tilapia', 'Peixe, tilápia, grelhado', PES, 128, 26, 0, 2.7),
  row('eval-atum', 'Atum, conserva em óleo', PES, 166, 26.2, 0, 6),
  row('eval-sardinha', 'Sardinha, assada', PES, 164, 32.2, 0, 3.2),
  row('eval-ovo', 'Ovo, de galinha, inteiro, cozido', OVO, 146, 13.3, 0.6, 9.5),
  row('eval-feijao-carioca', 'Feijão, carioca, cozido', LEG, 76, 4.8, 13.6, 0.5, 8.5),
  row('eval-feijao-preto', 'Feijão, preto, cozido', LEG, 77, 4.5, 14, 0.5, 8.4),
  row('eval-lentilha', 'Lentilha, cozida', LEG, 93, 6.3, 16.3, 0.5, 7.9),
  row('eval-grao-de-bico', 'Grão-de-bico, cozido', LEG, 164, 8.9, 27.4, 2.6, 7.6),
  row('eval-soja', 'Soja, queijo (tofu)', LEG, 64, 6.6, 2.1, 4, 0.8),
  row('eval-iogurte', 'Iogurte, natural', LEI, 51, 4.1, 1.9, 3, 0),
  row('eval-leite', 'Leite, de vaca, integral', LEI, 60, 3.2, 4.5, 3.3, 0),
  row('eval-queijo-minas', 'Queijo, minas, frescal', LEI, 264, 17.4, 3.2, 20.2, 0),
  row('eval-ricota', 'Queijo, ricota', LEI, 140, 12.6, 3.8, 8.1, 0),
  row('eval-banana', 'Banana, prata, crua', FRU, 98, 1.3, 26, 0.1, 2),
  row('eval-maca', 'Maçã, fuji, crua', FRU, 56, 0.3, 15.2, 0, 1.3),
  row('eval-laranja', 'Laranja, pêra, crua', FRU, 37, 1, 8.9, 0.1, 0.8),
  row('eval-mamao', 'Mamão, papaia, cru', FRU, 40, 0.5, 10.4, 0.1, 1),
  row('eval-abacaxi', 'Abacaxi, cru', FRU, 48, 0.9, 12.3, 0.1, 1),
  row('eval-batata', 'Batata, inglesa, cozida', VER, 52, 1.2, 11.9, 0, 1.3),
  row('eval-batata-doce', 'Batata, doce, cozida', VER, 77, 0.6, 18.4, 0.1, 2.2),
  row('eval-mandioca', 'Mandioca, cozida', VER, 125, 0.6, 30.1, 0.3, 1.6),
  row('eval-brocolis', 'Brócolis, cozido', VER, 25, 2.1, 4.4, 0.5, 3.4),
  row('eval-cenoura', 'Cenoura, cozida', VER, 30, 0.8, 6.7, 0.2, 2.6),
  row('eval-alface', 'Alface, crespa, crua', VER, 11, 1.3, 1.7, 0.2, 1.8),
  row('eval-tomate', 'Tomate, salada', VER, 21, 0.8, 5.1, 0.2, 1.4),
  row('eval-abobrinha', 'Abobrinha, italiana, cozida', VER, 15, 1.1, 3, 0.2, 1.4),
  row('eval-pasta-amendoim', 'Pasta de amendoim', NOZ, 588, 25, 20, 50, 6),
  row('eval-castanha', 'Castanha-do-Brasil, crua', NOZ, 643, 14.5, 15.1, 63.5, 7.9),
  row('eval-azeite', 'Azeite, de oliva, extra virgem', GOR, 884, 0, 0, 100, 0),
];
