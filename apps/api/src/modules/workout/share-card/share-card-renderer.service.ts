import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { renderAsync } from '@resvg/resvg-js';
import { formatShareCardDuration, type ShareCardMuscle } from '@movivo/shared';

import {
  SHARE_CARD_FONT_FAMILY,
  SHARE_CARD_FONT_FILES,
  loadShareCardAssets,
  type CardGender,
} from './share-card.assets';
import { SHARE_CARD_WIDTH, buildShareCardSvg } from './share-card.svg';

export interface ShareCardImage {
  png: Buffer;
  /** Hash do conteúdo: serve de ETag e de chave de cache. */
  etag: string;
}

export interface ShareCardRenderInput {
  gender: CardGender;
  groups: readonly ShareCardMuscle[];
  durationMinutes: number;
}

/** 65–315 KB por PNG: 32 MB guardam centenas de combinações (gênero × músculos × duração). */
const CACHE_MAX_BYTES = 32 * 1024 * 1024;
/** `renderAsync` roda no threadpool do libuv; limitar protege o event loop de uma rajada. */
const MAX_CONCURRENT_RENDERS = 2;

/**
 * Desenha o card de Story no servidor (SVG → PNG via resvg).
 *
 * O card só depende de (gênero, grupos musculares, duração): nada do aluno entra na imagem.
 * Por isso o PNG é endereçado pelo conteúdo — alunos que treinaram o mesmo e terminaram no
 * mesmo minuto compartilham o resultado —, com cache LRU em memória e *single-flight*: N
 * pedidos simultâneos da mesma chave disparam UM render. Rajada de fim de treino vira
 * cache hit; o aluno nunca espera o desenho.
 */
@Injectable()
export class ShareCardRenderer {
  private readonly logger = new Logger(ShareCardRenderer.name);
  private readonly cache = new Map<string, ShareCardImage>();
  private readonly inFlight = new Map<string, Promise<ShareCardImage>>();
  private cacheBytes = 0;
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  async render(input: ShareCardRenderInput): Promise<ShareCardImage> {
    const groups = [...new Set(input.groups)].sort();
    const durationLabel = formatShareCardDuration(input.durationMinutes);
    const key = createHash('sha256')
      .update(JSON.stringify([input.gender, groups, durationLabel]))
      .digest('hex');

    const hit = this.cache.get(key);
    if (hit) {
      // LRU: reinserir move a entrada para o fim da ordem de iteração.
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const job = this.draw(key, input.gender, groups, durationLabel).finally(() =>
      this.inFlight.delete(key),
    );
    this.inFlight.set(key, job);
    return job;
  }

  private async draw(
    key: string,
    gender: CardGender,
    groups: ShareCardMuscle[],
    durationLabel: string,
  ): Promise<ShareCardImage> {
    await this.acquire();
    try {
      const started = performance.now();
      const svg = buildShareCardSvg(loadShareCardAssets(), {
        gender,
        groups: new Set(groups),
        durationLabel,
      });
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
        `share-card renderizado em ${Math.round(performance.now() - started)} ms (${image.png.length} bytes)`,
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
