/** Avaliação determinística dos guardrails L1 publicados. A única ação possível é FLAG. */
import { Inject, Injectable } from '@nestjs/common';
import { desc } from 'drizzle-orm';

import { DRIZZLE } from '../database/database.constants';
import type { DrizzleClient } from '../database/database.module';
import { aiGuardrailRules } from '../database/schema';
import { matchesTerm, normalizeForMatch } from './text-normalize';

export interface L1GuardrailFlag {
  ruleKey: string;
  label: string;
  version: number;
}

interface ActiveRule extends L1GuardrailFlag {
  scope: 'INPUT' | 'OUTPUT' | 'BOTH';
  phrases: string[];
}

@Injectable()
export class L1GuardrailService {
  private cached: { rules: ActiveRule[]; expiresAt: number } | null = null;

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleClient) {}

  invalidate(): void {
    this.cached = null;
  }

  async evaluate(input: string, output: string): Promise<L1GuardrailFlag[]> {
    const rules = await this.activeRules();
    // Normalização compartilhada com o comparador de temas proibidos (`text-normalize.ts`):
    // NFKC + remoção de invisíveis + limite de palavra. Mais estreita que a versão anterior
    // (substring crua), que casava "dor" dentro de "dormi" — falso positivo que a fila de
    // revisão do CREF pagava em ruído.
    const normalizedInput = normalizeForMatch(input);
    const normalizedOutput = normalizeForMatch(output);
    return rules.flatMap((rule) => {
      const sources =
        rule.scope === 'INPUT'
          ? [normalizedInput]
          : rule.scope === 'OUTPUT'
            ? [normalizedOutput]
            : [normalizedInput, normalizedOutput];
      return rule.phrases.some((phrase) => sources.some((source) => matchesTerm(source, phrase)))
        ? [{ ruleKey: rule.ruleKey, label: rule.label, version: rule.version }]
        : [];
    });
  }

  async activeRules(): Promise<ActiveRule[]> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.rules;
    const rows = await this.db
      .select({
        ruleKey: aiGuardrailRules.ruleKey,
        label: aiGuardrailRules.label,
        scope: aiGuardrailRules.scope,
        phrases: aiGuardrailRules.phrases,
        version: aiGuardrailRules.version,
        status: aiGuardrailRules.status,
      })
      .from(aiGuardrailRules)
      .orderBy(desc(aiGuardrailRules.version), desc(aiGuardrailRules.createdAt));

    const current = new Set<string>();
    const rules: ActiveRule[] = [];
    for (const row of rows) {
      if (current.has(row.ruleKey)) continue;
      current.add(row.ruleKey);
      if (row.status === 'PUBLISHED') rules.push(row);
    }
    this.cached = { rules, expiresAt: Date.now() + 60_000 };
    return rules;
  }
}
