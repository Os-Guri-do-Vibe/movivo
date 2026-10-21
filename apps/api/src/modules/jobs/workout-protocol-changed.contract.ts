/**
 * Contrato de fila: o protocolo do aluno ganhou uma versão nova. Vive em `jobs` (como
 * `whatsapp-outbound.contract`) para quem publica o protocolo não importar o domínio `workout`.
 */
export interface WorkoutProtocolChangedJob {
  userId: string;
  /** `SUBSTITUTION` = troca de exercício aprovada; `ADJUSTMENT` = emenda do profissional CREF. */
  reason: 'SUBSTITUTION' | 'ADJUSTMENT';
  /** Versão publicada: compõe o id do job, então republicar a mesma versão não duplica. */
  protocolVersion: number;
}
