import { LockKeyhole } from 'lucide-react';

import { requireDashboardCapability } from '../_lib/session';

export default async function AdministrationPage() {
  await requireDashboardCapability(
    'control_center.admin.destructive.request',
    '/dashboard/administracao',
  );

  return (
    <div>
      <header>
        <h1 className="text-h1 font-bold">Administração</h1>
        <p className="mt-2 max-w-3xl text-body text-muted-foreground">
          Governança de acessos e solicitações administrativas críticas do Control Center.
        </p>
      </header>
      <section
        className="mt-6 rounded-xl border border-dashed border-border bg-card p-6"
        aria-labelledby="critical-actions"
      >
        <LockKeyhole aria-hidden="true" className="size-7" />
        <h2 id="critical-actions" className="mt-3 text-h2 font-bold">
          Ações críticas ainda não liberadas
        </h2>
        <p className="mt-2 max-w-3xl text-label text-muted-foreground">
          Envio, edição de permissões e anonimização exigem confirmação reforçada, justificativa e
          auditoria no backend. Como o fluxo de autenticação reforçada ainda está indisponível,
          nenhuma ação destrutiva é apresentada nesta versão.
        </p>
        <p className="mt-4 rounded-lg bg-secondary p-3 text-label font-semibold">
          Estado: indisponível até a implementação segura do step-up.
        </p>
      </section>
    </div>
  );
}
