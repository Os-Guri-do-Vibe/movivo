/**
 * Porta de transcrição de áudio (STT) do AI Coach — mesmo espírito de `EmbeddingPort`
 * (`core/knowledge/embedding.port.ts`): desacopla `WhatsappInboundService` do(s)
 * fornecedor(es) real(is) (`OpenAiTranscription`/`GroqTranscription`, os únicos arquivos
 * confinados a falar HTTP com eles — ver `llm-sdk-confinement.spec.ts` — combinados numa
 * `AudioTranscriptionCascade`). Testes injetam um fake.
 */
import type { AudioTranscriptionConfig } from '../config/app-config.service';

export interface AudioTranscriptionInput {
  readonly audio: Buffer;
  readonly mimeType: string;
}

export interface AudioTranscriptionPort {
  /** Texto transcrito, já sem espaços nas pontas. Lança em falha do provedor/rede. */
  transcribe(input: AudioTranscriptionInput): Promise<string>;
}

export const AUDIO_TRANSCRIPTION_PORT = Symbol('MOVIVO_AUDIO_TRANSCRIPTION_PORT');

/**
 * `true` quando PELO MENOS UM fornecedor (OpenAI ou Groq — ADR-009, cascata) tem chave E
 * aprovação de dado de saúde PRÓPRIA. Os dois gates nunca se substituem — cada fornecedor
 * só entra na cascata com o seu próprio atestado. Usada tanto por `WhatsappInboundService`
 * (pra avisar o aluno e nem tentar transcrever) quanto por `createAudioTranscription`
 * (`audio.module.ts`, pra montar as pernas da cascata) — uma única fonte de verdade.
 */
export function isAudioTranscriptionConfigured(config: AudioTranscriptionConfig): boolean {
  const openaiReady = Boolean(config.openaiApiKey) && config.openaiHealthDataApproved;
  const groqReady = Boolean(config.groqApiKey) && config.groqHealthDataApproved;
  return openaiReady || groqReady;
}
