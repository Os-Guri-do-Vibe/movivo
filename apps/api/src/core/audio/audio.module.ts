/**
 * `AudioModule` — transcrição de áudio (STT) do AI Coach, bloco CORE (mesmo padrão do
 * `KnowledgeModule` para embedding: `@Global()`, um único `AUDIO_TRANSCRIPTION_PORT`
 * resolvido no boot a partir da config).
 */
import { Global, Module } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { AppConfigService } from '../config';
import { AUDIO_TRANSCRIPTION_PORT, type AudioTranscriptionPort } from './audio-transcription.port';
import {
  AudioTranscriptionCascade,
  type AudioTranscriptionLeg,
} from './audio-transcription-cascade';
import { GroqTranscription } from './groq-transcription';
import { OpenAiTranscription } from './openai-transcription';

/**
 * Transcrição também é transferência de dado do titular a um provedor — mesmo gate de
 * HEALTH que o `LLMRouter` e o `OpenAiEmbedding` aplicam, mas com atestado PRÓPRIO por
 * fornecedor (`STT_OPENAI_HEALTH_DATA_APPROVED`/`STT_GROQ_HEALTH_DATA_APPROVED`, nunca
 * `LLM_OPENAI_HEALTH_DATA_APPROVED`): é dado de áudio bruto do titular, superfície
 * diferente de texto já escrito por ele, e pode levar avaliação própria de Jurídico/
 * Segurança.
 *
 * **Cascata (ADR-009, revisão 2026-09-14 — decisão do fundador):** OpenAI é a perna
 * PRIMÁRIA (produção); Groq é o FALLBACK automático — em produção e local, não é mais uma
 * troca manual de fornecedor. Cada perna só entra na cascata com chave + aprovação
 * próprias; sem nenhuma das duas configurada, a cascata (com zero pernas) lança um erro
 * claro em vez de fingir transcrever — `WhatsappInboundService` já checa
 * `isAudioTranscriptionConfigured` ANTES de chamar a porta, então isso só dispara se
 * alguém pular esse gate.
 */
export function createAudioTranscription(
  config: AppConfigService,
  logger: PinoLogger,
): AudioTranscriptionPort {
  const audio = config.audioTranscription;
  const legs: AudioTranscriptionLeg[] = [];
  if (audio.openaiApiKey && audio.openaiHealthDataApproved) {
    legs.push({
      name: 'OPENAI',
      port: new OpenAiTranscription(audio.openaiApiKey, audio.timeoutMs),
    });
  }
  if (audio.groqApiKey && audio.groqHealthDataApproved) {
    legs.push({ name: 'GROQ', port: new GroqTranscription(audio.groqApiKey, audio.timeoutMs) });
  }
  return new AudioTranscriptionCascade(legs, logger);
}

@Global()
@Module({
  providers: [
    {
      provide: AUDIO_TRANSCRIPTION_PORT,
      inject: [AppConfigService, PinoLogger],
      useFactory: createAudioTranscription,
    },
  ],
  exports: [AUDIO_TRANSCRIPTION_PORT],
})
export class AudioModule {}
