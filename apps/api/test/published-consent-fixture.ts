import { ConsentService } from '../src/modules/anamnesis/consent.service';

/**
 * Fixture de integração para os cenários com documentos publicados. A inscrição beta
 * também funciona com as minutas pendentes; esta subclasse permite testar o registro
 * de aceite contratual sem habilitar os documentos no serviço real.
 */
export class PublishedFixtureConsentService extends ConsentService {
  protected override areTermsPublished(): boolean {
    return true;
  }
}
