/**
 * Script descartável: gera um PDF de amostra com `buildProtocolPdf` (função pura, sem DI)
 * pra conferir visualmente uma mudança de estética antes de considerar pronta.
 *
 * Uso:
 *   cd apps/api
 *   pnpm exec tsx src/scripts/render-sample-pdf.ts <caminho-de-saida.pdf>
 */
import { writeFileSync } from 'node:fs';
import type { ProtocolStructure } from '@movivo/shared';
import { buildProtocolPdf } from '../modules/protocol/protocol-pdf.service';

const content: ProtocolStructure = {
  promptVersion: 'sample-v1',
  goal: 'GAIN_MUSCLE',
  phase: 'HIPERTROFIA',
  phaseDurationWeeks: 5,
  weeklyFrequency: 3,
  splitType: 'ABC',
  sessions: [
    {
      dayLabel: 'Treino A',
      weekday: 'MON',
      focus: 'Peito, ombro e tríceps',
      exercises: [
        {
          exerciseId: 'supino_reto_com_barra',
          name: 'Supino Reto com Barra',
          sets: 4,
          reps: { min: 8, max: 12 },
          restSeconds: 90,
          rir: 2,
          loadStrategy: 'DOUBLE_PROGRESSION',
          warmupBlocks: [{ sets: 2, reps: { min: 15, max: 20 }, restSeconds: 30 }],
          notes: 'Foco em amplitude completa, sem travar o cotovelo no topo.',
        },
        {
          exerciseId: 'desenvolvimento_com_halteres',
          name: 'Desenvolvimento com Halteres',
          sets: 3,
          reps: { min: 10, max: 12 },
          restSeconds: 75,
          rir: 2,
          loadStrategy: 'LINEAR_PROGRESSION',
          technique: 'DROP_SET',
        },
        {
          exerciseId: 'triceps_na_polia_com_corda',
          name: 'Tríceps na Polia com Corda',
          sets: 3,
          reps: { min: 12, max: 15 },
          restSeconds: 60,
          rir: 1,
          loadStrategy: 'DOUBLE_PROGRESSION',
        },
      ],
    } as never,
    {
      dayLabel: 'Treino B',
      weekday: 'WED',
      focus: 'Costas e bíceps',
      exercises: [
        {
          exerciseId: 'puxada_frente_pegada_aberta',
          name: 'Puxada Frente Pegada Aberta',
          sets: 4,
          reps: { min: 8, max: 12 },
          restSeconds: 90,
          rir: 2,
          loadStrategy: 'DOUBLE_PROGRESSION',
        },
        {
          exerciseId: 'remada_curvada_com_barra',
          name: 'Remada Curvada com Barra',
          sets: 3,
          reps: { min: 8, max: 10 },
          restSeconds: 90,
          rir: 2,
          loadStrategy: 'LINEAR_PROGRESSION',
        },
      ],
    } as never,
  ],
};

async function main(): Promise<void> {
  const outputPath = process.argv[2];
  if (!outputPath) {
    console.error('Uso: tsx src/scripts/render-sample-pdf.ts <caminho-de-saida.pdf>');
    process.exitCode = 1;
    return;
  }
  const buffer = await buildProtocolPdf({
    content,
    mesocycleName: 'Mesociclo 1: Hipertrofia',
    startDate: new Date('2026-09-01'),
    endDate: new Date('2026-10-06'),
    totalWeeks: 5,
    signatureHash: 'a'.repeat(64),
    signedAt: new Date('2026-09-01'),
    student: {
      name: 'Aluno de Amostra',
      birthDate: '1998-05-10',
      biologicalSex: 'MALE',
      heightCm: 178,
      weightKg: 80,
    },
  });
  writeFileSync(outputPath, buffer);
  console.warn(`PDF gerado em ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error('[render-sample-pdf] falhou:', error);
  process.exitCode = 1;
});
