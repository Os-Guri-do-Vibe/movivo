'use client';

/** Exame enviado pelo aluno: o que a IA leu, o que comentou com ele e o arquivo original. */
import { useState } from 'react';

import type { MedicalExamView } from '@movivo/shared';

import { Button } from '@/components/ui/button';
import { getExceptionExamFile } from '@/lib/control-center-api';

const FLAG_LABEL = {
  HIGH: 'Acima',
  LOW: 'Abaixo',
  NORMAL: 'Na referência',
  UNCLEAR: 'Sem referência',
} as const;

const URGENCY_LABEL = {
  ROUTINE: 'Rotina',
  SOON: 'Consulta em breve',
  URGENT: 'Atendimento no mesmo dia',
} as const;

export function ExamReview({ caseId, exam }: { caseId: string; exam: MedicalExamView }) {
  const [opening, setOpening] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const { reading, comment } = exam;

  const openFile = async () => {
    setOpening(true);
    setFileError(null);
    try {
      const file = await getExceptionExamFile(caseId);
      const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: file.mediaType }));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setFileError('Não foi possível abrir o arquivo.');
    } finally {
      setOpening(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5" aria-label="Exame">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-h3 font-semibold">
          {reading?.examType ?? 'Exame enviado'}
          {reading?.examDate ? ` · ${reading.examDate.split('-').reverse().join('/')}` : ''}
        </h2>
        <Button type="button" variant="outline" disabled={opening} onClick={() => void openFile()}>
          Ver arquivo original
        </Button>
      </div>
      {fileError ? <p className="mt-2 text-xs text-destructive">{fileError}</p> : null}

      {reading && reading.values.length > 0 ? (
        <table className="mt-3 w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Exame</th>
              <th className="py-1 font-medium">Valor</th>
              <th className="py-1 font-medium">Referência do laudo</th>
              <th className="py-1 font-medium">Leitura da IA</th>
            </tr>
          </thead>
          <tbody>
            {reading.values.map((v) => (
              <tr key={`${v.name}-${v.value}`} className="border-t border-border">
                <td className="py-1">{v.name}</td>
                <td className="py-1">
                  {v.value}
                  {v.unit ? ` ${v.unit}` : ''}
                </td>
                <td className="py-1">{v.referenceRange ?? '—'}</td>
                <td className={v.flag === 'HIGH' || v.flag === 'LOW' ? 'py-1 font-medium' : 'py-1'}>
                  {FLAG_LABEL[v.flag]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {comment ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-muted-foreground">
            {URGENCY_LABEL[comment.urgency]}
            {comment.specialties.length > 0
              ? ` · Especialidade sugerida: ${comment.specialties.join(', ')}`
              : ''}
          </p>
          <p className="text-xs font-medium">O que o aluno recebeu</p>
          <p className="whitespace-pre-line rounded-lg bg-muted p-3 text-label">
            {comment.message}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-label text-muted-foreground">
          Sem comentário ao aluno (o arquivo não foi lido como exame).
        </p>
      )}
    </section>
  );
}
