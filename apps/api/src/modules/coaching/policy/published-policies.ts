import { Injectable } from '@nestjs/common';

import { PublishedMethodologyReader } from '../../methodology/published-methodology.reader';
import { type SentinelParams, sentinelParamsFrom } from '../safety/sentinel-rules';
import { type AutonomyPolicy, autonomyPolicyFrom } from './autonomy-policy';

/**
 * Políticas em vigor, lidas dos documentos AUTONOMY e SAFETY publicados. Sem documento
 * publicado, devolve `null` e o motor usa os padrões conservadores.
 */
@Injectable()
export class PublishedPolicies {
  constructor(private readonly methodology: PublishedMethodologyReader) {}

  async autonomy(): Promise<AutonomyPolicy | null> {
    const doc = await this.methodology.publishedOf('AUTONOMY');
    return doc ? autonomyPolicyFrom(doc.version, doc.parameters) : null;
  }

  async sentinel(): Promise<SentinelParams | null> {
    const doc = await this.methodology.publishedOf('SAFETY');
    return doc ? sentinelParamsFrom(doc.parameters) : null;
  }
}
