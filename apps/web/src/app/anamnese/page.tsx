import type { Metadata } from 'next';

/**
 * Rota `/anamnese` — **placeholder da Sprint 6**.
 *
 * A anamnese v1 (wizard de 3 blocos, `PATCH .../block/{n}`, cliente `anamnesis-api.ts`)
 * foi **removida** junto com os schemas que a sustentavam: a substituição é destrutiva
 * por decisão do fundador (D1 da `sprint/sprint-6-onboarding-em-etapas.md`), e deixar a
 * tela antiga viva depois de o contrato mudar seria um caminho alternativo até o gerador
 * sem passar pelos gates novos (18+, posse do número, consentimentos v2) — exatamente o
 * risco que a TASK-6.12.4 existe para eliminar.
 *
 * O wizard de 3 etapas é a US-6.10/US-6.11 (Felipe), sobre os contratos já publicados
 * pelo backend: `GET /anamnesis/session/{token}`, `PATCH .../step/{n}`,
 * `POST .../phone/send-code`, `POST .../phone/verify` e `POST .../submit`.
 */
export const metadata: Metadata = {
  title: 'Sua anamnese · MOVIVO',
  robots: { index: false },
};

export default function AnamnesePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Estamos preparando esta etapa</h1>
      <p className="text-muted-foreground">
        O novo cadastro da MOVIVO está sendo finalizado. Volte em instantes.
      </p>
    </main>
  );
}
