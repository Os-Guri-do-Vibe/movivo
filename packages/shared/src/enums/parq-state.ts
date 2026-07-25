/**
 * Estado do gate PAR-Q de uma sessão de anamnese (US-1.3 / Alexandre §2).
 *
 * O gate é uma **TRAVA determinística, não uma flag**: qualquer resposta de risco
 * (Q1..Q9 = "Sim") coloca a sessão em `BLOQUEADO_AGUARDANDO_CLEARANCE` e marca
 * `users.requires_professional_review = true` — nenhum protocolo nasce de sessão
 * bloqueada. `LIBERADO_COM_RESSALVA_RT` só é alcançado por ação humana do RT CREF
 * (fora do escopo de código da Sprint 1; basta o estado ser persistido e consultável).
 *
 * Convenção do monorepo: objeto `as const` + type derivado, nunca `enum` do TS.
 */
export const ParqState = {
  LIBERADO: 'LIBERADO',
  BLOQUEADO_AGUARDANDO_CLEARANCE: 'BLOQUEADO_AGUARDANDO_CLEARANCE',
  LIBERADO_COM_RESSALVA_RT: 'LIBERADO_COM_RESSALVA_RT',
} as const;

export type ParqState = (typeof ParqState)[keyof typeof ParqState];
