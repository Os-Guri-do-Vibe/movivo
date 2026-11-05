/**
 * Curador da memória: lê o trecho recente da conversa com o aluno e separa o que vale lembrar
 * (rotina, o que motiva, barreiras, contexto de vida, jeito de conversar, marcos) do que é só do
 * momento. Cada fato novo precisa de uma citação da fala DO ALUNO, que o código confere: sem
 * citação real, não entra.
 */
import { z } from 'zod';

import { defineAgentTask, type Validator, type Violation } from '../../core/agents/agent-task';
import { MEMORY_KINDS } from '../../core/database/schema';
import { normalizeMemory } from '../student-state/student-memory';

export const memoryCurationInputSchema = z.object({
  /** Fatos já guardados (com id, para reforçar ou aposentar). */
  existing: z
    .array(z.object({ id: z.uuid(), kind: z.enum(MEMORY_KINDS), text: z.string().max(240) }))
    .max(60),
  /** Trecho recente: o que o aluno escreveu e o que o acompanhamento respondeu. */
  turns: z
    .array(z.object({ from: z.enum(['student', 'coach']), text: z.string().max(600) }))
    .min(1)
    .max(12),
});
export type MemoryCurationInput = z.infer<typeof memoryCurationInputSchema>;

export const memoryCurationSchema = z.object({
  add: z
    .array(
      z.object({
        kind: z.enum(MEMORY_KINDS),
        /** O fato em uma frase curta, sobre o aluno, sem nome nem contato. */
        text: z.string().trim().min(8).max(160),
        importance: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        /** Trecho literal da fala do aluno que sustenta o fato. */
        quote: z.string().trim().min(4).max(160),
      }),
    )
    .max(4),
  /** Ids de fatos que o aluno desmentiu, corrigiu ou que deixaram de valer. */
  retire: z.array(z.uuid()).max(6),
});
export type MemoryCuration = z.infer<typeof memoryCurationSchema>;

const CONTACT =
  /[\w.+-]+@[\w-]+\.[\w.]+|\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/;

export const memoryCurationValidators: Validator<MemoryCurationInput, MemoryCuration>[] = [
  // Citação inventada = fato inventado.
  (input, output) => {
    const studentText = normalizeMemory(
      input.turns
        .filter((t) => t.from === 'student')
        .map((t) => t.text)
        .join(' '),
    );
    return output.add.flatMap((item, i): Violation[] =>
      studentText.includes(normalizeMemory(item.quote))
        ? []
        : [
            {
              path: `add.${i}.quote`,
              message:
                'a citação precisa ser um trecho literal do que o ALUNO escreveu; sem citação real, não registre o fato',
            },
          ],
    );
  },
  (input, output) => {
    const known = new Set(input.existing.map((e) => e.id));
    return output.retire
      .filter((id) => !known.has(id))
      .map((id): Violation => ({ path: 'retire', message: `id desconhecido: ${id}` }));
  },
  // Nada de contato, documento ou nome de terceiros virando memória.
  (_input, output) =>
    output.add
      .map((item, i) => ({ item, i }))
      .filter(({ item }) => CONTACT.test(item.text))
      .map(({ i }): Violation => ({
        path: `add.${i}.text`,
        message: 'sem telefone, e-mail ou documento na memória',
      })),
];

export const memoryCurationTask = defineAgentTask<MemoryCurationInput, MemoryCuration>({
  id: 'memory.curate',
  role: 'Curador da memória do aluno na MOVIVO. Você lê a conversa recente e guarda só o que ajuda a acompanhá-lo de perto nos próximos meses, com respeito e sem exposição.',
  instructions: `Decida o que vale lembrar do aluno a partir do que ELE escreveu nos "turns".

Vale guardar (fato durável, dito pelo aluno):
- ROUTINE: horários, dias, onde e com quem treina, viagens e turnos de trabalho que se repetem.
- MOTIVATION: o que o move (prova, filho, saúde, estética), o que ele diz que o faz desistir ou persistir.
- BARRIER: o que costuma atrapalhar (tempo, cansaço, ansiedade com comida, falta de equipamento).
- PREFERENCE: o que ele gosta ou detesta em treino, comida e jeito de ser acompanhado.
- PERSONAL: contexto de vida que muda o acompanhamento (filhos pequenos, mudança, rotina de plantão).
- HEALTH_CONTEXT: condição ou cuidado de saúde que ele mesmo contou (ex.: "joelho direito sensível em agachamento profundo").
- COMMUNICATION: como prefere conversar (mensagens curtas, áudio, tratamento, apelido).
- MILESTONE: conquista dele (primeira corrida de 5 km, voltou a treinar depois de parar).

Regras:
1. Só o que o ALUNO disse. Nunca o que o acompanhamento ("coach") disse ou supôs. Cada fato leva "quote", um trecho literal da fala dele.
2. Não guarde o que é do momento ("hoje estou cansado", "vou jantar fora hoje"). Guarde o padrão ("costuma viajar às terças").
3. Uma frase curta, direta, sobre o aluno, sem nome, telefone, e-mail ou documento. Escreva como nota para quem acompanha ("Treina de manhã, antes do trabalho").
4. "importance": 3 só para o que muda decisão de treino, nutrição ou segurança; 2 para o relevante; 1 para detalhe.
5. Se o que ele disse contradiz um fato de "existing", coloque o id em "retire" e, se houver a versão nova, em "add".
6. Não repita fato que já está em "existing". Na dúvida, não guarde: "add" pode ser vazio, e geralmente é.
7. Não interprete nem diagnostique: guarde o que ele disse, não o que você acha.`,
  tier: 'FAST',
  methodology: [],
  state: [],
  input: memoryCurationInputSchema,
  output: memoryCurationSchema,
  validators: memoryCurationValidators,
  maxCorrectionRounds: 2,
});
