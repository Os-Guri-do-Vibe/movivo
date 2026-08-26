/**
 * Guardrail de **neutralidade de gênero** do bloco L2 do system prompt (Sprint 11).
 *
 * Com duas personas publicadas ao mesmo tempo — uma para cada público —, `buildPersonaBlock`
 * renderiza tanto uma agente feminina quanto um agente masculino. Qualquer palavra do
 * template que concorde em gênero com o falante faz o modelo se auto-referenciar no gênero
 * errado por arrasto gramatical. Foi exatamente esse o bug de "Você é a {nome}" e, depois,
 * o dos DESCRITORES DE TOM (`calorosa`, `direta`, `técnica`), que este teste tranca.
 */
import { describe, expect, it } from 'vitest';

import { AgentToneDescriptor } from '../enums/agent-config';
import { DEFAULT_AGENT_PERSONA, type AgentPersona } from '../schemas/agent-config.schema';
import { buildPersonaBlock, TONE_LABEL } from './persona-block';

const MALE_PERSONA: AgentPersona = {
  ...DEFAULT_AGENT_PERSONA,
  agentName: 'Leonardo',
  agentSelfIntro: 'o coach digital da MOVIVO, supervisionado por um profissional CREF',
};

/**
 * Formas femininas dos antigos rótulos adjetivos. Nenhuma pode reaparecer: elas são o
 * mecanismo do bug, não apenas um sintoma dele.
 */
const FEMININE_ADJECTIVES = [
  /\bcalorosa\b/i,
  /\bdireta\b/i,
  /\bbem-humorada\b/i,
  // "técnica" só é proibida como adjetivo do falante; em "precisão técnica" ela concorda
  // com o substantivo "precisão", não com quem fala — que é justamente o ponto da mudança.
  /(?<!precisão )\btécnica\b/i,
  /\bsupervisionada\b/i,
];

describe('TONE_LABEL — rótulos de tom em forma substantiva', () => {
  it('cobre todos os descritores do enum (nenhum tom fica sem rótulo)', () => {
    for (const descriptor of Object.values(AgentToneDescriptor)) {
      expect(TONE_LABEL[descriptor]).toBeTruthy();
    }
    expect(Object.keys(TONE_LABEL)).toHaveLength(Object.values(AgentToneDescriptor).length);
  });

  it('nenhum rótulo é adjetivo flexionado no feminino', () => {
    for (const label of Object.values(TONE_LABEL)) {
      for (const feminine of FEMININE_ADJECTIVES) expect(label).not.toMatch(feminine);
    }
  });

  it('usa a forma substantiva conhecida de cada descritor', () => {
    expect(TONE_LABEL.caloroso).toBe('acolhimento');
    expect(TONE_LABEL.direto).toBe('objetividade');
    expect(TONE_LABEL.tecnico).toBe('precisão técnica');
  });
});

describe('buildPersonaBlock — neutralidade de gênero', () => {
  it('com nome masculino e todos os tons, não emite concordância feminina', () => {
    const block = buildPersonaBlock({
      ...MALE_PERSONA,
      // Os 4 tons máximos permitidos pelo contrato, incluindo os que eram adjetivos.
      toneDescriptors: ['caloroso', 'direto', 'bem-humorado', 'tecnico'],
    });
    expect(block).toContain('Você é Leonardo.');
    for (const feminine of FEMININE_ADJECTIVES) {
      // `agentSelfIntro` é texto livre de quem publica: o teste usa uma intro masculina,
      // então nada no bloco inteiro pode aparecer flexionado no feminino.
      expect(block).not.toMatch(feminine);
    }
  });

  it('anuncia o tom pela forma substantiva ("Seu tom é: …"), não por "Fale de forma …"', () => {
    const block = buildPersonaBlock({ ...MALE_PERSONA, toneDescriptors: ['caloroso', 'direto'] });
    expect(block).toContain('Seu tom é: acolhimento, objetividade.');
    expect(block).not.toContain('Fale de forma');
  });

  it('os traços de comportamento seguem imperativos neutros, sem "seja" antes deles', () => {
    const block = buildPersonaBlock({
      ...MALE_PERSONA,
      personaTraits: ['ACOLHE_ANTES_DE_ORIENTAR', 'FOCA_NO_PROXIMO_PASSO'],
    });
    expect(block).toContain(
      'Durante a conversa, acolha o contexto antes de orientar, termine com um próximo passo claro.',
    );
    expect(block).not.toContain('seja acolha');
  });

  it('a persona feminina continua rendendo um bloco coerente com o mesmo template', () => {
    const block = buildPersonaBlock({
      ...DEFAULT_AGENT_PERSONA,
      agentName: 'Marina',
      agentSelfIntro: 'a coach digital da MOVIVO, supervisionada por um profissional CREF',
      toneDescriptors: ['caloroso', 'motivacional'],
    });
    expect(block).toContain('Você é Marina.');
    expect(block).toContain('Seu tom é: acolhimento, motivação.');
  });
});
