/**
 * Regras determinísticas da sentinela sobre o TEXTO do aluno: rodam sempre, antes e
 * independentemente de qualquer modelo. O detector de LLM só ACRESCENTA sinais; nunca remove o
 * que estas regras acharam. Casamento sobre texto sem acento e em minúsculas.
 */
import type { SafetySignalKind } from '@movivo/shared';

import { fold } from '../planning/tasks/common';

interface TextRule {
  kind: SafetySignalKind;
  pattern: RegExp;
}

const RULES: readonly TextRule[] = [
  {
    kind: 'CHEST_PAIN',
    pattern:
      /(dor|aperto|pressao|queimacao|pontada|desconforto)[^.!?]{0,25}(no |do |em )?(peito|torax|coracao)|(peito|torax|coracao)[^.!?]{0,20}(doendo|apertando|apertado|dor)/,
  },
  {
    kind: 'FAINTING_OR_DIZZINESS',
    pattern:
      /desmai|apaguei|quase (desmaiei|cai)|vista escureceu|visao escureceu|tontura forte|muito tonto|tonta demais|me deu (um )?branco e cai/,
  },
  {
    kind: 'SHORTNESS_OF_BREATH',
    pattern:
      /falta de ar|sem ar|nao consigo respirar|dificuldade (pra|para|de) respirar|ofegante demais|ar nao entra/,
  },
  {
    kind: 'SEVERE_PAIN',
    pattern:
      /(dor|dores)[^.!?]{0,20}(insuportavel|muito forte|fortissima|intensa|terrivel|de (8|9|10))|nao aguento (a )?dor|dor (de )?(8|9|10)\b/,
  },
  {
    kind: 'NEW_INJURY',
    pattern:
      /(torci|luxei|estirei|rompi|rasguei|fraturei|quebrei)\b|senti (um )?estalo|ouvi (um )?estalo|rompimento|me lesionei/,
  },
  {
    kind: 'PREGNANCY',
    pattern: /estou gravida|to gravida|descobri que (estou|to) gravida|gestante/,
  },
  {
    kind: 'RECENT_SURGERY',
    pattern: /fiz (uma )?cirurgia|operei (o|a|os|as)? ?\w+ (semana|mes)|pos[- ]operatorio/,
  },
  {
    kind: 'MEDICATION_CHANGE',
    pattern:
      /(comecei|iniciei|parei|troquei|aumentei|diminui)[^.!?]{0,20}(remedio|medicacao|medicamento|anticoncepcional|antidepressivo)/,
  },
  {
    kind: 'EATING_DISORDER_SIGNS',
    pattern:
      /(provoco|provocar|forcar) (o )?vomito|vomito (depois|apos) (de )?comer|compulsao|(nao )?comer (nada )?o dia (todo|inteiro)|passo (dias|o dia) sem comer|odeio (meu|o meu) corpo|me (sinto|acho) (gorda|gordo) demais|laxante pra emagrecer/,
  },
  {
    kind: 'MENTAL_DISTRESS',
    pattern:
      /(quero|vou|penso em) (me )?(matar|sumir|morrer|acabar com tudo)|nao (vejo|tenho) (mais )?saida|nao quero mais viver|automutil|me machuc(ar|ando) de proposito/,
  },
];

export interface TextSignal {
  kind: SafetySignalKind;
  /** Trecho que casou (curto), para o caso na fila; nunca a mensagem inteira. */
  evidence: string;
}

/** Sinais achados pelas regras no texto (um por tipo). */
export function textSignals(message: string): TextSignal[] {
  const folded = fold(message);
  const found = new Map<SafetySignalKind, TextSignal>();
  for (const rule of RULES) {
    const match = rule.pattern.exec(folded);
    if (match && !found.has(rule.kind)) {
      found.set(rule.kind, { kind: rule.kind, evidence: match[0].slice(0, 120) });
    }
  }
  return [...found.values()];
}
