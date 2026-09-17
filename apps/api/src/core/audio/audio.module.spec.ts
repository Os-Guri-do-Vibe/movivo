import { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';

import type { AppConfigService } from '../config';
import { AudioTranscriptionCascade } from './audio-transcription-cascade';
import { createAudioTranscription } from './audio.module';
import { GroqTranscription } from './groq-transcription';
import { OpenAiTranscription } from './openai-transcription';

function config(overrides: {
  openaiKey?: string;
  openaiApproved?: boolean;
  groqKey?: string;
  groqApproved?: boolean;
}): AppConfigService {
  return {
    audioTranscription: {
      openaiApiKey: overrides.openaiKey,
      openaiHealthDataApproved: overrides.openaiApproved ?? false,
      groqApiKey: overrides.groqKey,
      groqHealthDataApproved: overrides.groqApproved ?? false,
      timeoutMs: 20_000,
    },
  } as unknown as AppConfigService;
}

function fakeLogger(): PinoLogger {
  return { setContext: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
}

/** Acesso ao array privado de pernas só pra inspeção nestes testes. */
function legsOf(
  cascade: AudioTranscriptionCascade,
): ReadonlyArray<{ name: string; port: unknown }> {
  return (cascade as unknown as { legs: ReadonlyArray<{ name: string; port: unknown }> }).legs;
}

describe('createAudioTranscription — cascata de STT com gate próprio por fornecedor (ADR-009)', () => {
  it('só OpenAI configurada: cascata com uma perna, OPENAI', () => {
    const cascade = createAudioTranscription(
      config({ openaiKey: 'sk-test', openaiApproved: true }),
      fakeLogger(),
    ) as AudioTranscriptionCascade;
    expect(cascade).toBeInstanceOf(AudioTranscriptionCascade);
    const legs = legsOf(cascade);
    expect(legs.map((l) => l.name)).toEqual(['OPENAI']);
  });

  it('as duas configuradas: cascata com OPENAI primeiro, GROQ como fallback', () => {
    const cascade = createAudioTranscription(
      config({
        openaiKey: 'sk-test',
        openaiApproved: true,
        groqKey: 'gsk-test',
        groqApproved: true,
      }),
      fakeLogger(),
    ) as AudioTranscriptionCascade;
    const legs = legsOf(cascade);
    expect(legs.map((l) => l.name)).toEqual(['OPENAI', 'GROQ']);
    expect(legs[0]?.port).toBeInstanceOf(OpenAiTranscription);
    expect(legs[1]?.port).toBeInstanceOf(GroqTranscription);
  });

  it('só Groq configurada (ex.: OpenAI sem aprovação): cascata com uma perna, GROQ', () => {
    const cascade = createAudioTranscription(
      config({
        openaiKey: 'sk-test',
        openaiApproved: false,
        groqKey: 'gsk-test',
        groqApproved: true,
      }),
      fakeLogger(),
    ) as AudioTranscriptionCascade;
    expect(legsOf(cascade).map((l) => l.name)).toEqual(['GROQ']);
  });

  it('nenhuma configurada: cascata vazia (lança ao transcrever, nunca finge)', async () => {
    const cascade = createAudioTranscription(config({}), fakeLogger());
    expect(legsOf(cascade as AudioTranscriptionCascade)).toEqual([]);
    await expect(
      cascade.transcribe({ audio: Buffer.from(''), mimeType: 'audio/ogg' }),
    ).rejects.toThrow('não configurada');
  });

  it('Groq com chave mas sem aprovação PRÓPRIA: não entra na cascata mesmo com OpenAI aprovada', () => {
    const cascade = createAudioTranscription(
      config({
        openaiKey: 'sk-test',
        openaiApproved: true,
        groqKey: 'gsk-test',
        groqApproved: false,
      }),
      fakeLogger(),
    ) as AudioTranscriptionCascade;
    expect(legsOf(cascade).map((l) => l.name)).toEqual(['OPENAI']);
  });
});
