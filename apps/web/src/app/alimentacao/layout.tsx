import { connection } from 'next/server';
import type { ReactNode } from 'react';

export default async function FoodLayout({ children }: { children: ReactNode }) {
  // Recebe CSP com nonce pelo proxy: precisa renderizar por requisição.
  await connection();
  return children;
}
