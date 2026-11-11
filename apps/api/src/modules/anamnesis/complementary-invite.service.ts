import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../../core/config';
import { ShortLinkService } from '../short-link/short-link.service';
import { AnamnesisService } from './anamnesis.service';

/**
 * Convite da anamnese complementar: abre a sessão do aluno que já existia (com a parte comum
 * pré-preenchida) e devolve o link curto que a campanha manda por WhatsApp. O token fica no
 * FRAGMENTO do link de destino, fora de logs e da query.
 */
@Injectable()
export class ComplementaryInviteService {
  constructor(
    private readonly anamnesis: AnamnesisService,
    private readonly shortLinks: ShortLinkService,
    private readonly config: AppConfigService,
  ) {}

  async createLink(userId: string): Promise<{ url: string; expiresAt: Date }> {
    const { token, expiresAt } = await this.anamnesis.startComplementary(userId);
    const site = this.config.whatsapp.publicSiteUrl;
    const code = await this.shortLinks.create(
      `${site}/anamnese/complementar#token=${token}`,
      expiresAt,
    );
    return { url: `${site}/anamnese/c/${code}`, expiresAt };
  }
}
