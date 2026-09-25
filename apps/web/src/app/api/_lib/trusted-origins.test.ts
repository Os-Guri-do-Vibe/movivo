/**
 * Origens aceitas nas mutações dos BFFs: a da URL que o Next vê e a pública do site. Em
 * produção elas diferem (o standalone monta a URL com o host interno do processo).
 */
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  publicEnv: { siteUrl: 'https://movivo.test', adminUrl: undefined as string | undefined },
}));
vi.mock('@/lib/env', () => env);

import { trustedOrigins } from './trusted-origins';

const internal = new NextRequest('https://localhost:3000/api/anamnesis/start');

describe('trustedOrigins', () => {
  it('aceita a origem pública do site e a da URL interna, e nada além', () => {
    const origins = trustedOrigins(internal);
    expect(origins.has('https://movivo.test')).toBe(true);
    expect(origins.has('https://localhost:3000')).toBe(true);
    expect(origins.has('https://evil.test')).toBe(false);
  });

  it('ignora NEXT_PUBLIC_SITE_URL malformada em vez de confiar nela', () => {
    env.publicEnv.siteUrl = 'não é url';
    expect([...trustedOrigins(internal)]).toEqual(['https://localhost:3000']);
    env.publicEnv.siteUrl = 'https://movivo.test';
  });

  it('aceita a origem da Plataforma Interna (NEXT_PUBLIC_ADMIN_URL) quando definida', () => {
    env.publicEnv.adminUrl = 'https://admin.movivo.test';
    expect(trustedOrigins(internal).has('https://admin.movivo.test')).toBe(true);
    env.publicEnv.adminUrl = undefined;
  });

  it('ignora NEXT_PUBLIC_ADMIN_URL malformada em vez de confiar nela', () => {
    env.publicEnv.adminUrl = 'não é url';
    expect([...trustedOrigins(internal)]).toEqual(['https://localhost:3000', 'https://movivo.test']);
    env.publicEnv.adminUrl = undefined;
  });
});
