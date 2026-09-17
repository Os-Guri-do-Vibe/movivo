/**
 * `GroqTranscription` — único arquivo do backend que fala HTTP com o endpoint de
 * transcrição (STT) da Groq. Mesmo padrão de confinamento de `OpenAiTranscription`
 * (`llm-sdk-confinement.spec.ts` prova estruturalmente que nenhum outro arquivo faz isso).
 *
 * **Perna de FALLBACK da cascata de STT (ADR-009, revisão 2026-09-14 — decisão do
 * fundador)** — entra automaticamente em produção E local sempre que tiver chave +
 * aprovação de HEALTH próprias (`GROQ_API_KEY` + `STT_GROQ_HEALTH_DATA_APPROVED`), sem
 * troca manual de provedor. `createAudioTranscription` (`audio.module.ts`) monta a
 * cascata com a OpenAI primeiro; se ela falhar numa chamada (ex.: achado 2026-09-14, a
 * chave da OpenAI ficou sem saldo — `credit_balance_exhausted`), `AudioTranscriptionCascade`
 * cai pra esta perna sozinha.
 *
 * A API da Groq para Whisper é **compatível com a da OpenAI** (mesmo formato multipart,
 * mesma resposta `{ text }`) — só o host, a chave e o nome do modelo mudam.
 * `whisper-large-v3-turbo`: ~18x mais barato que a OpenAI e com free tier generoso
 * (2.000 requests/dia, 28.800s de áudio/dia) — cobre folgado o volume de teste/MVP.
 */
import type { AudioTranscriptionInput, AudioTranscriptionPort } from './audio-transcription.port';

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3-turbo';

interface GroqTranscriptionResponse {
  text?: string;
}

export class GroqTranscription implements AudioTranscriptionPort {
  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs: number,
  ) {}

  async transcribe({ audio, mimeType }: AudioTranscriptionInput): Promise<string> {
    const form = new FormData();
    form.append('model', MODEL);
    form.append('language', 'pt');
    form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), 'audio.ogg');

    let response: Response;
    try {
      response = await fetch(GROQ_TRANSCRIPTION_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { authorization: `Bearer ${this.apiKey}` },
        body: form,
      });
    } catch (cause) {
      throw new Error('Provider de transcrição (Groq) indisponível.', { cause });
    }

    if (!response.ok) {
      throw new Error(`Provider de transcrição (Groq) recusou a requisição (${response.status}).`);
    }

    const payload = (await response.json()) as GroqTranscriptionResponse;
    const text = payload.text?.trim();
    if (!text) throw new Error('Provider de transcrição (Groq) devolveu texto vazio.');
    return text;
  }
}
