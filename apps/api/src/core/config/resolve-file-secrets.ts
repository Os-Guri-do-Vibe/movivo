/**
 * Contrato `*_FILE` — implementação normativa de `SECURITY.md` §2 (Henrique, US-0.6).
 *
 * Para toda chave sensível `K` existe uma irmã opcional `K_FILE`. Este preload roda
 * **antes** da validação Zod (§2.2) e devolve um objeto de env já resolvido, do qual
 * os pares `K_FILE` foram removidos — o schema Zod nunca enxerga o sufixo.
 *
 * Invariantes (§2.1):
 *  - Precedência: `K_FILE` > `K` > ausente (o Zod decide o que fazer com a ausência).
 *  - `K_FILE` definida com arquivo ausente/ilegível/vazio ⇒ **erro fatal**. Nunca há
 *    fallback silencioso para `K`: é assim que uma senha de dev vaza para produção.
 *  - Conteúdo lido como UTF-8, BOM removido, `trimEnd()` — nunca `trim()`, porque um
 *    segredo pode legitimamente começar com espaço.
 *  - O valor **nunca** é reinjetado em `process.env` e **nunca** é logado (§2.8/§2.9).
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

/** Chaves sensíveis da Sprint 0 (SECURITY.md §2.2). Novas sprints acrescentam aqui. */
export const SECRET_KEYS = [
  'DATABASE_PASSWORD',
  'MIGRATION_DATABASE_PASSWORD',
  'REDIS_PASSWORD',
  'REDIS_SENTINEL_PASSWORD',
] as const;

export type SecretKey = (typeof SECRET_KEYS)[number];

export type RawEnv = Record<string, string | undefined>;

/** Aviso emitido quando `K` e `K_FILE` coexistem (§2.1.7). Só o **nome** é citado. */
export interface FileSecretWarning {
  readonly key: string;
  readonly message: string;
}

export interface ResolveFileSecretsResult {
  readonly env: RawEnv;
  readonly warnings: readonly FileSecretWarning[];
}

/**
 * Erro fatal de resolução de segredo. Carrega apenas nome da variável e caminho —
 * jamais o conteúdo do arquivo.
 */
export class FileSecretError extends Error {
  constructor(
    readonly key: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'FileSecretError';
  }
}

/**
 * Resolve os pares `K_FILE` de `env` e devolve um novo objeto pronto para o Zod.
 *
 * @param env objeto de env bruto (nunca é mutado).
 * @param keys conjunto de chaves sensíveis a considerar.
 */
export function resolveFileSecrets(
  env: RawEnv,
  keys: readonly string[] = SECRET_KEYS,
): ResolveFileSecretsResult {
  const out: RawEnv = { ...env };
  const warnings: FileSecretWarning[] = [];

  for (const key of keys) {
    const fileKey = `${key}_FILE`;
    const filePath = env[fileKey]?.trim();

    if (!filePath) {
      // Sem `K_FILE`: cai para a env direta. A ausência total é problema do Zod.
      delete out[fileKey];
      continue;
    }

    const absolutePath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);

    let raw: string;
    try {
      raw = readFileSync(absolutePath, 'utf8');
    } catch (cause) {
      throw new FileSecretError(
        key,
        `${fileKey} aponta para "${absolutePath}", que não pôde ser lido. ` +
          `Gere os segredos locais com "pnpm run infra:secrets". ` +
          `Fallback para ${key} é proibido (SECURITY.md §2.1.4).`,
        { cause },
      );
    }

    const value = raw.replace(/^\uFEFF/, '').trimEnd();
    if (value.length === 0) {
      throw new FileSecretError(
        key,
        `${fileKey} aponta para "${absolutePath}", mas o arquivo está vazio (SECURITY.md §2.1.6).`,
      );
    }

    if (env[key] !== undefined) {
      warnings.push({
        key,
        message: `${key} e ${fileKey} estão definidos; ${fileKey} tem precedência (SECURITY.md §2.1.7).`,
      });
    }

    out[key] = value;
    delete out[fileKey]; // o schema Zod não deve ver o par
  }

  return { env: out, warnings };
}
