import { ConsentService } from '../src/modules/anamnesis/consent.service';

/**
 * Fixture de integração: enquanto as minutas jurídicas estão `DRAFT_BLOCKED`, o serviço real
 * recusa novos aceites de Termos e a progressão da anamnese. Os testes que precisam do fluxo
 * pós-gate (anamnese → protocolo → WhatsApp) usam esta subclasse, sem habilitar as minutas no
 * serviço real — o bloqueio em si é exercitado à parte em `anamnesis.int-spec.ts`.
 */
export class PublishedFixtureConsentService extends ConsentService {
  protected override areTermsPublished(): boolean {
    return true;
  }
}
