import { CONSENT_VERSIONS } from '@movivo/shared';

/** Versões exibidas no beta; visibilidade não equivale a homologação jurídica. */
export const LEGAL_RELEASE: {
  terms: string | null;
  privacy: string | null;
  checkoutApproved: boolean;
} = {
  terms: 'terms-2026-09-v1',
  privacy: 'privacy-2026-09-v1',
  checkoutApproved: false,
};

export const legalReleaseMatchesConsent =
  LEGAL_RELEASE.terms !== null &&
  LEGAL_RELEASE.privacy !== null &&
  LEGAL_RELEASE.terms === CONSENT_VERSIONS.TERMS_OF_SERVICE;
