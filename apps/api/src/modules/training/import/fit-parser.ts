/**
 * Leitor mínimo de arquivos `.fit` (Garmin): extrai o RESUMO da atividade (mensagem `session`) e
 * as voltas (`lap`). Não decodifica registros ponto a ponto nem dados de desenvolvedor — só o
 * que vira métrica de treino. Binário vindo do aluno é dado não confiável: todo acesso é
 * limitado ao tamanho do buffer e qualquer inconsistência vira `FitParseError`.
 */
import type { EnduranceMetrics } from '@movivo/shared';

import { finalizeMetrics, type ParsedActivity } from './metrics';

export class FitParseError extends Error {}

const MAX_BYTES = 8 * 1024 * 1024;
const MESSAGE_SESSION = 18;
const MESSAGE_LAP = 19;

interface FieldDef {
  num: number;
  size: number;
  base: number;
}
interface Definition {
  littleEndian: boolean;
  globalNumber: number;
  fields: FieldDef[];
  developerBytes: number;
}

/** CRC-16 do formato FIT. */
export function fitCrc(bytes: Uint8Array, start = 0, end = bytes.length): number {
  const table = [
    0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401,
    0x5000, 0x9c01, 0x8801, 0x4400,
  ];
  let crc = 0;
  for (let i = start; i < end; i += 1) {
    const byte = bytes[i] ?? 0;
    let tmp = table[crc & 0xf] ?? 0;
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ (table[byte & 0xf] ?? 0);
    tmp = table[crc & 0xf] ?? 0;
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ (table[(byte >> 4) & 0xf] ?? 0);
  }
  return crc;
}

/** Valor inteiro sem sinal do campo, ou `null` se for o valor "inválido" do tipo base. */
function readUnsigned(
  view: DataView,
  offset: number,
  def: FieldDef,
  little: boolean,
): number | null {
  const base = def.base & 0x1f;
  switch (def.size) {
    case 1: {
      const v = view.getUint8(offset);
      return base === 2 || base === 10 || base === 0 || base === 13 ? (v === 0xff ? null : v) : v;
    }
    case 2: {
      const v = view.getUint16(offset, little);
      return v === 0xffff ? null : v;
    }
    case 4: {
      const v = view.getUint32(offset, little);
      return v === 0xffffffff ? null : v;
    }
    default:
      return null;
  }
}

export function parseFit(input: Uint8Array): ParsedActivity {
  if (input.byteLength > MAX_BYTES) throw new FitParseError('arquivo maior que o limite de 8 MB');
  if (input.byteLength < 14) throw new FitParseError('arquivo FIT curto demais');
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const headerSize = view.getUint8(0);
  if (headerSize !== 12 && headerSize !== 14) throw new FitParseError('cabeçalho FIT inválido');
  const signature = String.fromCharCode(...input.slice(8, 12));
  if (signature !== '.FIT') throw new FitParseError('não é um arquivo FIT');
  const dataSize = view.getUint32(4, true);
  const dataEnd = headerSize + dataSize;
  if (dataEnd + 2 > input.byteLength) throw new FitParseError('arquivo FIT truncado');
  const storedCrc = view.getUint16(dataEnd, true);
  if (storedCrc !== 0 && storedCrc !== fitCrc(input, 0, dataEnd)) {
    throw new FitParseError('CRC do arquivo FIT não confere');
  }

  const definitions = new Map<number, Definition>();
  const sessions: Record<number, number | null>[] = [];
  const laps: Record<number, number | null>[] = [];
  let offset = headerSize;

  while (offset < dataEnd) {
    const header = view.getUint8(offset);
    offset += 1;
    const compressed = (header & 0x80) !== 0;
    const isDefinition = !compressed && (header & 0x40) !== 0;
    const hasDeveloper = !compressed && (header & 0x20) !== 0;
    const localType = compressed ? (header >> 5) & 0x03 : header & 0x0f;

    if (isDefinition) {
      if (offset + 5 > dataEnd) throw new FitParseError('definição FIT truncada');
      const littleEndian = view.getUint8(offset + 1) === 0;
      const globalNumber = view.getUint16(offset + 2, littleEndian);
      const count = view.getUint8(offset + 4);
      offset += 5;
      if (offset + count * 3 > dataEnd) throw new FitParseError('definição FIT truncada');
      const fields: FieldDef[] = [];
      for (let i = 0; i < count; i += 1) {
        fields.push({
          num: view.getUint8(offset),
          size: view.getUint8(offset + 1),
          base: view.getUint8(offset + 2),
        });
        offset += 3;
      }
      let developerBytes = 0;
      if (hasDeveloper) {
        const devCount = view.getUint8(offset);
        offset += 1;
        for (let i = 0; i < devCount; i += 1) {
          developerBytes += view.getUint8(offset + 1);
          offset += 3;
        }
      }
      definitions.set(localType, { littleEndian, globalNumber, fields, developerBytes });
      continue;
    }

    const def = definitions.get(localType);
    if (!def) throw new FitParseError('mensagem FIT sem definição');
    const record: Record<number, number | null> = {};
    for (const field of def.fields) {
      if (offset + field.size > dataEnd) throw new FitParseError('mensagem FIT truncada');
      if (def.globalNumber === MESSAGE_SESSION || def.globalNumber === MESSAGE_LAP) {
        record[field.num] = readUnsigned(view, offset, field, def.littleEndian);
      }
      offset += field.size;
    }
    offset += def.developerBytes;
    if (def.globalNumber === MESSAGE_SESSION) sessions.push(record);
    if (def.globalNumber === MESSAGE_LAP) laps.push(record);
  }

  const session = sessions[0];
  if (!session) throw new FitParseError('o arquivo não tem resumo de atividade');
  const scaled = (value: number | null | undefined, scale: number) =>
    value == null ? undefined : value / scale;
  // Esporte FIT: 1 = corrida; cadência vem por perna (rpm) e é dobrada para passos/min.
  const sport = session[5];
  const cadence = session[18];
  const metrics: EnduranceMetrics = {
    distanceMeters: scaled(session[9], 100),
    movingSeconds: scaled(session[8], 1000),
    elapsedSeconds: scaled(session[7], 1000),
    avgHeartRate: session[16] ?? undefined,
    maxHeartRate: session[17] ?? undefined,
    elevationGainMeters: session[22] ?? undefined,
    cadenceSpm: cadence != null ? (sport === 1 ? cadence * 2 : cadence) : undefined,
    laps: laps
      .map((lap) => ({
        distanceMeters: (lap[9] ?? 0) / 100,
        durationSeconds: (lap[8] ?? lap[7] ?? 0) / 1000,
        ...(lap[15] != null ? { avgHeartRate: lap[15] } : {}),
      }))
      .filter((lap) => lap.distanceMeters > 0 || lap.durationSeconds > 0),
  };
  return finalizeMetrics(metrics, {
    sport: sport === 1 ? 'RUNNING' : sport === 5 ? 'CYCLING' : 'OTHER',
  });
}
