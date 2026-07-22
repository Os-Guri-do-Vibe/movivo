/** Token de DI do client Drizzle. Único ponto de acesso ao Postgres na aplicação. */
export const DRIZZLE = Symbol('MOVIVO_DRIZZLE');

/** Token de DI do driver `postgres.js` cru — usado só por probes e pelo shutdown. */
export const POSTGRES_CLIENT = Symbol('MOVIVO_POSTGRES_CLIENT');
