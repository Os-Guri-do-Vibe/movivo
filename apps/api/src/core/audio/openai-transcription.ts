/**
 * `OpenAiTranscription` — único arquivo do backend que fala HTTP com o endpoint de
 * transcrição (STT) da OpenAI. Mesmo padrão de confinamento do `LLMRouter`
 * (`llm/providers.ts`) e do `OpenAiEmbedding` (`core/knowledge/openai-embedding.ts`) —
 * `llm-sdk-confinement.spec.ts` prova estruturalmente que nenhum outro arquivo faz isso.
 *
 * Modelo: `gpt-4o-mini-transcribe` — decisão do fundador (2026-09-14), depois de comparar
 * custo real contra Groq (whisper-large-v3-turbo, ~18x mais barato) e self-hosted
 * (whisper.cpp): no volume do MVP o custo de qualquer opção é trivial (≤R$0,10/aluno/mês),
 * então o critério que decidiu foi reaproveitar a MESMA OpenAI já em diligência de DPA no
 * ADR-005-R2 (fallback do `LLMRouter`) em vez de abrir due diligence com um fornecedor de
 * STT novo. `language: 'pt'` porque o público é 100% brasileiro (ICP de Clóvis).
 */
import type { AudioTranscriptionInput, AudioTranscriptionPort } from './audio-transcription.port';

const OPENAI_TRANSCRIPTION_URL = 'https://api.openai.com/v1/audio/transcriptions';
const MODEL = 'gpt-4o-mini-transcribe';

interface OpenAiTranscriptionResponse {
  text?: string;
}

export class OpenAiTranscription implements AudioTranscriptionPort {
  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs: number,
  ) {}

  async transcribe({ audio, mimeType }: AudioTranscriptionInput): Promise<string> {
    const form = new FormData();
    form.append('model', MODEL);
    form.append('language', 'pt');
    // Nome do arquivo é só um rótulo pro multipart — a OpenAI detecta o formato real pelo
    // conteúdo/`mimeType` do Blob, não pela extensão.
    // `new Uint8Array(audio)` copia pra um `ArrayBuffer` comum — o `Buffer` do Node tipa o
    // backing store como `ArrayBufferLike` (inclui `SharedArrayBuffer`), que `Blob` recusa.
    form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), 'audio.ogg');

    let response: Response;
    try {
      response = await fetch(OPENAI_TRANSCRIPTION_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { authorization: `Bearer ${this.apiKey}` },
        body: form,
      });
    } catch (cause) {
      throw new Error('Provider de transcrição indisponível.', { cause });
    }

    if (!response.ok) {
      throw new Error(`Provider de transcrição recusou a requisição (${response.status}).`);
    }

    const payload = (await response.json()) as OpenAiTranscriptionResponse;
    const text = payload.text?.trim();
    if (!text) throw new Error('Provider de transcrição devolveu texto vazio.');
    return text;
  }
}
