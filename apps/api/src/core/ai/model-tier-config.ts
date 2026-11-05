import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';

import { AppConfigService } from '../config';
import { modelTiers } from '../database/schema';
import { TenantDatabase } from '../database/tenant-database.service';
import type { ModelTier, TierRoute } from './ai.types';

/** Rotas lidas do banco ficam em memória por este tempo (troca no painel vale em até 30 s). */
const CACHE_TTL_MS = 30_000;

/**
 * Rotas padrão de cada tier quando `model_tiers` não tem linha habilitada para ele. Usa só os
 * modelos que já passaram pela diligência do ADR-005-R2 (os mesmos do `LLM_*_MODEL`); o modelo
 * definitivo de cada tier é escolhido pelos casos de avaliação e gravado no banco.
 */
export function defaultTierRoutes(config: AppConfigService): Record<ModelTier, TierRoute[]> {
  const { primaryModel, fallbackModel, secondaryFallbackModel } = config.llm;
  const route = (
    vendor: TierRoute['vendor'],
    model: string,
    maxOutputTokens: number,
    timeoutMs: number,
    temperature: number,
    vision = false,
  ): TierRoute => ({ vendor, model, maxOutputTokens, timeoutMs, temperature, vision });
  return {
    FAST: [
      route('DEEPSEEK', 'deepseek-v4-flash', 1_500, 15_000, 0.1),
      route('OPENAI', 'gpt-4.1-mini', 1_500, 15_000, 0.1),
    ],
    STANDARD: [
      route('DEEPSEEK', primaryModel, 4_000, 45_000, 0.4),
      route('OPENAI', fallbackModel, 4_000, 45_000, 0.4),
      route('ANTHROPIC', secondaryFallbackModel, 4_000, 45_000, 0.4),
    ],
    REASONING: [
      route('ANTHROPIC', secondaryFallbackModel, 12_000, 180_000, 0.3),
      route('OPENAI', fallbackModel, 12_000, 180_000, 0.3),
      route('DEEPSEEK', primaryModel, 12_000, 180_000, 0.3),
    ],
    VISION: [
      route('OPENAI', fallbackModel, 2_000, 60_000, 0.1, true),
      route('ANTHROPIC', secondaryFallbackModel, 2_000, 60_000, 0.1, true),
    ],
  };
}

/** Resolve as rotas de um tier: banco (configurado no painel) ou padrão do código. */
@Injectable()
export class ModelTierConfig {
  private cache: { at: number; routes: Partial<Record<ModelTier, TierRoute[]>> } | null = null;

  constructor(
    private readonly db: TenantDatabase,
    private readonly config: AppConfigService,
  ) {}

  async routesFor(tier: ModelTier): Promise<TierRoute[]> {
    const fromDb = (await this.load())[tier];
    return fromDb && fromDb.length > 0 ? fromDb : defaultTierRoutes(this.config)[tier];
  }

  /** Descarta o cache (chamado ao salvar uma rota no painel). */
  invalidate(): void {
    this.cache = null;
  }

  private async load(): Promise<Partial<Record<ModelTier, TierRoute[]>>> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.routes;
    const rows = await this.db.runAsSystem((tx) =>
      tx
        .select()
        .from(modelTiers)
        .where(eq(modelTiers.enabled, true))
        .orderBy(asc(modelTiers.tier), asc(modelTiers.position)),
    );
    const routes: Partial<Record<ModelTier, TierRoute[]>> = {};
    for (const row of rows) {
      const tier = row.tier as ModelTier;
      (routes[tier] ??= []).push({
        vendor: row.vendor as TierRoute['vendor'],
        model: row.model,
        maxOutputTokens: row.maxOutputTokens,
        timeoutMs: row.timeoutMs,
        temperature: row.temperature,
        vision: row.vision,
      });
    }
    this.cache = { at: Date.now(), routes };
    return routes;
  }
}
