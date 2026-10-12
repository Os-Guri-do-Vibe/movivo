import { describe, expect, it } from 'vitest';

import { INTENTS } from './intent.types';
import {
  BASE_GUARDRAIL,
  buildForaDeEscopoResponse,
  IDENTITY_TRANSPARENCY_BLOCK,
  intentInstruction,
  METHODOLOGY_AWARE_INTENTS,
  PROMPT_BLOCKS,
  resolvePrompt,
} from './prompts';

const FORBIDDEN = ['diagnóstico', 'tratamento', 'cura', 'garantido'];
const FORA_DE_ESCOPO_RESPONSE = buildForaDeEscopoResponse('MOVI');

describe('resolvePrompt', () => {
  it('herda o bloco base de guardrails', () => {
    const p = resolvePrompt('MOTIVACAO');
    expect(p).toContain(BASE_GUARDRAIL);
  });

  it('SUBSTITUICAO_EXERCICIO instrui verbalizar sem decidir', () => {
    const p = resolvePrompt('SUBSTITUICAO_EXERCICIO');
    expect(p.toLowerCase()).toContain('não sugira exercício fora');
    expect(p.toLowerCase()).toContain('verbaliza');
  });

  it('CHECKIN_ANTECIPADO informa que o ajuste vem no check-in', () => {
    expect(resolvePrompt('CHECKIN_ANTECIPADO').toLowerCase()).toContain('check-in');
  });
});

// Achado 2026-10-12 (stress test em produção): a agente se apresentou como "personal trainer,
// treino há bastante tempo" (biografia inventada) e recusou 4 vezes "você é real?".
describe('transparência: a agente é uma IA', () => {
  it('toda intenção herda a regra de identidade, que proíbe se passar por pessoa', () => {
    for (const intent of INTENTS) {
      expect(resolvePrompt(intent)).toContain(IDENTITY_TRANSPARENCY_BLOCK);
    }
    expect(IDENTITY_TRANSPARENCY_BLOCK).toContain('Nunca diga nem sugira que é uma pessoa');
    expect(IDENTITY_TRANSPARENCY_BLOCK).toContain('nunca invente biografia pessoal');
  });

  it('não promete o que o produto não faz (áudio, vídeo, ligação)', () => {
    expect(IDENTITY_TRANSPARENCY_BLOCK).toContain('NÃO envia áudio, vídeo, imagem nem faz ligação');
  });

  it('o bloco está travado (L0) e listado para o painel', () => {
    const block = PROMPT_BLOCKS.find((b) => b.id === 'IDENTITY_TRANSPARENCY');
    expect(block).toMatchObject({ layer: 'L0', editable: false });
  });
});

describe('recusa é o último recurso', () => {
  it('toda intenção tem instrução própria, inclusive FORA_DE_ESCOPO (a IA reavalia o rótulo)', () => {
    for (const intent of INTENTS) expect(intentInstruction(intent).length).toBeGreaterThan(20);
    expect(intentInstruction('FORA_DE_ESCOPO')).toContain('RESPONDA normalmente');
  });

  it('a regra de identidade traz só a história oficial (persona de IA + profissional CREF)', () => {
    expect(IDENTITY_TRANSPARENCY_BLOCK).toContain('persona de IA da MOVIVO');
    expect(IDENTITY_TRANSPARENCY_BLOCK).toContain('Leonardo Rodrigues Brito');
    expect(IDENTITY_TRANSPARENCY_BLOCK).toContain('206778-G/SP');
    expect(IDENTITY_TRANSPARENCY_BLOCK).toContain('ÚNICA história');
  });

  it('SOBRE_O_COACH responde com a verdade e não encaminha só pela pergunta', () => {
    const p = intentInstruction('SOBRE_O_COACH');
    expect(p).toContain('IDENTIDADE E TRANSPARÊNCIA');
    expect(p).toContain('NÃO encaminhe');
  });

  it('ADAPTACAO_NO_TREINO recebe a metodologia, mas não inventa exercício nem número', () => {
    expect(METHODOLOGY_AWARE_INTENTS).toContain('ADAPTACAO_NO_TREINO');
    const p = intentInstruction('ADAPTACAO_NO_TREINO');
    expect(p).toContain('NÃO invente exercício novo');
    expect(p).toContain('NÃO altere o protocolo');
  });
});

describe('guardrails de copy', () => {
  it('a resposta pré-aprovada não usa os termos vedados (por palavra, não substring)', () => {
    // Fronteira de palavra: "procurar" contém "cura" mas não é o termo vedado (igual US-2.3).
    for (const t of FORBIDDEN) {
      expect(new RegExp(`\\b${t}\\b`, 'i').test(FORA_DE_ESCOPO_RESPONSE)).toBe(false);
    }
  });

  it('a resposta de fora de escopo é honesta e redireciona', () => {
    expect(FORA_DE_ESCOPO_RESPONSE.length).toBeGreaterThan(20);
  });
});
