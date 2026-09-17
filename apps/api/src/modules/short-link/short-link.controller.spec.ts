import { GoneException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ShortLinkController } from './short-link.controller';
import type { ShortLinkService } from './short-link.service';

function makeController(resolve: (code: string) => Promise<string | null>) {
  const service = { resolve: vi.fn(resolve) } as unknown as ShortLinkService;
  return new ShortLinkController(service);
}

describe('ShortLinkController.resolve', () => {
  it('devolve a URL alvo em JSON quando o código resolve', async () => {
    const controller = makeController(async () => 'https://movivo.app/treino/acessar#token=secret');
    await expect(controller.resolve('aB3xK9pQ')).resolves.toEqual({
      url: 'https://movivo.app/treino/acessar#token=secret',
    });
  });

  it('lança 410 quando o código não resolve (inexistente ou expirado)', async () => {
    const controller = makeController(async () => null);
    await expect(controller.resolve('aB3xK9pQ')).rejects.toBeInstanceOf(GoneException);
  });

  it('lança 410 sem consultar o serviço para um código fora do formato esperado', async () => {
    const resolve = vi.fn(async () => 'https://movivo.app/x');
    const controller = makeController(resolve);
    await expect(controller.resolve('../etc/passwd')).rejects.toBeInstanceOf(GoneException);
    expect(resolve).not.toHaveBeenCalled();
  });
});
