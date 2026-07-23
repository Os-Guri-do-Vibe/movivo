/**
 * Montagem do objeto de ambiente bruto que alimenta o Zod.
 *
 * Ordem de composição (menor → maior precedência):
 *   1. `apps/api/.env` (perfil local do dev, nunca versionado)
 *   2. `process.env` (o que o shell/Docker realmente injetou)
 *   3. resolução dos pares `K_FILE` (docs/SECURITY.md §2 — vence tudo)
 *
 * Detalhe deliberado: usamos `dotenv.parse` sobre o arquivo lido, e **não**
 * `dotenv.config()`. `config()` escreve em `process.env`; queremos o oposto —
 * manter a configuração (em especial os segredos) fora do ambiente do processo,
 * longe de processos filhos, dumps de crash e libs que serializam o `env`
 * (docs/SECURITY.md §2.1.8).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse as parseDotenv } from 'dotenv';

import { type RawEnv, resolveFileSecrets, type FileSecretWarning } from './resolve-file-secrets';

export interface LoadedEnv {
  readonly env: RawEnv;
  readonly warnings: readonly FileSecretWarning[];
  /** Arquivos `.env` efetivamente lidos — útil para diagnóstico no boot. */
  readonly loadedFiles: readonly string[];
}

/** Arquivos candidatos, do menos para o mais específico. */
function candidateEnvFiles(nodeEnv: string | undefined): string[] {
  const files = ['.env'];
  if (nodeEnv) files.push(`.env.${nodeEnv}`);
  files.push('.env.local');
  return files;
}

/**
 * @param cwd diretório base para os `.env` e para caminhos relativos de `K_FILE`.
 *            Em runtime é sempre `process.cwd()` (= `apps/api` via script do workspace).
 */
export function loadEnv(processEnv: RawEnv = process.env, cwd: string = process.cwd()): LoadedEnv {
  const fromFiles: RawEnv = {};
  const loadedFiles: string[] = [];

  for (const file of candidateEnvFiles(processEnv.NODE_ENV)) {
    const path = resolve(cwd, file);
    if (!existsSync(path)) continue;
    Object.assign(fromFiles, parseDotenv(readFileSync(path, 'utf8')));
    loadedFiles.push(path);
  }

  // `process.env` sempre vence o arquivo: o Compose/CI é a fonte de verdade.
  const merged: RawEnv = { ...fromFiles, ...processEnv };
  const { env, warnings } = resolveFileSecrets(merged);

  return { env, warnings, loadedFiles };
}
