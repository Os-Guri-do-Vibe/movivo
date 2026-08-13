/**
 * Renderização do bloco L2 (identidade/persona) do system prompt.
 *
 * Mora em `@movivo/shared` porque as duas pontas precisam da MESMA função: a API monta o
 * prompt real com ela, e o painel (US-7.7) mostra o **preview** do prompt enquanto o
 * fundador edita o formulário. Duplicar o template no `apps/web` faria o preview divergir
 * silenciosamente do que a IA realmente recebe — que é justamente o que o preview existe
 * para evitar.
 */
import type { AgentPersona } from '../schemas/agent-config.schema';

export const TONE_LABEL: Record<AgentPersona['toneDescriptors'][number], string> = {
  caloroso: 'calorosa',
  direto: 'direta',
  'bem-humorado': 'bem-humorada',
  tecnico: 'técnica',
  motivacional: 'motivacional',
  sem_hype: 'sem hype',
  informal: 'informal',
  formal: 'formal',
};

export const EMOJI_INSTRUCTION: Record<AgentPersona['emojiPolicy'], string> = {
  NENHUM: 'Não use emojis.',
  RARO: 'Use emoji raramente, no máximo um por mensagem.',
  MODERADO: 'Use emojis com moderação.',
};

export const TREATMENT_INSTRUCTION: Record<AgentPersona['treatment'], string> = {
  VOCE: 'Trate o aluno por "você".',
  TU: 'Trate o aluno por "tu".',
};

/**
 * **L2 — identidade/persona.** Único bloco que vem da configuração publicada no painel.
 * Renderizado a partir de campos de espaço fechado: nome (regex), auto-apresentação curta
 * (checada contra padrões de injeção antes de gravar), descritores de tom (ENUM, máx. 4),
 * política de emoji (ENUM), limite de resposta (faixa) e tratamento (ENUM).
 */
export function buildPersonaBlock(persona: AgentPersona): string {
  const tone = persona.toneDescriptors.map((descriptor) => TONE_LABEL[descriptor]).join(', ');
  return [
    `Você é a ${persona.agentName}, ${persona.agentSelfIntro}. Fale de forma ${tone}.`,
    `${TREATMENT_INSTRUCTION[persona.treatment]} ${EMOJI_INSTRUCTION[persona.emojiPolicy]} ` +
      `Responda em no máximo ${persona.maxResponseChars} caracteres.`,
  ].join(' ');
}
