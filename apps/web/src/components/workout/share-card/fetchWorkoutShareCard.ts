import type { WorkoutShareCardData } from '@movivo/shared';

const ATTEMPTS = 3;
const ATTEMPT_TIMEOUT_MS = 10_000;
const BACKOFF_MS = [400, 1_200] as const;

class ShareCardError extends Error {
  constructor(readonly retryable: boolean) {
    super('Não foi possível obter o card.');
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (window.clearTimeout(timer), resolve()), { once: true });
  });
}

async function attempt(url: string, signal: AbortSignal): Promise<Blob> {
  if (signal.aborted) throw new ShareCardError(false);
  const timeout = new AbortController();
  const timer = window.setTimeout(() => timeout.abort(), ATTEMPT_TIMEOUT_MS);
  const onAbort = () => timeout.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetch(url, { signal: timeout.signal, credentials: 'same-origin' });
    // 5xx/429 e quedas de rede passam; 401/404 não melhoram com nova tentativa.
    if (!response.ok) throw new ShareCardError(response.status >= 500 || response.status === 429);
    const blob = await response.blob();
    if (blob.type !== 'image/png' || blob.size === 0) throw new ShareCardError(true);
    return blob;
  } catch (error) {
    throw error instanceof ShareCardError ? error : new ShareCardError(true);
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

/** Subir quando o desenho do card mudar (layout, fonte, regra de músculos): invalida o cache dos aparelhos. */
const CARD_REVISION = '2';

/**
 * Chave de versão da URL. A resposta é cacheada por 24 h no navegador; sem isto, um card já
 * baixado continuava aparecendo mesmo depois de a API passar a desenhar outro (músculos
 * corrigidos). O conteúdo do card determina a URL: mudou o treino ou a regra, muda a URL.
 */
export function shareCardVersion(data: WorkoutShareCardData): string {
  const { muscleGroupsForHighlighter: groups, durationMinutes } = data.workout;
  return [
    CARD_REVISION,
    data.user.gender,
    [...groups].sort().join('.'),
    Math.round(durationMinutes),
  ].join('-');
}

/**
 * Baixa o PNG do card, desenhado e cacheado no servidor (a API o pré-aquece ao finalizar o
 * treino). O aparelho do aluno só recebe bytes: nada de renderizar DOM, buscar fontes ou
 * decodificar imagens aqui — era o que variava de celular para celular.
 */
export async function fetchWorkoutShareCard(
  sessionId: string,
  signal: AbortSignal,
  version = '',
): Promise<Blob> {
  const url = `/api/workout/sessions/${encodeURIComponent(sessionId)}/share-card${version ? `?v=${encodeURIComponent(version)}` : ''}`;
  for (let index = 0; ; index += 1) {
    try {
      return await attempt(url, signal);
    } catch (error) {
      const last = index === ATTEMPTS - 1;
      if (last || signal.aborted || !(error instanceof ShareCardError) || !error.retryable) {
        throw error;
      }
      await wait(BACKOFF_MS[index] ?? 1_200, signal);
    }
  }
}
