import { describe, expect, it } from 'vitest';

import { hyroxStationSchema } from '@movivo/shared';

import { HYROX_STATIONS } from './hyrox-stations';

describe('estações de HYROX', () => {
  it('cobre as oito estações oficiais, na ordem da prova, cada uma com alternativa', () => {
    expect(HYROX_STATIONS.map((s) => s.station)).toEqual(hyroxStationSchema.options);
    for (const station of HYROX_STATIONS) {
      expect(station.alternatives.length).toBeGreaterThan(0);
      expect(station.demands.length).toBeGreaterThan(0);
    }
  });
});
