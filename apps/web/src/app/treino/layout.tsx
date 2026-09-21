import { connection } from 'next/server';
import type { ReactNode } from 'react';

export default async function WorkoutLayout({ children }: { children: ReactNode }) {
  // /treino e /treino/acessar recebem CSP com nonce pelo proxy. Sem renderização
  // por request, o build estático emite scripts sem nonce e o diário não hidrata.
  await connection();
  return children;
}
