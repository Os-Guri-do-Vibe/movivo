import { afterEach, describe, expect, it, vi } from 'vitest';

import { GroqTranscription } from './groq-transcription';

afterEach(() => vi.unstubAllGlobals());

describe('GroqTranscription', () => {
  it('manda multipart com o modelo/idioma corretos e devolve o texto', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ text: '  quanto peso eu uso? ' })));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GroqTranscription('secret', 20_000);
    const audio = Buffer.from('conteudo-fake-do-audio');
    await expect(provider.transcribe({ audio, mimeType: 'audio/ogg; codecs=opus' })).resolves.toBe(
      'quanto peso eu uso?',
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(init.headers).toMatchObject({ authorization: 'Bearer secret' });
    const form = init.body as FormData;
    expect(form.get('model')).toBe('whisper-large-v3-turbo');
    expect(form.get('language')).toBe('pt');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('resposta sem texto (ou vazia) → lança, nunca devolve string vazia', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: '  ' }))));
    await expect(
      new GroqTranscription('secret', 20_000).transcribe({
        audio: Buffer.from('x'),
        mimeType: 'audio/ogg',
      }),
    ).rejects.toThrow('texto vazio');
  });

  it('provedor recusa (status não-ok) → lança com o status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 429 })));
    await expect(
      new GroqTranscription('secret', 20_000).transcribe({
        audio: Buffer.from('x'),
        mimeType: 'audio/ogg',
      }),
    ).rejects.toThrow('429');
  });
});
