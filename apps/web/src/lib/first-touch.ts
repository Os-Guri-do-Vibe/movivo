/**
 * Atribuição de primeiro toque no cliente (US-8.2, TASK-8.2.2).
 *
 * O papel deste módulo é **carregar** a origem da landing até o `POST /anamnesis/start`,
 * não decidir nada: quem sanea, canoniza e garante a escrita única é o servidor.
 *
 * `sessionStorage` guarda o primeiro toque da aba porque o CTA da landing navega para
 * `/anamnese` e a query string se perde na navegação. Grava uma única vez — se o
 * visitante voltar por outro link dentro da mesma sessão do navegador, a origem
 * original permanece (mesma regra de primeiro toque aplicada no banco).
 */
const KEY = 'movivo.first_touch';

export interface FirstTouch {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  referrer?: string;
}

/** Teto de leitura: nada além disso é enviado ao servidor (Sato — entrada não confiável). */
const MAX_READ = 512;

function read(params: URLSearchParams, name: string): string | undefined {
  const value = params.get(name);
  return value ? value.slice(0, MAX_READ) : undefined;
}

/**
 * Chame na entrada de qualquer página do funil. Persiste o primeiro toque da aba.
 * No-op no servidor e quando já existe registro.
 */
export function captureFirstTouch(): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.sessionStorage.getItem(KEY)) return;
    const params = new URLSearchParams(window.location.search);
    const touch: FirstTouch = {
      utmSource: read(params, 'utm_source'),
      utmMedium: read(params, 'utm_medium'),
      utmCampaign: read(params, 'utm_campaign'),
      utmContent: read(params, 'utm_content'),
      // Só referência EXTERNA interessa; navegação interna não é origem.
      referrer:
        document.referrer && !document.referrer.startsWith(window.location.origin)
          ? document.referrer.slice(0, MAX_READ)
          : undefined,
    };
    window.sessionStorage.setItem(KEY, JSON.stringify(touch));
  } catch {
    // sessionStorage indisponível (modo restrito): a origem vira `desconhecida` no
    // servidor. Atribuição nunca pode impedir alguém de começar o cadastro.
  }
}

/** Lê o primeiro toque da aba. `undefined` quando não há nada capturado. */
export function getFirstTouch(): FirstTouch | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as FirstTouch) : undefined;
  } catch {
    return undefined;
  }
}
