/**
 * Enums de domínio compartilhados entre backend e frontend.
 *
 * Convenção: usar objetos `as const` + type derivado, nunca `enum` do TypeScript.
 * Motivo: `enum` gera runtime code, não é apagável (`isolatedModules`/`erasableSyntaxOnly`)
 * e não serializa bem em contratos de API. O par objeto+type dá o mesmo ergonômico
 * com zero custo e integra direto com `z.enum()`.
 */
export * from './protocol-status';
export * from './subscription-status';
