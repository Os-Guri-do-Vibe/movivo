/** Arquivo `.fit` mínimo para testes (um `lap` e um `session`, CRC válido). */
import { fitCrc } from './fit-parser';

/** Monta um arquivo FIT mínimo: um `lap` e um `session`, little-endian, com CRC válido. */
export function buildFit(
  options: { corrupt?: boolean; withoutSession?: boolean } = {},
): Uint8Array {
  const body: number[] = [];
  const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
  const u32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
  const definition = (local: number, global: number, fields: [number, number, number][]) => {
    body.push(0x40 | local, 0, 0, ...u16(global), fields.length);
    for (const [num, size, base] of fields) body.push(num, size, base);
  };
  // lap (19): 7 elapsed ms (u32), 9 distance cm (u32), 15 avg HR (u8)
  definition(0, 19, [
    [7, 4, 0x86],
    [9, 4, 0x86],
    [15, 1, 0x02],
  ]);
  body.push(0, ...u32(1_500_000), ...u32(500_000), 150);
  if (!options.withoutSession) {
    // session (18): 5 sport (u8), 7 elapsed, 8 timer, 9 distance, 16 avg HR, 17 max HR, 18 cadence, 22 ascent
    definition(1, 18, [
      [5, 1, 0x00],
      [7, 4, 0x86],
      [8, 4, 0x86],
      [9, 4, 0x86],
      [16, 1, 0x02],
      [17, 1, 0x02],
      [18, 1, 0x02],
      [22, 2, 0x84],
    ]);
    body.push(
      1,
      1,
      ...u32(1_700_000),
      ...u32(1_690_000),
      ...u32(500_000),
      152,
      171,
      88,
      ...u16(42),
    );
  }
  const header = [14, 0x20, ...u16(2_100), ...u32(body.length), 0x2e, 0x46, 0x49, 0x54, 0, 0];
  const bytes = new Uint8Array([...header, ...body, 0, 0]);
  const crc = fitCrc(bytes, 0, bytes.length - 2);
  bytes[bytes.length - 2] = (options.corrupt ? crc ^ 0xff : crc) & 0xff;
  bytes[bytes.length - 1] = (crc >> 8) & 0xff;
  return bytes;
}
