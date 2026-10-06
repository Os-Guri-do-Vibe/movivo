import { loginSchema } from '@movivo/shared';
import { type NextRequest, NextResponse } from 'next/server';

import {
  assertTrustedMutation,
  BffError,
  DASHBOARD_PRIVATE_HEADERS,
  errorResponse,
  loginBackend,
} from '../../_lib/bff';

export async function POST(request: NextRequest) {
  try {
    assertTrustedMutation(request);
    const parsed = loginSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new BffError(400, 'Revise o e-mail e a senha informados.');
    const outcome = await loginBackend(parsed.data);
    // Senha certa com 2º fator pendente: nenhuma sessão — só o desafio para o passo seguinte.
    if (outcome.kind === 'mfa') {
      return NextResponse.json(
        { mfa: { step: outcome.step, challengeToken: outcome.challengeToken } },
        { headers: DASHBOARD_PRIVATE_HEADERS },
      );
    }
    return NextResponse.json({ user: outcome.session }, { headers: DASHBOARD_PRIVATE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}
