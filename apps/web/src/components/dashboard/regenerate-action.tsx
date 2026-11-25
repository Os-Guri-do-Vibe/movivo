'use client';

/**
 * 🔄 Regerar o protocolo INTEIRO, do zero (decisão do fundador): só em publicação de treino ou
 * alimentar, ou numa geração que falhou. Nunca para ajuste nem troca — esses usam o lápis ou o
 * "Pedir ajuste". Sempre com confirmação. Compartilhado pela Fila e pela tela do caso.
 */
import { RefreshCw } from 'lucide-react';

import { regenerateProtocol, resolveException } from '@/lib/control-center-api';

import { ConfirmAction } from './confirm-action';
import { IconAction } from './icon-action';

export type RegenerateTarget = 'TRAINING' | 'NUTRITION' | 'FAILURE';

export function RegenerateProtocolAction({
  caseId,
  target,
  onDone,
  editHint = 'use o lápis',
}: {
  caseId: string;
  target: RegenerateTarget;
  onDone: () => Promise<void>;
  /** Como o profissional muda só uma parte nesta tela (fecha a descrição da confirmação). */
  editHint?: string;
}) {
  const failed = target === 'FAILURE';
  const what = target === 'NUTRITION' ? 'alimentar' : 'de treino';
  return (
    <ConfirmAction
      triggerLabel="Regerar protocolo"
      title={failed ? 'Regerar o protocolo deste aluno?' : `Regerar o protocolo ${what} do zero?`}
      description={
        failed
          ? 'Os agentes tentam gerar o protocolo de novo. O caso é encerrado e o novo protocolo entra na Fila do Profissional (revisão obrigatória só se o aluno tiver PAR-Q de risco; nos demais, opcional e liberado sozinho em 2 h).'
          : `O protocolo atual é descartado sem ir ao aluno e os agentes geram outro inteiro, do início. O novo entra na Fila do Profissional (revisão obrigatória só se o aluno tiver PAR-Q de risco; nos demais, opcional e liberado sozinho em 2 h). Para mudar só uma parte, ${editHint}.`
      }
      confirmLabel="Regerar do zero"
      onConfirm={async () => {
        if (failed) await resolveException(caseId, 'Regeração do protocolo solicitada.');
        else await regenerateProtocol(caseId);
        await onDone();
      }}
      renderTrigger={(open) => (
        <IconAction
          label="Regerar protocolo"
          hint={
            failed
              ? 'Encerra o caso e os agentes geram de novo.'
              : 'Descarta este protocolo e os agentes geram outro do zero.'
          }
          icon={RefreshCw}
          onClick={open}
        />
      )}
    />
  );
}
