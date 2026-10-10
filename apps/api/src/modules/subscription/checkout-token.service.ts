import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AccessLinkService } from '../../core/database/access-link.service';

const TTL_MS = 72 * 60 * 60 * 1_000;

/** Checkout opaco com estado revogável; não depende da chave de criptografia dos dados. */
@Injectable()
export class CheckoutTokenService {
  constructor(private readonly links: AccessLinkService) {}

  issue(userId: string, now = new Date()) {
    // Cada mensagem mantém seu próprio link válido até expirar; um lembrete não revoga o anterior.
    return this.links.issue('CHECKOUT', userId, randomUUID(), TTL_MS, now);
  }

  async verify(token: string, now = new Date()) {
    const verified = await this.links.verify(token, 'CHECKOUT', now);
    return verified ? { userId: verified.userId, expiresAt: verified.expiresAt.getTime() } : null;
  }

  revoke(token: string): Promise<void> {
    return this.links.revoke(token);
  }
}
