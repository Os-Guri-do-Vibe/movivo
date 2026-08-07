import type { AnonymizedReplay } from '@/lib/dashboard-types';

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'horário não informado'
    : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

export function ConversationReplay({ replay }: { replay: AnonymizedReplay }) {
  return (
    <section
      aria-labelledby="replay-title"
      className="rounded-xl border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="replay-title" className="text-h3 font-semibold">
          Conversa anonimizada
        </h2>
        <span className="font-mono text-xs text-muted-foreground">
          Início {formatDate(replay.startedAt)}
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Identificadores diretos foram removidos no backend antes da exibição.
      </p>
      {replay.messages.length === 0 ? (
        <p className="mt-4 text-label text-muted-foreground">
          Nenhuma mensagem disponível neste recorte.
        </p>
      ) : (
        <ol className="mt-4 space-y-3">
          {replay.messages.map((message, index) => (
            <li
              key={`${message.createdAt}-${index}`}
              className={`max-w-3xl rounded-lg p-3 ${message.role === 'USER' ? 'bg-secondary' : 'bg-accent'}`}
            >
              <div className="flex flex-wrap justify-between gap-2 font-mono text-xs text-muted-foreground">
                <span>
                  {message.role === 'USER'
                    ? 'Pessoa usuária'
                    : message.role === 'ASSISTANT'
                      ? 'MOVI'
                      : 'Equipe profissional'}
                </span>
                <time dateTime={message.createdAt}>{formatDate(message.createdAt)}</time>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-label leading-relaxed">
                {message.content}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
