import type { OnboardingOutcome } from '@movivo/shared';

/**
 * Tela de sucesso (Sofia §9): duas configurações do MESMO componente. A variante vem
 * de `outcome`, sempre lido da resposta do servidor — nunca calculado no cliente nem
 * por query string (Sofia §9.2/9.3). Visualmente idênticas (mesmo Pulso, sem Coral,
 * sem ícone de alerta): no instante em que parecem diferentes, a V2 vira rejeição.
 */
const MOVIVO_CLUB_URL = 'https://chat.whatsapp.com/J3xNcNWE0UcH4qd9I2uMgR';

const CLUB_PERKS = [
  '🏋🏼‍♂️ Estar perto de pessoas que também buscam evolução',
  '🚀 Receber novidades e conteúdos em primeira mão',
  '🤝 Conhecer novas pessoas e criar novas amizades',
  '🎁 Participar de sorteios e ações exclusivas da movivo',
  '💬 Compartilhar experiências, conquistas e aprendizados',
  '✨ E muito mais!',
];

const READY_STEPS = [
  'Seu perfil será processado pela MOVIVO.',
  'Seu treino será preparado com base na nossa metodologia.',
  'Você receberá tudo diretamente pelo WhatsApp.',
  'A partir daí, seu personal MOVIVO acompanhará sua evolução e fará os ajustes necessários.',
];

const PENDING_STEPS = [
  'Seu perfil será analisado pelo profissional responsável.',
  'Caso seja necessário, entraremos em contato para confirmar alguma informação.',
  'Você receberá uma atualização pelo WhatsApp em até 1 dia útil.',
  'Após a liberação, seu treino será preparado normalmente.',
];

export function SuccessScreen({ outcome, name }: { outcome: OnboardingOutcome; name: string }) {
  const ready = outcome === 'READY';
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-h1 font-bold">
          {ready ? `Tudo pronto, ${name}!` : `Recebemos suas informações, ${name}!`}
        </h1>
        {ready ? (
          <p className="mt-2 text-body text-muted-foreground">
            Recebemos suas informações e já estamos preparando seu treino personalizado. Seu treino
            será criado considerando seus objetivos, experiência, rotina, equipamentos disponíveis e
            preferências.
          </p>
        ) : (
          <>
            <p className="mt-2 text-body text-muted-foreground">
              Para cuidar da sua segurança, algumas respostas precisam ser analisadas pelo
              profissional responsável da MOVIVO antes da preparação do seu treino.
            </p>
            <p className="mt-2 text-body text-muted-foreground">
              Isso não significa necessariamente que você não possa treinar. Nosso profissional
              apenas precisa verificar alguns pontos para que seu treino seja criado de maneira
              adequada.
            </p>
          </>
        )}
      </div>

      <div>
        <h2 className="text-h3 font-semibold">O que acontece agora?</h2>
        <ol className="mt-3 flex flex-col gap-2 text-body text-muted-foreground">
          {(ready ? READY_STEPS : PENDING_STEPS).map((step, i) => (
            <li key={step} className="flex gap-3">
              <span className="font-semibold text-foreground">{i + 1}.</span>
              {step}
            </li>
          ))}
        </ol>
      </div>

      <div>
        <p className="text-h3 font-semibold">
          Enquanto seu treino é preparado, aproveite para entrar na nossa comunidade.
        </p>
        <p className="mt-3 text-body text-muted-foreground">
          Por lá, você encontra um ambiente alinhado aos seus objetivos, onde pode:
        </p>
        <ul className="mt-3 flex flex-col gap-2 text-body text-muted-foreground">
          {CLUB_PERKS.map((perk) => (
            <li key={perk}>{perk}</li>
          ))}
        </ul>
      </div>

      <a
        href={MOVIVO_CLUB_URL}
        target="_blank"
        rel="noreferrer"
        className="flex h-[52px] items-center justify-center rounded-xl bg-primary px-6 text-body font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary/90"
      >
        ENTRAR NO MOVIVO CLUB
      </a>
    </div>
  );
}
