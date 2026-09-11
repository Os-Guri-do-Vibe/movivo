import type { EmbeddingPort } from './embedding.port';

/**
 * Decorator de `EmbeddingPort`: junta chamadas concorrentes de `embed()` (mesmo tick de
 * I/O) numa única chamada de `embedBatch()` ao provedor real.
 *
 * Achado 2026-09-04 (reproduzido ao vivo): uma única geração de protocolo dispara até 5
 * buscas de RAG em paralelo (`ProtocolGeneratorService.retrieveEvidence`), cada uma
 * chamando `embed()` uma vez — 5 requisições SIMULTÂNEAS à API de embedding da OpenAI por
 * tentativa de geração (10 contando o retry). Isso estourava o rate limit da chave
 * (429 em toda faceta, sempre), então a IA nunca via nenhuma evidência do RAG — a base de
 * conhecimento virava sempre um "envelope vazio" apesar de existir. Uma requisição em lote
 * (`embedBatch`) no lugar de 5 isoladas resolve na raiz, sem mudar nenhum call site.
 *
 * Janela de agrupamento: `setImmediate` (não microtask) de propósito — cada `embed()`
 * chega aqui depois de alguns `await` intermediários (`retrieve` → `search`), então um
 * `queueMicrotask` fecharia o lote cedo demais, antes das outras chamadas concorrentes
 * chegarem. `setImmediate` espera o fim do tick de I/O corrente, cobrindo todas elas.
 */
export class BatchingEmbedding implements EmbeddingPort {
  private pending: Array<{
    text: string;
    resolve: (vector: number[]) => void;
    reject: (error: unknown) => void;
  }> = [];
  private flushScheduled = false;

  /** Público (não `private`) de propósito: permite ao teste confirmar QUAL provedor real
   * está por trás do agrupamento, sem precisar de cast/reflexão sobre campo privado. */
  constructor(readonly inner: EmbeddingPort) {}

  embed(text: string): Promise<number[]> {
    return new Promise((resolve, reject) => {
      this.pending.push({ text, resolve, reject });
      this.scheduleFlush();
    });
  }

  embedBatch(texts: string[]): Promise<number[][]> {
    return this.inner.embedBatch(texts);
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    setImmediate(() => void this.flush());
  }

  private async flush(): Promise<void> {
    this.flushScheduled = false;
    const batch = this.pending;
    this.pending = [];
    if (batch.length === 0) return;
    try {
      const vectors = await this.inner.embedBatch(batch.map((item) => item.text));
      batch.forEach((item, index) => {
        const vector = vectors[index];
        if (vector) item.resolve(vector);
        else item.reject(new Error('Provider de embedding devolveu lote incompleto.'));
      });
    } catch (error) {
      batch.forEach((item) => item.reject(error));
    }
  }
}
