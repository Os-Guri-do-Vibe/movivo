import { connection } from 'next/server';
import type { ReactNode } from 'react';

export default async function TrainingLayout({ children }: { children: ReactNode }) {
  // /hoje e /hoje/acessar recebem CSP com nonce pelo proxy. Sem renderização por request, o
  // build estático emite scripts sem nonce e a página não hidrata.
  await connection();
  return children;
}
