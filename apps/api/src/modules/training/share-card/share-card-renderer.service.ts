import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { renderAsync } from '@resvg/resvg-js';

import {
  SHARE_CARD_FONT_FAMILY,
  SHARE_CARD_FONT_FILES,
  loadShareCardAssets,
} from './share-card.assets';
import { SHARE_CARD_WIDTH, buildShareCardSvg, type ShareCardSvgInput } from './share-card.svg';

export interface ShareCardImage {
  png: Buffer;
  /** Hash do conteúdo: serve de ETag e de chave de cache. */
  etag: string;
}

/** Cada PNG tem entre 60 e 400 KB: 48 MB guardam centenas de cartões. */
const CACHE_MAX_BYTES = 48 * 1024 * 1024;
/** `renderAsync` roda no threadpool do libuv; limitar protege o event loop de uma rajada. */
const MAX_CONCURRENT_RENDERS = 2;

/**
 * Desenha o cartão no servidor (SVG → PNG via resvg). O PNG é endereçado pelo conteúdo (dados,
 * modelo e fundo), com cache LRU em memória e *single-flight*: pedidos simultâneos do mesmo
 * cartão disparam UM desenho. Trocar de modelo e voltar é sempre cache hit.
 */
@Injectable()
export class ShareCardRenderer {
  private readonly logger = new Logger(ShareCardRenderer.name);
  private readonly cache = new Map<string, ShareCardImage>();
  private readonly inFlight = new Map<string, Promise<ShareCardImage>>();
  private cacheBytes = 0;
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  async render(input: ShareCardSvgInput): Promise<ShareCardImage> {
    const key = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const hit = this.cache.get(key);
    if (hit) {
      // LRU: reinserir move a entrada para o fim da ordem de iteração.
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const job = this.draw(key, input).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, job);
    return job;
  }

  private async draw(key: string, input: ShareCardSvgInput): Promise<ShareCardImage> {
    await this.acquire();
    try {
      const started = performance.now();
      const svg = buildShareCardSvg(loadShareCardAssets(), input);
      const rendered = await renderAsync(svg, {
        fitTo: { mode: 'width', value: SHARE_CARD_WIDTH },
        font: {
          fontFiles: SHARE_CARD_FONT_FILES,
          loadSystemFonts: false,
          defaultFontFamily: SHARE_CARD_FONT_FAMILY,
        },
      });
      const image: ShareCardImage = { png: rendered.asPng(), etag: key.slice(0, 32) };
      this.logger.log(
        `cartão ${input.data.modality}/${input.layout} em ${Math.round(performance.now() - started)} ms (${image.png.length} bytes)`,
      );
      this.store(key, image);
      return image;
    } finally {
      this.release();
    }
  }

  private store(key: string, image: ShareCardImage): void {
    this.cache.set(key, image);
    this.cacheBytes += image.png.length;
    for (const [oldKey, old] of this.cache) {
      if (this.cacheBytes <= CACHE_MAX_BYTES || oldKey === key) break;
      this.cache.delete(oldKey);
      this.cacheBytes -= old.png.length;
    }
  }

  private acquire(): Promise<void> {
    if (this.active < MAX_CONCURRENT_RENDERS) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.active -= 1;
  }
}
