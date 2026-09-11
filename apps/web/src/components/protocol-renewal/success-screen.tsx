/**
 * Tela final do formulário de renovação de mesociclo — copy neutra e única,
 * independente do conteúdo das respostas (mesmo racional do `SuccessScreen` do
 * onboarding: a UI nunca deriva ou expõe estado de triagem de segurança para o
 * usuário). O profissional CREF sempre revisa antes da liberação — presença visível
 * exigida pelos guardrails de linguagem do produto.
 */
export function RenewalSuccessScreen({ name }: { name: string }) {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-h1 font-bold">Recebemos suas respostas, {name}!</h1>
        <p className="mt-2 text-body text-muted-foreground">
          Seu novo protocolo será preparado com base no que você contou sobre este mesociclo — seu
          desempenho, sua rotina e como você está se sentindo.
        </p>
      </div>

      <div>
        <h2 className="text-h3 font-semibold">O que acontece agora?</h2>
        <ol className="mt-3 flex flex-col gap-2 text-body text-muted-foreground">
          <li className="flex gap-3">
            <span className="font-semibold text-foreground">1.</span>
            Seu próximo protocolo será preparado com apoio de inteligência artificial.
          </li>
          <li className="flex gap-3">
            <span className="font-semibold text-foreground">2.</span>
            Um profissional de Educação Física registrado no CREF revisa o protocolo antes de ele
            ser liberado.
          </li>
          <li className="flex gap-3">
            <span className="font-semibold text-foreground">3.</span>
            Você receberá o novo protocolo diretamente pelo WhatsApp.
          </li>
        </ol>
      </div>

      <p className="text-body text-muted-foreground">
        Se algo mudou na sua saúde ou rotina, tudo bem — é exatamente pra isso que esse formulário
        existe. Qualquer dúvida, fale com a gente pelo WhatsApp da MOVIVO.
      </p>
    </div>
  );
}
