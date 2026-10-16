import {
  CONTEXTUAL_QUALITY_VERSION,
  QUALITY_CRITERIA,
  type ContextualQualityAssessment,
} from './contextual-quality';

export function qualityAssessment(
  status: 'PASS' | 'GAPS' | 'UNAVAILABLE' = 'PASS',
): ContextualQualityAssessment {
  return {
    summary: {
      version: CONTEXTUAL_QUALITY_VERSION,
      status,
      checks:
        status === 'UNAVAILABLE'
          ? []
          : QUALITY_CRITERIA.map((criterion) => ({
              criterion,
              status: status === 'GAPS' && criterion === 'METHODOLOGY_FIT' ? 'GAP' : 'MET',
            })),
      missingEmphasisCount: 0,
      ...(status === 'UNAVAILABLE' ? { unavailableReason: 'LLM_UNAVAILABLE' } : {}),
    },
  };
}
