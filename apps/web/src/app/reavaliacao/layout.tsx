import { connection } from 'next/server';
import type { ReactNode } from 'react';

export default async function StudentLayout({ children }: { children: ReactNode }) {
  // Recebe CSP com nonce pelo proxy: precisa renderizar por requisição.
  await connection();
  return children;
}
