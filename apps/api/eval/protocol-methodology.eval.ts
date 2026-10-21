/**
 * Harness de AVALIAÇÃO do pipeline de geração de protocolo (não roda no CI).
 *
 * Roda o pipeline REAL (`planProtocol`: gera → valida → juiz contextual → correções → reparo →
 * fallback) com o provedor de produção (DeepSeek V4 Pro, thinking desligado, temperatura 0.4),
 * a metodologia publicada em produção e o catálogo publicado em produção, sobre perfis
 * SINTÉTICOS (`profiles.ts`). Mede o resultado com `metrics.ts` (medições neutras) para
 * comparar variantes do pipeline — "nenhuma melhoria é válida sem avaliação".
 *
 *   EVAL_FIXTURES_DIR=<dir com catalog.json, favorites.json, methodology.md> \
 *   EVAL_VARIANT=baseline EVAL_REPEATS=1 [EVAL_PROFILES=id1,id2] \
 *   pnpm --filter @movivo/api exec vitest run --config vitest.eval.config.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';

import type { AppConfigService } from '../src/core/config';
import type { SemanticMemoryPort } from '../src/modules/ai-coach/context/semantic-memory.port';
import type { LlmRouter } from '../src/modules/ai-coach/llm/llm-router.service';
import type { LLMRequest, LLMResult } from '../src/modules/ai-coach/llm/llm.types';
import type { CatalogExercise } from '../src/modules/protocol/exercise-catalog';
import { ExerciseCatalogProvider } from '../src/modules/protocol/exercise-catalog-provider.service';
import type { MethodologyProvider } from '../src/modules/protocol/methodology-provider.service';
import { planProtocol } from '../src/modules/protocol/protocol-planner';
import { ProtocolGeneratorService } from '../src/modules/protocol/protocol-generator.service';
import { ValidationService } from '../src/modules/protocol/validation/validation.service';
import { measure } from './metrics';
import { PROFILES } from './profiles';

const FIXTURES = process.env.EVAL_FIXTURES_DIR ?? '';
const VARIANT = process.env.EVAL_VARIANT ?? 'baseline';
const REPEATS = Number(process.env.EVAL_REPEATS ?? '1');
const ONLY = (process.env.EVAL_PROFILES ?? '').split(',').filter(Boolean);
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY ?? '4');
const OUT_DIR = process.env.EVAL_OUT_DIR ?? join(FIXTURES, 'out');
const MODEL = process.env.EVAL_MODEL ?? 'deepseek-v4-pro';

interface CatalogRow {
  id: string;
  name: string;
  pattern: CatalogExercise['pattern'];
  muscle_groups: string[];
  equipment: string[];
  locations: CatalogExercise['locations'];
  levels: CatalogExercise['levels'];
  contraindicated_for: CatalogExercise['contraindicatedFor'];
  substitutes: string[];
  measurement: CatalogExercise['measurement'] | null;
}

function loadCatalog(): ExerciseCatalogProvider {
  const rows = JSON.parse(readFileSync(join(FIXTURES, 'catalog.json'), 'utf8')) as CatalogRow[];
  const favorites = new Set(
    JSON.parse(readFileSync(join(FIXTURES, 'favorites.json'), 'utf8')) as string[],
  );
  const list: CatalogExercise[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    pattern: row.pattern,
    muscleGroups: row.muscle_groups,
    equipment: row.equipment,
    locations: row.locations,
    levels: row.levels,
    contraindicatedFor: row.contraindicated_for,
    substitutes: row.substitutes,
    ...(row.measurement ? { measurement: row.measurement } : {}),
    isFavorite: favorites.has(row.id),
  }));
  const provider = new ExerciseCatalogProvider();
  Object.assign(provider, { snapshot: list, byId: new Map(list.map((e) => [e.id, e])) });
  return provider;
}

/** Mesmo corpo que `DeepSeekProvider` envia em produção. */
function deepseekRouter(
  apiKey: string,
  usage: { calls: number; out: number; cached: number; miss: number },
) {
  return {
    complete: async (req: LLMRequest): Promise<LLMResult> => {
      const started = Date.now();
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          thinking: { type: 'disabled' },
          ...(req.json ? { response_format: { type: 'json_object' } } : {}),
          messages: [{ role: 'system', content: req.system }, ...req.messages],
        }),
      });
      if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: {
          completion_tokens?: number;
          prompt_cache_hit_tokens?: number;
          prompt_cache_miss_tokens?: number;
        };
      };
      usage.calls++;
      usage.out += data.usage?.completion_tokens ?? 0;
      usage.cached += data.usage?.prompt_cache_hit_tokens ?? 0;
      usage.miss += data.usage?.prompt_cache_miss_tokens ?? 0;
      return {
        text: data.choices?.[0]?.message?.content ?? '',
        provider: 'DEEPSEEK_V4_PRO',
        model: MODEL,
        tokensInput: data.usage?.prompt_cache_miss_tokens ?? 0,
        tokensOutput: data.usage?.completion_tokens ?? 0,
        tokensCached: data.usage?.prompt_cache_hit_tokens ?? 0,
        latencyMs: Date.now() - started,
        attempt: 1,
        dataClass: 'HEALTH',
        costBrl: 0,
      } as LLMResult;
    },
  } as unknown as LlmRouter;
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: size }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
    }),
  );
}

describe.skipIf(!FIXTURES)('avaliação do pipeline de protocolo', () => {
  it(
    `variante ${VARIANT}`,
    async () => {
      const apiKey = readFileSync(
        process.env.EVAL_DEEPSEEK_KEY_FILE ?? '../../secrets/desenvolvimento/deepseek_api_key',
        'utf8',
      ).trim();
      const methodologyContent = readFileSync(join(FIXTURES, 'methodology.md'), 'utf8').trim();
      const catalog = loadCatalog();
      const validation = new ValidationService(catalog);
      const usage = { calls: 0, out: 0, cached: 0, miss: 0 };
      const logger = { setContext: () => undefined, warn: () => undefined, info: () => undefined };
      const methodology = {
        current: async () => ({
          id: '11111111-1111-4111-8111-111111111111',
          version: 3,
          versionLabel: 'methodology-v3',
          content: methodologyContent,
          contentSha256: 'e'.repeat(64),
        }),
      } as unknown as MethodologyProvider;
      const semantic = { retrieve: async () => [] } as unknown as SemanticMemoryPort;
      const config = { llm: { protocolMaxTokens: 6000 } } as unknown as AppConfigService;
      const service = new ProtocolGeneratorService(
        deepseekRouter(apiKey, usage),
        logger as never,
        methodology,
        config,
        catalog,
        semantic,
      );

      const profiles = PROFILES.filter((p) => ONLY.length === 0 || ONLY.includes(p.id));
      const jobs = profiles.flatMap((p) => Array.from({ length: REPEATS }, (_, i) => ({ p, i })));
      const results: unknown[] = [];
      const byId = new Map(catalog.getAll().map((e) => [e.id, e]));

      await pool(jobs, CONCURRENCY, async ({ p, i }) => {
        const started = Date.now();
        try {
          const plan = await planProtocol(service, validation, {
            userId: `eval-${p.id}-${i}`,
            user: { name: 'Aluno Sintético' },
            constraints: p.constraints,
          });
          results.push({
            profile: p.id,
            run: i,
            ms: Date.now() - started,
            fallback: plan.usedFallbackTemplate,
            attempts: plan.attempts.map(
              (a) => `${a.kind[0]}:${a.outcome}${a.rules.length ? `[${a.rules.join(',')}]` : ''}`,
            ),
            quality: plan.contextualQuality?.status ?? null,
            qualityReason: plan.contextualQuality?.unavailableReason ?? null,
            qualityGaps:
              plan.contextualQuality?.checks
                .filter((c) => c.status === 'GAP')
                .map((c) => c.criterion) ?? [],
            finalRules: plan.trace.finalRules,
            metrics: measure(plan.content, byId, {
              emphasis: p.constraints.emphasis,
              sessionMinutes: p.constraints.sessionMinutes,
            }),
            content: plan.content,
          });
        } catch (error) {
          results.push({ profile: p.id, run: i, error: String(error).slice(0, 300) });
        }
        process.stdout.write(`· ${p.id}#${i} ok\n`);
      });

      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(
        join(OUT_DIR, `${VARIANT}.json`),
        JSON.stringify({ variant: VARIANT, model: MODEL, usage, results }, null, 1),
      );
    },
    60 * 60_000,
  );
});
