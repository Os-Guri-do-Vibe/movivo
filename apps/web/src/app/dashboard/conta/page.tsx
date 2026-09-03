import { AccountSettings } from '@/components/dashboard/account-settings';

import { requireDashboardRole } from '../_lib/session';

export default async function ContaPage() {
  await requireDashboardRole('/dashboard/conta');

  return (
    <div>
      <h1 className="text-h2 font-bold text-foreground">Minha Conta</h1>
      <p className="mt-1 text-label text-muted-foreground">
        Atualize seus dados de acesso e segurança.
      </p>
      <div className="mt-6">
        <AccountSettings />
      </div>
    </div>
  );
}
