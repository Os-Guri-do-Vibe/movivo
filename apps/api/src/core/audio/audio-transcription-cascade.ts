/**
 * `AudioTranscriptionCascade` — cascata de fornecedores de STT (ADR-009, decisão
 * revisada 2026-09-14 a pedido do fundador): tenta cada perna CONFIGURADA em ordem e só
 * passa pra próxima se a anterior lançar. `OPENAI` é a perna primária (produção); `GROQ`
 * é o fallback automático, tanto em produção quanto local — não é mais uma troca manual
 * de fornecedor (`AUDIO_TRANSCRIPTION_PROVIDER` foi removida), os dois participam sempre
 * que tiverem chave + aprovação de HEALTH próprias.
 *
 * Mesmo espírito do `LLMRouter` (ADR-005-R2), sem a mesma complexidade: nada de circuit
 * breaker/retry por perna — o volume e a criticidade de STT não justificam, e quem chama
 * (`WhatsappInboundService.resolveAudioText`) já tem um fallback de UX pronto (avisa o
 * aluno pra escrever) se a cascata inteira falhar.
 */
import type { PinoLogger } from 'nestjs-pino';

import type { AudioTranscriptionInput, AudioTranscriptionPort } from './audio-transcription.port';

export interface AudioTranscriptionLeg {
  readonly name: 'OPENAI' | 'GROQ';
  readonly port: AudioTranscriptionPort;
}

export class AudioTranscriptionCascade implements AudioTranscriptionPort {
  constructor(
    private readonly legs: readonly AudioTranscriptionLeg[],
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AudioTranscriptionCascade.name);
  }

  async transcribe(input: AudioTranscriptionInput): Promise<string> {
    if (this.legs.length === 0) {
      throw new Error(
        'Transcrição de áudio não configurada — nenhum fornecedor (OpenAI/Groq) tem ' +
          'chave e aprovação de dado de saúde ativas.',
      );
    }

    let lastError: unknown;
    for (const leg of this.legs) {
      try {
        return await leg.port.transcribe(input);
      } catch (error) {
        lastError = error;
        this.logger.warn(
          {
            event: 'audio_transcription_leg_failed',
            provider: leg.name,
            err: error instanceof Error ? error.message : 'erro desconhecido',
          },
          'perna da cascata de STT falhou — tentando a próxima',
        );
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Cascata de transcrição de áudio esgotada sem sucesso.');
  }
}
