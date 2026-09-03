import { describe, expect, it } from 'vitest';

import { toDashboardAvatarUrl } from './avatar-url';

describe('toDashboardAvatarUrl', () => {
  it('reescreve a URL absoluta da API para a rota same-origin do app', () => {
    expect(
      toDashboardAvatarUrl(
        'http://localhost:3001/api/v1/account/avatar/11111111-1111-4111-8111-111111111111.jpg',
      ),
    ).toBe('/api/dashboard/account/avatar/11111111-1111-4111-8111-111111111111.jpg');
  });

  it('aceita png e webp', () => {
    const uuid = '11111111-1111-4111-8111-111111111111';
    expect(
      toDashboardAvatarUrl(`https://api.movivo.app/account/avatar/${uuid}.png`)?.endsWith('.png'),
    ).toBe(true);
    expect(
      toDashboardAvatarUrl(`https://api.movivo.app/account/avatar/${uuid}.webp`)?.endsWith('.webp'),
    ).toBe(true);
  });

  it('devolve null para entrada nula', () => {
    expect(toDashboardAvatarUrl(null)).toBeNull();
  });

  it('devolve null para nome de arquivo fora do formato UUID esperado', () => {
    expect(toDashboardAvatarUrl('http://api.test/account/avatar/nao-e-um-uuid.jpg')).toBeNull();
    expect(toDashboardAvatarUrl('http://api.test/account/avatar/../../etc/passwd')).toBeNull();
    expect(toDashboardAvatarUrl('http://api.test/account/avatar/abc.exe')).toBeNull();
  });
});
