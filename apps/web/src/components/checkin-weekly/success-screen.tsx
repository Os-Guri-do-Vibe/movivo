/**
 * Tela final do check-in semanal — copy neutra e única, independente do conteúdo das
 * respostas (mesmo racional do `RenewalSuccessScreen`: a UI nunca deriva ou expõe estado
 * de triagem de segurança para o usuário).
 */
export function WeeklyCheckinSuccessScreen({ name }: { name: string }) {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-h1 font-bold">Recebemos suas respostas, {name}!</h1>
        <p className="mt-2 text-body text-muted-foreground">
          Seu profissional CREF e o AI Coach da MOVIVO já estão de olho no que você contou sobre
          esta última semana.
        </p>
      </div>

      <div>
        <h2 className="text-h3 font-semibold">O que acontece agora?</h2>
        <ol className="mt-3 flex flex-col gap-2 text-body text-muted-foreground">
          <li className="flex gap-3">
            <span className="font-semibold text-foreground">1.</span>O AI Coach analisa suas
            respostas e te manda um comentário pelo WhatsApp.
          </li>
          <li className="flex gap-3">
            <span className="font-semibold text-foreground">2.</span>
            Se você relatou dificuldade com algum exercício, o AI Coach pode sugerir alternativas na
            conversa.
          </li>
          <li className="flex gap-3">
            <span className="font-semibold text-foreground">3.</span>
            Um profissional de Educação Física registrado no CREF acompanha suas respostas.
          </li>
        </ol>
      </div>

      <p className="text-body text-muted-foreground">
        Qualquer dúvida, fale com a gente pelo WhatsApp da MOVIVO.
      </p>
    </div>
  );
}
