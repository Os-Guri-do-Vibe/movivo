/**
 * Instrumentação do cliente — PostHog (US-0.5 / TASK-0.5.4).
 *
 * O Next.js 15.3+ executa este arquivo no browser antes da hidratação da aplicação.
 * É o ponto de entrada mais barato para analytics: não adiciona provider algum à
 * árvore React, então **nenhum** Server Component precisa virar client component só
 * para instrumentar — a home continua 100% RSC.
 *
 * Escopo desta sprint: STUB. Aqui só se inicializa o SDK e se capturam pageviews
 * automáticas. Os eventos de funil (`form_block_completed`, `protocol_sent`,
 * conversão de trial…) são das sprints de produto — Lucas §8 e Sofia §16.2 definem a
 * taxonomia; instrumentar antes de existir tela seria inventar contrato.
 *
 * Degradação graciosa: sem `NEXT_PUBLIC_POSTHOG_KEY` válida (ou com o placeholder do
 * `.env.example`), a função retorna sem inicializar nada. Analytics ausente nunca
 * pode derrubar a aplicação.
 *
 * LGPD (Alexandre/Sato): nenhum identificador direto é enviado. `person_profiles:
 * 'identified_only'` impede a criação de perfil para visitante anônimo, e o telefone
 * do titular — o identificador central do produto — jamais entra em propriedade de
 * evento. A decisão sobre consentimento de cookies/replay é da Sprint 1, com a
 * landing real.
 */
import { publicEnv } from '@/lib/env';

const key = publicEnv.posthog.key;

if (key === undefined) {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      '[analytics] NEXT_PUBLIC_POSTHOG_KEY ausente ou placeholder — PostHog desativado.',
    );
  }
} else {
  /*
   * `import()` dinâmico, não estático: o SDK do PostHog pesa dezenas de kB e não pode
   * entrar no caminho crítico de renderização. Assim ele só é baixado quando existe
   * uma key válida — e, quando não existe, o custo da analytics para o usuário é
   * literalmente zero byte.
   */
  void import('posthog-js').then(({ default: posthog }) => {
    posthog.init(key, {
      api_host: publicEnv.posthog.host,
      defaults: '2026-06-25',
      person_profiles: 'identified_only',
      /* `history_change`: o App Router navega no cliente, sem recarregar documento. */
      capture_pageview: 'history_change',
      capture_pageleave: 'if_capture_pageview',
      /* Session replay entra junto do fluxo de consentimento (Sprint 1) — não antes. */
      disable_session_recording: true,
      autocapture: false,
      /* O SDK nunca deve derrubar a página; erro de rede é ruído de analytics, não falha. */
      on_request_error: () => undefined,
    });
  });
}
