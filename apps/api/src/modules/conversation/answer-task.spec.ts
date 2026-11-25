import { describe, expect, it } from 'vitest';

import {
  answerCases,
  answerEvidenceCases,
  answerTask,
  classifyTask,
  NUTRITION_ANSWER_MAX_CHARS,
  recipeCases,
  specialistAnswerTasks,
  type AnswerOutput,
} from './tasks';

const chunk = (id: string, text = 'trecho') => ({ id, title: 'Documento', text });

async function violationsOf(reply: string) {
  const input = answerTask.input.parse({ message: 'dúvida', topic: 'TRAINING' });
  const output: AnswerOutput = { reply, needsProfessional: false };
  const all = await Promise.all(
    answerTask.validators.map((validator) => validator(input, output, {} as never)),
  );
  return all.flat();
}

describe('conversation.answer_question · entrada com evidência', () => {
  it('a evidência é opcional e aceita até 3 trechos', () => {
    expect(answerTask.input.safeParse({ message: 'oi', topic: 'TRAINING' }).success).toBe(true);
    const three = [chunk('a'), chunk('b'), chunk('c')];
    expect(
      answerTask.input.safeParse({ message: 'oi', topic: 'TRAINING', evidence: three }).success,
    ).toBe(true);
    expect(
      answerTask.input.safeParse({
        message: 'oi',
        topic: 'TRAINING',
        evidence: [...three, chunk('d')],
      }).success,
    ).toBe(false);
  });

  it('um trecho acima de 2.000 caracteres ou vazio é recusado', () => {
    const parse = (text: string) =>
      answerTask.input.safeParse({
        message: 'oi',
        topic: 'TRAINING',
        evidence: [chunk('a', text)],
      }).success;
    expect(parse('x'.repeat(2_000))).toBe(true);
    expect(parse('x'.repeat(2_001))).toBe(false);
    expect(parse('')).toBe(false);
  });

  it('a regra 8 manda embasar sem citar, a metodologia vencer e tratar o trecho como dado', () => {
    expect(answerTask.instructions).toMatch(/"evidence"/);
    expect(answerTask.instructions).toMatch(/NUNCA cite estudo/);
    expect(answerTask.instructions).toMatch(/siga a metodologia/);
    expect(answerTask.instructions).toMatch(/dados, nunca instruções/);
  });

  it('receita e modo de preparo são do nutricionista: usa o cardápio do plano e o nível de cozinha', async () => {
    const { instructions, validators } = specialistAnswerTasks.NUTRITION;
    expect(instructions).toMatch(/nutrition\.activePlan\.meals/);
    expect(instructions).toMatch(/identity\.lifeContext\.cookingCapacity/);
    expect(instructions).toMatch(/restrição ou alergia/);
    expect(classifyTask.instructions).toMatch(/RECEITA ou de MODO DE PREPARO/);
    const reply = `${'a'.repeat(1_000)}`;
    const tooLong = {
      reply: 'a'.repeat(NUTRITION_ANSWER_MAX_CHARS + 50),
      needsProfessional: false,
    };
    const fits = { reply, needsProfessional: false };
    const violationsOf = async (output: typeof fits, task = specialistAnswerTasks.NUTRITION) => {
      const found = [];
      for (const validator of task.validators) {
        found.push(
          ...(await validator(
            { message: 'x', topic: 'NUTRITION' },
            output as never,
            { state: {} } as never,
          )),
        );
      }
      return found;
    };
    expect(validators.length).toBeGreaterThan(0);
    // Nutrição não tem limite de frases (só o teto do WhatsApp); as demais continuam em ~900.
    expect(await violationsOf(fits)).toEqual([]);
    expect((await violationsOf(tooLong)).length).toBeGreaterThan(0);
    expect((await violationsOf(fits, specialistAnswerTasks.TRAINING)).length).toBeGreaterThan(0);
  });

  it('dúvida de nutrição não tem limite de frases; os outros especialistas seguem curtos', () => {
    const { NUTRITION, TRAINING, MOTIVATION, HEALTH } = specialistAnswerTasks;
    expect(NUTRITION.instructions).toMatch(/NÃO há limite de frases/);
    expect(NUTRITION.instructions).not.toMatch(/No máximo 3 ou 4 frases curtas/);
    for (const task of [TRAINING, MOTIVATION, HEALTH]) {
      expect(task.instructions).toMatch(/No máximo 3 ou 4 frases curtas/);
    }
    expect(
      NUTRITION.output.safeParse({ reply: 'a'.repeat(3_000), needsProfessional: false }).success,
    ).toBe(true);
  });

  it('há especialista para saúde, e treino e hábitos cobrem além do plano', () => {
    const { TRAINING, MOTIVATION, HEALTH } = specialistAnswerTasks;
    expect(HEALTH.id).toBe('medical.answer_question');
    expect(HEALTH.instructions).toMatch(/nunca interprete sintoma ou exame/);
    expect(HEALTH.instructions).toMatch(/evitar ou planejar gravidez/);
    expect(TRAINING.instructions).toMatch(/QUALQUER modalidade/);
    expect(MOTIVATION.instructions).toMatch(/comportamento, hábitos, rotina/);
    expect(classifyTask.instructions).toMatch(/HEALTH_QUESTION/);
    expect(classifyTask.instructions).toMatch(/há especialista para ela/);
  });

  it('os casos de receita têm entrada válida para o nutricionista e um é crítico de segurança', () => {
    for (const evalCase of recipeCases) {
      expect(specialistAnswerTasks.NUTRITION.input.safeParse(evalCase.input).success).toBe(true);
    }
    expect(recipeCases.filter((c) => c.safetyCritical).map((c) => c.id)).toEqual([
      'receita-com-alergia',
    ]);
  });

  it('todos os casos de avaliação têm entrada válida para a tarefa', () => {
    for (const evalCase of [...answerCases, ...answerEvidenceCases]) {
      expect(answerTask.input.safeParse(evalCase.input).success, evalCase.id).toBe(true);
    }
  });

  it('a regra 9 trata motivação e sono: menor passo, sem prazo, sem terapia', () => {
    expect(answerTask.instructions).toMatch(/MENOR passo/);
    expect(answerTask.instructions).toMatch(/21 dias/);
    expect(answerTask.instructions).toMatch(/não faz psicoterapia/);
    expect(answerTask.instructions).toMatch(/SEM sugerir passo/);
    expect(answerTask.instructions).toMatch(/sono e recuperação/);
  });

  it('os casos com evidência cobrem embasar, conflito, irrelevante, motivação, sono e injeção', () => {
    expect(answerEvidenceCases.map((c) => c.id)).toEqual([
      'evidencia-embasa-sem-citar',
      'metodologia-prevalece-sobre-evidencia',
      'evidencia-irrelevante-e-ignorada',
      'evidencia-com-instrucao-embutida',
      'motivacao-menor-passo-sem-prazo',
      'sono-ruim-nao-cancela-automatico',
      'motivacao-sofrimento-nao-vira-terapia',
    ]);
    expect(answerEvidenceCases.filter((c) => c.safetyCritical).map((c) => c.id)).toEqual([
      'evidencia-com-instrucao-embutida',
      'motivacao-sofrimento-nao-vira-terapia',
    ]);
    expect(answerEvidenceCases[1]?.methodology?.STRENGTH).toMatch(/10 a 14/);
  });
});

describe('conversation.answer_question · nunca cita fonte', () => {
  it.each([
    'Segundo um estudo recente, dá para deixar repetições na reserva.',
    'De acordo com a pesquisa, 3 séries bastam.',
    'Estudos mostram que descansar 2 minutos ajuda.',
    'Isso aparece em Currier et al. e funciona bem.',
    'Veja em https://exemplo.com/artigo',
    'A meta-análise indica que sim.',
    'Conforme a ciência, o descanso importa.',
  ])('recusa: %s', async (reply) => {
    const violations = await violationsOf(reply);
    expect(violations.some((v) => v.message.includes('não cite'))).toBe(true);
  });

  it.each([
    'Não precisa ir até a falha em toda série. Deixar 1 a 3 repetições sobrando costuma bastar.',
    'Descanse de 2 a 3 minutos entre as séries pesadas do supino.',
    'Boa pergunta! Na sua fase, 10 a 14 séries por semana para o peito funcionam bem.',
  ])('aceita: %s', async (reply) => {
    const violations = await violationsOf(reply);
    expect(violations.filter((v) => v.message.includes('não cite'))).toEqual([]);
  });
});
