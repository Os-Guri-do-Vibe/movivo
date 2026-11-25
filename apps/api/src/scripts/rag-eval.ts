/**
 * Avaliação OFFLINE da busca nos artigos (RAG): roda o conjunto de perguntas contra o corpus real
 * e mede recall e abstenção em vários pisos de similaridade. Serve para calibrar `RAG_MIN_COSINE`
 * e decidir se vale ligar `RAG_ENABLED`. Não chama nenhum modelo de linguagem (só o embedding).
 *
 * Compilado (`dist/`), como o `import-taco`: o Nest precisa dos metadados de decorators, que o `tsx` não gera.
 * Na VPS: `docker compose exec api node --enable-source-maps dist/scripts/rag-eval.js --sweep 0.2,0.3,0.4,0.5`
 *
 *   pnpm --filter @movivo/api rag:eval                              # no piso configurado
 *   pnpm --filter @movivo/api rag:eval -- --sweep 0.2,0.3,0.4,0.5   # varre pisos
 *   pnpm --filter @movivo/api rag:eval -- --min-recall 0.8 --min-abstention 0.8   # falha (exit 1) abaixo disso
 *   pnpm --filter @movivo/api rag:eval -- --set caminho/outro-conjunto.json
 *   pnpm --filter @movivo/api rag:eval -- --diagnose   # onde estava o trecho certo das que erraram
 *
 * Só vale com o embedding REAL (OPENAI_API_KEY + KNOWLEDGE_OPENAI_EMBEDDING_HEALTH_DATA_APPROVED):
 * o embedding de desenvolvimento é um saco de palavras, e os números dele não servem para calibrar.
 */
import 'reflect-metadata';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { AppConfigService } from '../core/config';
import { CoreModule } from '../core/core.module';
import { EMBEDDING_PORT, FakeEmbedding } from '../core/knowledge/embedding.port';
import {
  KnowledgeRetrievalService,
  type RetrievedChunk,
} from '../core/knowledge/knowledge-retrieval.service';
import {
  applyFloor,
  goldenSetSchema,
  judgeQuestion,
  summarize,
  type QuestionOutcome,
} from '../core/knowledge/rag-eval';

@Module({ imports: [CoreModule] })
class RagEvalModule {}

interface Args {
  set: string;
  sweep: number[] | null;
  minRecall: number | null;
  minAbstention: number | null;
  /** Para cada pergunta que errou, mostra em que posição o trecho certo apareceu (top-10). */
  diagnose: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const read = (flag: string): string | undefined => {
    const at = argv.indexOf(flag);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const number = (flag: string): number | null => {
    const value = read(flag);
    return value === undefined ? null : Number(value);
  };
  return {
    set: resolve(process.cwd(), read('--set') ?? 'assets/rag/golden-set.json'),
    sweep: read('--sweep')?.split(',').map(Number) ?? null,
    minRecall: number('--min-recall'),
    minAbstention: number('--min-abstention'),
    diagnose: argv.includes('--diagnose'),
  };
}

const out = (text = ''): void => {
  process.stdout.write(`${text}\n`);
};

const pct = (value: number): string => `${(value * 100).toFixed(0)}%`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const set = goldenSetSchema.parse(JSON.parse(readFileSync(args.set, 'utf8')));
  const app = await NestFactory.createApplicationContext(RagEvalModule, { logger: ['error'] });
  try {
    const retrieval = app.get(KnowledgeRetrievalService);
    const configured = app.get(AppConfigService).rag.minCosine;
    const floors = [...new Set([configured, ...(args.sweep ?? [])])].sort((a, b) => a - b);
    const lowest = Math.min(...floors);

    if (app.get(EMBEDDING_PORT) instanceof FakeEmbedding) {
      console.warn(
        '\n!! EMBEDDING DE DESENVOLVIMENTO (falso): estes números NÃO servem para calibrar. ' +
          'Use o provedor real.\n',
      );
    }
    out(`Conjunto: ${args.set}\nSituação: ${set.status}\n`);

    // Uma busca por pergunta, no menor piso; os demais pisos são aplicados depois, sem nova consulta.
    const ranked = new Map<string, RetrievedChunk[]>();
    for (const question of set.questions) {
      ranked.set(
        question.id,
        await retrieval.search(question.question, { minCosine: lowest, hint: question.hint }),
      );
    }

    const outcomesAt = (floor: number): QuestionOutcome[] =>
      set.questions.map((question) =>
        judgeQuestion(question, applyFloor(ranked.get(question.id) ?? [], floor)),
      );

    const detail = outcomesAt(configured);
    out(`Por pergunta (piso ${configured}):`);
    for (const outcome of detail) {
      const verdict =
        outcome.kind === 'ANSWERABLE'
          ? outcome.hit
            ? 'ACERTOU      '
            : outcome.returned === 0
              ? 'VAZIO (erro) '
              : 'ERROU        '
          : outcome.abstained
            ? 'CALOU (certo)'
            : 'RESPONDEU (erro)';
      const top = outcome.topTitle ? `${outcome.topCosine?.toFixed(2)}  ${outcome.topTitle}` : '-';
      out(`  ${verdict}  ${outcome.id.padEnd(26)} ${String(outcome.returned)} trecho(s)  ${top}`);
    }

    out('\nPor piso de similaridade (RAG_MIN_COSINE):');
    out('  piso   recall  falsos-vazios  abstenção  trechos/pergunta');
    let atConfigured = summarize(detail);
    for (const floor of floors) {
      const summary = summarize(outcomesAt(floor));
      if (floor === configured) atConfigured = summary;
      out(
        `  ${floor.toFixed(2)}   ${pct(summary.recall).padStart(5)}   ${String(summary.falseAbstentions).padStart(8)}      ` +
          `${pct(summary.abstentionRate).padStart(5)}      ${summary.avgReturnedAnswerable.toFixed(1)}${floor === configured ? '   <- configurado' : ''}`,
      );
    }

    if (args.diagnose) {
      out('\nDiagnóstico das perguntas que erraram (busca ampliada, top-10, sem piso):');
      for (const outcome of detail.filter((o) => o.kind === 'ANSWERABLE' && o.hit === false)) {
        const question = set.questions.find((q) => q.id === outcome.id);
        if (!question) continue;
        const wide = await retrieval.search(question.question, {
          minCosine: 0,
          topK: 10,
          hint: question.hint,
        });
        const at = wide.findIndex((chunk) => judgeQuestion(question, [chunk]).hit === true);
        const found = wide[at];
        out(
          `  ${outcome.id.padEnd(26)} ` +
            (found
              ? `trecho certo na posição ${at + 1} (${found.cosine.toFixed(2)}, ${found.title})`
              : 'nenhum dos 10 primeiros tem o assunto'),
        );
      }
    }

    const failures: string[] = [];
    if (args.minRecall !== null && atConfigured.recall < args.minRecall) {
      failures.push(`recall ${pct(atConfigured.recall)} < ${pct(args.minRecall)}`);
    }
    if (args.minAbstention !== null && atConfigured.abstentionRate < args.minAbstention) {
      failures.push(`abstenção ${pct(atConfigured.abstentionRate)} < ${pct(args.minAbstention)}`);
    }
    if (failures.length > 0) {
      console.error(`\nREPROVADO no piso ${configured}: ${failures.join('; ')}.`);
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
