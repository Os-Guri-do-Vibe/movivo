import { describe, expect, it } from 'vitest';

import { simulateFaqConfig, simulateL1GuardrailConfig } from '../../modules/admin/config-gate';
import { matchesTerm, normalizeForMatch } from '../attendance-rules/text-normalize';
import { normalizeFaqQuestion } from '../attendance-rules/faq.service';
import {
  DEFAULT_FAQS,
  DEFAULT_GUARDRAILS,
  seedDefaultAiConfig,
  type DefaultGuardrail,
} from './default-ai-config';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('FAQ padrão', () => {
  it('toda resposta passa pelo mesmo simulador que o painel exige antes de publicar', () => {
    for (const entry of DEFAULT_FAQS) {
      const simulation = simulateFaqConfig({
        canonicalQuestion: entry.question,
        answer: entry.answer,
      });
      expect(
        simulation.checks.filter((check) => !check.passed),
        entry.question,
      ).toEqual([]);
      expect(simulation.passed, entry.question).toBe(true);
    }
  });

  it('chaves e perguntas únicas (a pergunta normalizada é o que o aluno digita)', () => {
    expect(new Set(DEFAULT_FAQS.map((e) => e.faqKey)).size).toBe(DEFAULT_FAQS.length);
    expect(new Set(DEFAULT_FAQS.map((e) => normalizeFaqQuestion(e.question))).size).toBe(
      DEFAULT_FAQS.length,
    );
    for (const entry of DEFAULT_FAQS) expect(entry.faqKey, entry.question).toMatch(UUID);
  });

  it('a pergunta normalizada ignora acento, caixa e pontuação final', () => {
    const entry = DEFAULT_FAQS.find((e) => e.question === 'Você é uma pessoa ou uma IA?');

    expect(normalizeFaqQuestion('VOCE E UMA PESSOA OU UMA IA??')).toBe(
      normalizeFaqQuestion(entry?.question ?? ''),
    );
  });

  it('não promete nada que o produto não faz e não usa linguagem de saúde proibida', () => {
    for (const entry of DEFAULT_FAQS) {
      expect(entry.answer, entry.question).not.toMatch(/https?:|www\.|@/i);
      expect(entry.answer.length, entry.question).toBeLessThanOrEqual(1200);
    }
  });
});

describe('guardrails L1 padrão', () => {
  it('toda regra passa pelo simulador do painel (e não atinge as conversas legítimas dele)', () => {
    for (const rule of DEFAULT_GUARDRAILS) {
      const simulation = simulateL1GuardrailConfig({ ...rule, action: 'FLAG' });
      expect(
        simulation.checks.filter((check) => !check.passed),
        rule.label,
      ).toEqual([]);
    }
  });

  it('chaves únicas, uuid válido, e frases sem repetir entre regras', () => {
    expect(new Set(DEFAULT_GUARDRAILS.map((r) => r.ruleKey)).size).toBe(DEFAULT_GUARDRAILS.length);
    for (const rule of DEFAULT_GUARDRAILS) expect(rule.ruleKey, rule.label).toMatch(UUID);
    const all = DEFAULT_GUARDRAILS.flatMap((r) => r.phrases.map((p) => p.toLocaleLowerCase()));
    expect(new Set(all).size).toBe(all.length);
  });

  const flagged = (rule: DefaultGuardrail, message: string): boolean =>
    rule.phrases.some((phrase) => matchesTerm(normalizeForMatch(message), phrase));
  const rule = (label: string): DefaultGuardrail => {
    const found = DEFAULT_GUARDRAILS.find((r) => r.label === label);
    if (!found) throw new Error(`regra ${label} não existe`);
    return found;
  };

  it.each([
    ['Anabolizantes e hormônios', 'posso usar anabolizante pra ganhar massa?'],
    ['Anabolizantes e hormônios', 'queria fazer ciclo de testosterona'],
    ['Remédios e canetas para emagrecer', 'vou começar o Ozempic semana que vem'],
    ['Remédios e canetas para emagrecer', 'qual remédio pra emagrecer é melhor?'],
    ['Menor de idade', 'eu sou menor de idade, posso treinar?'],
    ['Dieta ou desidratação extrema', 'vou fazer um jejum de 48 horas pra secar'],
    ['Dieta ou desidratação extrema', 'tô tomando diurético antes da pesagem'],
    ['Reclamação formal ou jurídica', 'vou chamar o Procon se não resolverem'],
    ['Reclamação formal ou jurídica', 'se não resolver, vou processar a MOVIVO'],
    ['Pedido sobre dados pessoais (LGPD)', 'quero apagar meus dados, com base na LGPD'],
  ])('sinaliza: %s ← "%s"', (label, message) => {
    expect(flagged(rule(label), message)).toBe(true);
  });

  it.each([
    'Tomei creatina e cafeína antes do treino',
    'Como faço para emagrecer treinando 4 vezes por semana?',
    'Posso fazer jejum intermitente de 16 horas?',
    'Dormi mal e amanheci com dor muscular',
    'Quantos gramas de proteína eu preciso por dia?',
    'Hoje fiz treino de peito e corrida leve',
    'Minha mãe também treina com a MOVIVO',
    'Tô sem tempo e vou processar o arroz e o frango da semana de uma vez',
    'Preciso de dados do meu treino para mandar ao personal',
  ])('não sinaliza conversa comum: "%s"', (message) => {
    expect(DEFAULT_GUARDRAILS.filter((r) => flagged(r, message)).map((r) => r.label)).toEqual([]);
  });
});

describe('seedDefaultAiConfig', () => {
  /** `sql` falso: cada INSERT ... WHERE NOT EXISTS "grava" só enquanto `fresh` permitir. */
  function fakeSql(fresh: (statement: string) => boolean) {
    const calls: { statement: string; values: unknown[] }[] = [];
    const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const statement = strings.join('?');
      calls.push({ statement, values });
      return Promise.resolve(fresh(statement) ? [{ id: 'x' }] : []);
    };
    return { sql: sql as never, calls };
  }

  it('insere cada item uma vez, sem autor, e conta o que entrou', async () => {
    const { sql, calls } = fakeSql(() => true);

    const result = await seedDefaultAiConfig(sql);

    expect(result).toEqual({ faq: DEFAULT_FAQS.length, guardrails: DEFAULT_GUARDRAILS.length });
    expect(calls).toHaveLength(DEFAULT_FAQS.length + DEFAULT_GUARDRAILS.length);
    for (const call of calls) {
      expect(call.statement).toContain('NULL');
      expect(call.statement).toContain('WHERE NOT EXISTS');
    }
  });

  it('o que a equipe já tem (qualquer versão da chave, ou a mesma pergunta) não entra de novo', async () => {
    const { sql } = fakeSql(() => false);

    expect(await seedDefaultAiConfig(sql)).toEqual({ faq: 0, guardrails: 0 });
  });

  it('a pergunta vai normalizada igual à do painel, e as frases entram como json em texto', async () => {
    const { sql, calls } = fakeSql(() => true);
    await seedDefaultAiConfig(sql);

    const first = DEFAULT_FAQS[0];
    expect(calls[0]?.values).toContain(normalizeFaqQuestion(first?.question ?? ''));
    const guardrailCall = calls[DEFAULT_FAQS.length];
    const firstRule = DEFAULT_GUARDRAILS[0];
    // O Postgres não infere o tipo dentro de INSERT ... SELECT: o texto vai com cast explícito.
    expect(guardrailCall?.values).toContain(JSON.stringify(firstRule?.phrases));
    expect(guardrailCall?.statement).toContain('::jsonb');
  });

  it('é determinístico: duas execuções usam as mesmas chaves', async () => {
    const first = fakeSql(() => true);
    const second = fakeSql(() => true);
    await seedDefaultAiConfig(first.sql);
    await seedDefaultAiConfig(second.sql);

    expect(JSON.stringify(first.calls)).toBe(JSON.stringify(second.calls));
  });
});
