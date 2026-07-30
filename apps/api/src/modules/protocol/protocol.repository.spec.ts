import { createHash } from 'node:crypto';
import type { ProtocolStructure } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import { signatureHash } from './protocol.repository';

const content: ProtocolStructure = {
  promptVersion: 'v1',
  goal: 'GAIN_MUSCLE',
  phase: 'ADAPTACAO',
  weeklyFrequency: 3,
  sessions: [
    {
      dayLabel: 'A',
      focus: 'Full',
      exercises: [
        {
          exerciseId: 'goblet_squat',
          name: 'Agachamento',
          sets: 3,
          reps: { min: 8, max: 12 },
          loadStrategy: 'DOUBLE_PROGRESSION',
          restSeconds: 90,
        },
      ],
    },
  ],
};

describe('signatureHash (US-2.4)', () => {
  it('é o SHA-256 hex (64 chars) do conteúdo e é determinístico', () => {
    const hash = signatureHash(content);
    expect(hash).toHaveLength(64);
    expect(hash).toBe(createHash('sha256').update(JSON.stringify(content)).digest('hex'));
    expect(signatureHash(content)).toBe(hash);
  });

  it('muda quando o conteúdo muda (detecta adulteração)', () => {
    const tampered = { ...content, weeklyFrequency: 4 };
    expect(signatureHash(tampered)).not.toBe(signatureHash(content));
  });
});
