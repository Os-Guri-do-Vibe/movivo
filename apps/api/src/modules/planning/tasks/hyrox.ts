/**
 * Tarefa `hyrox.build_block` — o bloco específico de HYROX (estações, corrida comprometida,
 * simulados). A corrida "pura" e a força geral continuam com os outros treinadores; aqui entra
 * o que é próprio da prova: encadear corrida e estação, ritmo de prova e técnica das estações.
 */
import { z } from 'zod';

import { hyroxStationSchema, type HyroxStation } from '@movivo/shared';

import { defineAgentTask, type Validator, type Violation } from '../../../core/agents/agent-task';
import { hyroxRules } from '../calc/params';
import { blockOutputSchema, totalFrequency, type BlockOutput } from './blocks';
import { outputLanguageViolations } from './common';

export const hyroxInputSchema = z.object({
  level: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
  division: z.enum(['OPEN', 'PRO', 'DOUBLES', 'RELAY']),
  category: z.enum(['openMale', 'openFemale', 'proMale', 'proFemale']),
  phase: z.enum(['BASE', 'BUILD', 'PEAK', 'TAPER', 'MAINTENANCE']),
  weeksToRace: z.number().int().min(0).max(60).nullable(),
  sessionsPerWeek: z.number().int().min(1).max(5),
  minutesPerSession: z.number().int().min(20).max(180),
  weeksInBlock: z.number().int().min(2).max(12),
  /** Hoje é semana de simulado segundo a periodicidade da metodologia. */
  simulationDue: z.boolean(),
  /** Estações com equipamento oficial na academia do aluno; as demais usam alternativa. */
  stationsWithEquipment: z.array(hyroxStationSchema).max(8),
  /** O que o aluno já faz de corrida por semana (km), para não prescrever volume absurdo. */
  currentWeeklyKm: z.number().min(0).max(300),
  modalityPriority: z.number().int().min(1).max(3),
});
export type HyroxInput = z.infer<typeof hyroxInputSchema>;

/** Folga sobre a carga oficial em treino: não se treina muito acima do peso de prova. */
const TRAINING_LOAD_CEILING = 1.2;

export const hyroxValidators: Validator<HyroxInput, BlockOutput>[] = [
  (input, output) => {
    const violations: Violation[] = [];
    output.sessions.forEach((s, index) => {
      if (s.content.modality !== 'HYROX') {
        violations.push({
          path: `sessions.${index}.content.modality`,
          message: 'este bloco só contém sessões de HYROX',
        });
      }
      if (s.estimatedMinutes > input.minutesPerSession) {
        violations.push({
          path: `sessions.${index}.estimatedMinutes`,
          message: `${s.estimatedMinutes} min passa do tempo disponível (${input.minutesPerSession} min)`,
        });
      }
    });
    if (totalFrequency(output.sessions) !== input.sessionsPerWeek) {
      violations.push({
        path: 'sessions',
        message: `a soma das frequências semanais deve ser ${input.sessionsPerWeek} (veio ${totalFrequency(output.sessions)})`,
      });
    }
    return violations;
  },

  // Corrida comprometida, simulado e polimento seguem a metodologia e a fase.
  (input, output, context) => {
    const rules = hyroxRules(context.methodology.HYROX, input.category);
    const violations: Violation[] = [];
    const count = (kind: string) =>
      output.sessions
        .filter((s) => s.content.modality === 'HYROX' && s.content.kind === kind)
        .reduce((sum, s) => sum + s.weeklyFrequency, 0);
    const compromised = count('COMPROMISED_RUNNING');
    const simulations = count('SIMULATION');
    if (rules.compromisedRunningPerWeek !== null && compromised > rules.compromisedRunningPerWeek) {
      violations.push({
        path: 'sessions',
        message: `${compromised} sessões de corrida comprometida; o máximo é ${rules.compromisedRunningPerWeek}`,
      });
    }
    if (input.phase === 'PEAK' && compromised < 1 && input.sessionsPerWeek >= 2) {
      violations.push({
        path: 'sessions',
        message: 'na fase específica deve haver ao menos uma sessão de corrida comprometida',
      });
    }
    if (simulations > 1) {
      violations.push({ path: 'sessions', message: 'no máximo um simulado por semana' });
    }
    if (simulations > 0 && !input.simulationDue) {
      violations.push({
        path: 'sessions',
        message: 'ainda não é semana de simulado segundo a periodicidade da metodologia',
      });
    }
    if (simulations > 0 && (input.phase === 'TAPER' || (input.weeksToRace ?? 99) <= 1)) {
      violations.push({
        path: 'sessions',
        message: 'sem simulado na semana da prova ou no polimento',
      });
    }
    return violations;
  },

  // Cargas e equipamento das estações.
  (input, output, context) => {
    const rules = hyroxRules(context.methodology.HYROX, input.category);
    const violations: Violation[] = [];
    const hasEquipment = new Set<HyroxStation>(input.stationsWithEquipment);
    output.sessions.forEach((session, si) => {
      if (session.content.modality !== 'HYROX') return;
      session.content.blocks.forEach((block, bi) => {
        if (block.type !== 'STATION') return;
        const path = `sessions.${si}.content.blocks.${bi}`;
        const race = rules.raceLoadKg[block.station];
        if (race !== undefined && race > 0 && block.loadKg !== undefined) {
          if (block.loadKg > race * TRAINING_LOAD_CEILING) {
            violations.push({
              path: `${path}.loadKg`,
              message: `${block.loadKg} kg em ${block.station} passa de ${TRAINING_LOAD_CEILING * 100}% da carga de prova (${race} kg)`,
            });
          }
        }
        if (!hasEquipment.has(block.station) && block.loadKg !== undefined && block.loadKg > 0) {
          violations.push({
            path: `${path}.loadKg`,
            message: `${block.station} sem equipamento oficial: descreva a alternativa em "notes" e não use a carga oficial`,
          });
        }
      });
    });
    return violations;
  },

  (_input, output) => {
    const violations: Violation[] = [];
    if (!output.sessions.some((s) => s.priority === 'KEY')) {
      violations.push({ path: 'sessions', message: 'marque ao menos uma sessão-chave' });
    }
    return [...violations, ...outputLanguageViolations(output)];
  },
];

export const hyroxTask = defineAgentTask<HyroxInput, BlockOutput>({
  id: 'hyrox.build_block',
  role: 'Treinador de HYROX da MOVIVO. Você prepara o aluno para o formato da prova (oito quilômetros de corrida intercalados com oito estações) com progressão segura e adaptada ao equipamento que ele realmente tem.',
  instructions: `Monte o bloco específico de HYROX do aluno.

Regras de montagem:
1. A soma de weeklyFrequency é exatamente "sessionsPerWeek"; cada sessão cabe em "minutesPerSession".
2. Siga a fase (BASE, BUILD, PEAK, TAPER, MAINTENANCE) e a mistura da metodologia: na base, técnica das estações e motor aeróbio; na construção, volume de estações e corrida comprometida; na fase específica, simulação parcial e ritmo de prova; no polimento, reduza volume mantendo intensidade.
3. Tipos de sessão: STATION_SKILL (técnica), STATION_STRENGTH (força nas estações), COMPROMISED_RUNNING (corrida logo após estação), ENGINE (motor aeróbio) e SIMULATION (só se "simulationDue" for verdadeiro, no máximo um por semana, nunca no polimento).
4. Cargas das estações: nunca acima de 120% da carga oficial da categoria (metodologia); use carga progressiva coerente com o nível. Estação sem equipamento oficial (fora de "stationsWithEquipment") não leva carga oficial — use uma alternativa descrita em "notes".
5. Cada estação usa UM volume (distância, repetições ou duração). Corridas e estações têm alvo de intensidade claro (zona, ritmo, FC ou PSE).
6. Marque ao menos uma sessão-chave. notes: como progredir e o que observar. summary: 2 a 3 frases claras, sem prometer tempo de prova.`,
  tier: 'REASONING',
  methodology: ['HYROX'],
  state: ['identity', 'goals', 'preferences', 'training'],
  input: hyroxInputSchema,
  output: blockOutputSchema,
  validators: hyroxValidators,
  maxCorrectionRounds: 2,
});
