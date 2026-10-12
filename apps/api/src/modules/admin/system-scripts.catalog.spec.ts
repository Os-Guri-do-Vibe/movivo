import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ALL_SCRIPTS, CRON_SCRIPTS, TERMINAL_SCRIPTS } from './system-scripts.catalog';

const API_ROOT = resolve(__dirname, '../../..');
const REPO_ROOT = resolve(API_ROOT, '../..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const rel = (path: string) => relative(REPO_ROOT, path).split('\\').join('/');

describe('catálogo "Sistema → Scripts" não deriva do código', () => {
  it('cobre todo upsertJobScheduler registrado em módulos', () => {
    const registered = walk(join(API_ROOT, 'src/modules'))
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        return [...source.matchAll(/upsertJobScheduler\(\s*'([^']+)'/g)].map((m) => m[1]);
      })
      .sort();

    expect(CRON_SCRIPTS.map((cron) => cron.schedulerId).sort()).toEqual(registered);
  });

  it('cobre todo script de terminal do repositório', () => {
    const onDisk = [
      ...walk(join(API_ROOT, 'src/scripts')).filter((file) => /\.(ts|mjs)$/.test(file)),
      ...walk(join(API_ROOT, 'scripts')),
      ...walk(join(REPO_ROOT, 'scripts')),
    ]
      .map(rel)
      .filter((file) => !/\.(spec|test)\.[a-z]+$/.test(file))
      .sort();

    const cataloged = TERMINAL_SCRIPTS.map((script) => script.file).filter(
      (file) =>
        file.startsWith('apps/api/src/scripts/') ||
        file.startsWith('apps/api/scripts/') ||
        file.startsWith('scripts/'),
    );
    expect(cataloged.sort()).toEqual(onDisk);
  });

  it('todo script de terminal aponta para um arquivo que existe', () => {
    for (const script of TERMINAL_SCRIPTS) {
      expect(existsSync(join(REPO_ROOT, script.file)), script.file).toBe(true);
    }
  });

  it('ids são únicos e seguros para a rota', () => {
    const ids = ALL_SCRIPTS.map((script) => script.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]{1,80}$/);
  });

  it('respeita os guardrails de linguagem (sem diagnóstico/tratamento/cura)', () => {
    for (const script of ALL_SCRIPTS) {
      const text = `${script.name} ${script.description}`;
      expect(text, script.id).not.toMatch(/diagn[óo]stic|tratamento|\bcura\b/i);
    }
  });
});
