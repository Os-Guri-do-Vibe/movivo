import { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';

import type { AudioTranscriptionPort } from './audio-transcription.port';
import { AudioTranscriptionCascade } from './audio-transcription-cascade';

function fakeLogger(): PinoLogger {
  return { setContext: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
}

function fakePort(impl: (...args: unknown[]) => Promise<string>): AudioTranscriptionPort {
  return { transcribe: vi.fn(impl) };
}

const INPUT = { audio: Buffer.from('x'), mimeType: 'audio/ogg' };

describe('AudioTranscriptionCascade', () => {
  it('sem pernas: lança um erro claro (nunca finge transcrever)', async () => {
    await expect(new AudioTranscriptionCascade([], fakeLogger()).transcribe(INPUT)).rejects.toThrow(
      'não configurada',
    );
  });

  it('perna primária (OpenAI) funciona: usa direto, nunca chama a de fallback', async () => {
    const openai = fakePort(async () => 'transcrito pela openai');
    const groq = fakePort(async () => 'transcrito pelo groq');
    const cascade = new AudioTranscriptionCascade(
      [
        { name: 'OPENAI', port: openai },
        { name: 'GROQ', port: groq },
      ],
      fakeLogger(),
    );
    await expect(cascade.transcribe(INPUT)).resolves.toBe('transcrito pela openai');
    expect(groq.transcribe).not.toHaveBeenCalled();
  });

  it('perna primária falha (ex.: OpenAI sem saldo): cai pro fallback (Groq) automaticamente', async () => {
    const openai = fakePort(async () => {
      throw new Error('429: credit_balance_exhausted');
    });
    const groq = fakePort(async () => 'transcrito pelo groq');
    const cascade = new AudioTranscriptionCascade(
      [
        { name: 'OPENAI', port: openai },
        { name: 'GROQ', port: groq },
      ],
      fakeLogger(),
    );
    await expect(cascade.transcribe(INPUT)).resolves.toBe('transcrito pelo groq');
  });

  it('todas as pernas falham: propaga o erro da última tentativa', async () => {
    const openai = fakePort(async () => {
      throw new Error('openai fora do ar');
    });
    const groq = fakePort(async () => {
      throw new Error('groq fora do ar');
    });
    const cascade = new AudioTranscriptionCascade(
      [
        { name: 'OPENAI', port: openai },
        { name: 'GROQ', port: groq },
      ],
      fakeLogger(),
    );
    await expect(cascade.transcribe(INPUT)).rejects.toThrow('groq fora do ar');
  });
});
