import { Injectable } from '@nestjs/common';

import { AccessLinkService } from '../../core/database/access-link.service';

const TTL_MS = 72 * 60 * 60 * 1_000;

/** Checkout opaco com estado revogável; não depende da chave de criptografia dos dados. */
@Injectable()
export class CheckoutTokenService {
  constructor(private readonly links: AccessLinkService) {}

  issue(userId: string, now = new Date()) {
    return this.links.issue('CHECKOUT', userId, userId, TTL_MS, now);
  }

  async verify(token: string, now = new Date()) {
    const verified = await this.links.verify(token, 'CHECKOUT', now);
    return verified ? { userId: verified.userId, expiresAt: verified.expiresAt.getTime() } : null;
  }

  revoke(token: string): Promise<void> {
    return this.links.revoke(token);
  }
}
