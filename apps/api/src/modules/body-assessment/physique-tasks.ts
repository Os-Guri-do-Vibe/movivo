/**
 * Avaliação física completa por foto (`vision.assess_physique`): a leitura que alimenta o primeiro
 * protocolo. A partir das posições padronizadas (frente, lados e costas), descreve os grupos
 * musculares (pontos fortes e a desenvolver), dá uma FAIXA de gordura corporal e registra
 * observações de postura e simetria, da cabeça aos pés. Tudo é leitura visual com margem de erro:
 * descreve o que se vê e deixa a confirmação para o profissional; nunca diagnostica.
 */
import { z } from 'zod';

import {
  photoAngleSchema,
  physiqueSchema,
  type Physique,
  type PhysiqueMuscleRegion,
  type PostureRegion,
} from '@movivo/shared';

import { defineAgentTask, type Validator, type Violation } from '../../core/agents/agent-task';
import { fold, outputLanguageViolations } from '../planning/tasks/common';

export const physiqueInputSchema = z.object({
  /** Ordem das imagens enviadas. */
  order: z
    .array(z.object({ angle: photoAngleSchema }))
    .min(1)
    .max(4),
  /** Contexto do aluno (sem nome nem foto de rosto): ajuda a ler o que importa para ele. */
  profile: z.object({
    ageYears: z.number().int().min(14).max(100).nullable(),
    biologicalSex: z.string().max(16).nullable(),
    heightCm: z.number().nullable(),
    weightKg: z.number().nullable(),
    goal: z.string().max(80).nullable(),
    modalities: z.array(z.string().max(30)).max(3),
    /** Rotina em uma frase (dias disponíveis, esporte externo). */
    routine: z.string().max(200).nullable(),
    /** Queixa ou desconforto que o aluno relatou, em suas palavras resumidas. */
    complaint: z.string().max(300).nullable(),
  }),
});
export type PhysiqueInput = z.infer<typeof physiqueInputSchema>;

export const physiqueOutputSchema = z.object({
  /** As fotos permitem uma leitura confiável (corpo inteiro, luz, distância e pose)? */
  analyzable: z.boolean(),
  /** Faixa da gordura corporal; nunca um número único. `null` quando não dá para estimar. */
  bodyFatRange: z
    .object({ min: z.number().min(3).max(70), max: z.number().min(3).max(70) })
    .refine((r) => r.min <= r.max)
    .nullable(),
  confidence: z.enum(['LOW', 'MEDIUM']),
  physique: physiqueSchema,
  /** Por que a leitura tem margem de erro (luz, ângulo, roupa, distância). */
  limitations: z.array(z.string().trim().min(8).max(200)).min(1).max(4),
});
export type PhysiqueOutput = z.infer<typeof physiqueOutputSchema>;

/** Julgamento estético e termos pejorativos nunca entram, nem na leitura para o profissional. */
const HARSH = /\b(obes|gord[ao]\b|magro demais|flacid|desproporcional|feio|feia|horrivel)/;

/**
 * Nome de condição clínica não é observação visual: a foto mostra o alinhamento, não a causa. A
 * leitura descreve ("ombros projetados à frente", "joelhos para dentro") e o profissional conclui.
 */
const CLINICAL_LABEL =
  /\b(escolios|hernia|artrose|artrite|tendinit|bursit|condromalac|sindrome|lesao|hipercifose|hiperlordose|patolog)/;

export function physiqueViolations(physique: Physique, path = 'physique'): Violation[] {
  const violations: Violation[] = [];
  const regions = physique.muscleGroups.map((g) => g.region);
  if (new Set<PhysiqueMuscleRegion>(regions).size !== regions.length) {
    violations.push({
      path: `${path}.muscleGroups`,
      message: 'cada grupo muscular aparece uma vez só',
    });
  }
  const segments = physique.posture.map((p) => p.region);
  if (new Set<PostureRegion>(segments).size !== segments.length) {
    violations.push({
      path: `${path}.posture`,
      message: 'cada segmento da postura aparece uma vez só',
    });
  }
  const text = fold(JSON.stringify(physique));
  if (HARSH.test(text)) {
    violations.push({
      path,
      message: 'sem julgamento estético nem termos pejorativos: descreva com neutralidade',
    });
  }
  if (CLINICAL_LABEL.test(text)) {
    violations.push({
      path: `${path}.posture`,
      message:
        'não nomeie condição clínica: descreva o que se vê (ex.: "ombros projetados à frente") e deixe o profissional concluir',
    });
  }
  return violations;
}

export const physiqueValidators: Validator<PhysiqueInput, PhysiqueOutput>[] = [
  (_input, output) => {
    const violations: Violation[] = [];
    const empty =
      output.physique.muscleGroups.length === 0 &&
      output.physique.posture.length === 0 &&
      output.physique.strengths.length === 0 &&
      output.physique.attentionPoints.length === 0;
    if (!output.analyzable) {
      if (output.bodyFatRange !== null || !empty) {
        violations.push({
          path: 'analyzable',
          message:
            'fotos que não permitem uma leitura confiável não trazem faixa de gordura nem avaliação',
        });
      }
    } else {
      if (output.bodyFatRange && output.bodyFatRange.max - output.bodyFatRange.min < 4) {
        violations.push({
          path: 'bodyFatRange',
          message: 'a estimativa visual tem margem de pelo menos 4 pontos percentuais',
        });
      }
      if (output.physique.muscleGroups.length === 0) {
        violations.push({
          path: 'physique.muscleGroups',
          message: 'informe os grupos musculares que a foto deixa avaliar',
        });
      }
    }
    return violations;
  },
  (_input, output) => physiqueViolations(output.physique),
  (_input, output) => outputLanguageViolations(output),
];

/** Regras de leitura compartilhadas com a comparação de fim de ciclo. */
export const PHYSIQUE_READING_RULES = `Avaliação física (campo "physique"):
a) "muscleGroups": para cada grupo que a foto deixa ver (peitoral, costas, ombros, braços, abdômen e core, quadríceps, posterior de coxa, glúteos, panturrilhas), diga o status: STRENGTH (ponto forte: bem desenvolvido para este aluno), BALANCED, TO_DEVELOP (a desenvolver: menos desenvolvido que o conjunto) ou NOT_ASSESSABLE (não dá para ver). Uma nota curta e objetiva por grupo. Compare o grupo com o conjunto do próprio corpo e com o nível de treino dele, não com um padrão ideal.
b) "posture": observe, nas posições enviadas, cabeça e cervical, ombros, coluna torácica, coluna lombar, pelve, joelhos e pés. Para cada segmento, descreva o que VÊ (ex.: "cabeça projetada à frente", "ombro direito mais elevado", "pelve inclinada para a frente", "joelhos para dentro", "arco do pé mais baixo"), o grau (NONE_VISIBLE, MILD ou NOTABLE) e em quais posições aparece. Segmento sem alteração visível entra como NONE_VISIBLE; segmento que a foto não mostra, fica de fora. Só descreva: NUNCA nomeie doença, condição clínica nem causa, e não conclua por uma foto. Alterações de alinhamento são percepções por foto, para a pessoa levar a um profissional de saúde (a MOVIVO não faz avaliação presencial). Use NOTABLE só para alteração marcante e visível em mais de uma posição; o que for discreto é MILD.
c) "symmetry": diferenças visíveis entre os lados (ombros, braços, quadril, coxas), ou null se não dá para ver.
d) "strengths" e "attentionPoints": os 2 a 4 destaques mais importantes de cada lado, em frases curtas e respeitosas. Pontos de atenção são oportunidades de treino, nunca defeitos.
e) Sem julgamento estético, sem comparar com padrão de beleza, sem comentar rosto ou identidade, sem diagnóstico, sem promessa de resultado.`;

export const physiqueTask = defineAgentTask<PhysiqueInput, PhysiqueOutput>({
  id: 'vision.assess_physique',
  role: 'Avaliador físico da MOVIVO. Você analisa fotos padronizadas do aluno (frente, lados e costas) como um profissional de educação física faria numa avaliação inicial: descreve o físico, a postura e a simetria com precisão, respeito e cautela.',
  instructions: `Avalie o físico do aluno a partir das fotos, na ordem indicada em "order". "profile" traz idade, sexo biológico, altura, peso, objetivo, modalidades, rotina e a queixa, se houver: use para dar peso ao que importa para ESTE aluno (por exemplo, atenção ao segmento ligado à queixa), sem inventar nada que a foto não mostre.

Regras:
1. Antes de tudo, veja se a leitura é confiável: corpo inteiro, luz, distância e pose adequadas. Se não for, "analyzable": false, tudo vazio e explique em "limitations".
2. "bodyFatRange": uma FAIXA ampla (4 pontos percentuais ou mais), com "confidence" LOW ou MEDIUM; nunca um número único, nunca a afirmação de que é medida. Sem fotos claras, null.
3. ${PHYSIQUE_READING_RULES}
4. Sempre traga ao menos uma limitação (luz, roupa, ângulo, distância, posições que faltam).`,
  tier: 'VISION',
  methodology: [],
  state: [],
  input: physiqueInputSchema,
  output: physiqueOutputSchema,
  validators: physiqueValidators,
  maxCorrectionRounds: 2,
});
