import { CONSENT_VERSIONS } from '@movivo/shared';

/** Liberação única para os links e as rotas. Preencher só após homologação jurídica. */
export const LEGAL_RELEASE: { terms: string | null; privacy: string | null } = {
  terms: null,
  privacy: null,
};

export const legalReleaseMatchesConsent =
  LEGAL_RELEASE.terms !== null &&
  LEGAL_RELEASE.privacy !== null &&
  LEGAL_RELEASE.terms === CONSENT_VERSIONS.TERMS_OF_SERVICE;
