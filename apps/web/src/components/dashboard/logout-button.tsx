'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    try {
      await fetch('/api/dashboard/session/logout', { method: 'POST', credentials: 'same-origin' });
    } catch {
      // A sessão backend expira/rotaciona; a UI ainda sai da superfície sensível.
    } finally {
      router.replace('/entrar');
      router.refresh();
    }
  }

  return (
    <Button type="button" variant="ghost" onClick={logout} disabled={pending}>
      <LogOut aria-hidden="true" />
      {pending ? 'Saindo…' : 'Sair'}
    </Button>
  );
}
