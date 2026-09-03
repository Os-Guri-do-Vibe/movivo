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
    <Button
      type="button"
      variant="ghost"
      onClick={logout}
      disabled={pending}
      className="rounded-full text-red-600 hover:bg-red-600/10 hover:text-red-600 dark:text-red-400 dark:hover:bg-red-400/10 dark:hover:text-red-400"
    >
      <LogOut aria-hidden="true" />
      {pending ? 'Saindo…' : 'Sair'}
    </Button>
  );
}
