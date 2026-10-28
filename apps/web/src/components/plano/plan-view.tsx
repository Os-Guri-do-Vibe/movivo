import {
  EXTERNAL_SPORT_LABELS,
  HYROX_STATION_LABELS,
  MEAL_SLOT_LABELS,
  RUNNING_SESSION_KIND_LABELS,
  SESSION_MODALITY_LABELS,
  SESSION_PRIORITY_LABELS,
  type DailyTargets,
  type PlanRead,
  type PlanSession,
} from '@movivo/shared';

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const;

const SLOT_LABELS = {
  MORNING: 'de manhã',
  AFTERNOON: 'à tarde',
  EVENING: 'à noite',
  ANY: '',
} as const;

const ENERGY_LABELS: Record<string, string> = {
  DEFICIT: 'Déficit moderado de energia',
  MAINTENANCE: 'Manutenção de energia',
  SURPLUS: 'Superávit moderado de energia',
  RECOMPOSITION: 'Recomposição corporal',
  PERFORMANCE_FUELING: 'Energia para o desempenho',
};

/** "terça, 04/11 · à noite". A data chega como calendário (sem fuso), então o parse é em UTC. */
export function dayLabel(date: string, slot: keyof typeof SLOT_LABELS): string {
  const d = new Date(`${date}T00:00:00Z`);
  const weekday = WEEKDAYS[d.getUTCDay()] ?? '';
  const short = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const when = SLOT_LABELS[slot];
  return `${weekday}, ${short}${when ? ` · ${when}` : ''}`;
}

function sessionDetail(session: PlanSession): string[] {
  const { content } = session;
  if (content.modality === 'STRENGTH') {
    return content.exercises.map((e) => {
      const amount = e.durationSeconds
        ? `${e.durationSeconds} s`
        : e.reps
          ? `${e.reps.min}–${e.reps.max} reps`
          : '';
      return `${e.name} — ${e.sets} × ${amount}`.trim();
    });
  }
  if (content.modality === 'RUNNING') {
    return [RUNNING_SESSION_KIND_LABELS[content.kind]].concat(
      content.segments.map((s) => {
        const volume = s.distanceMeters
          ? `${(s.distanceMeters / 1000).toLocaleString('pt-BR')} km`
          : `${Math.round((s.durationSeconds ?? 0) / 60)} min`;
        return `${s.repeat && s.repeat > 1 ? `${s.repeat} × ` : ''}${volume}`;
      }),
    );
  }
  if (content.modality === 'HYROX') {
    return content.blocks.map((b) =>
      b.type === 'RUN'
        ? `Corrida ${(b.distanceMeters / 1000).toLocaleString('pt-BR')} km`
        : b.type === 'STATION'
          ? `${HYROX_STATION_LABELS[b.station]}${b.distanceMeters ? ` — ${b.distanceMeters} m` : b.reps ? ` — ${b.reps} reps` : ''}${b.loadKg ? ` (${b.loadKg} kg)` : ''}`
          : `Descanso ${b.durationSeconds} s`,
    );
  }
  return [`${EXTERNAL_SPORT_LABELS[content.sport]} — ${content.plannedMinutes} min`];
}

function Targets({ title, targets }: { title: string; targets: DailyTargets }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h4 className="text-label font-semibold">{title}</h4>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-body">
        <dt className="text-muted-foreground">Energia</dt>
        <dd>
          {targets.energyKcal.min}–{targets.energyKcal.max} kcal
        </dd>
        <dt className="text-muted-foreground">Proteína</dt>
        <dd>{targets.proteinG} g</dd>
        <dt className="text-muted-foreground">Carboidrato</dt>
        <dd>{targets.carbsG} g</dd>
        <dt className="text-muted-foreground">Gordura</dt>
        <dd>{targets.fatG} g</dd>
        <dt className="text-muted-foreground">Fibras</dt>
        <dd>{targets.fiberG} g</dd>
        <dt className="text-muted-foreground">Água</dt>
        <dd>{(targets.waterMl / 1000).toLocaleString('pt-BR')} L</dd>
      </dl>
    </div>
  );
}

export function PlanView({ plan }: { plan: PlanRead }) {
  const { strategy, training, nutrition } = plan;
  return (
    <main id="conteudo" className="flex flex-1 flex-col gap-10">
      <section aria-labelledby="titulo-plano" className="flex flex-col gap-3">
        <h1 id="titulo-plano" className="text-h2 font-semibold">
          {plan.firstName ? `${plan.firstName}, este é o seu plano` : 'Este é o seu plano'}
        </h1>
        <p className="text-body text-muted-foreground">
          Montado a partir do que você contou, com a metodologia dos profissionais de Educação
          Física e Nutrição da MOVIVO. Ele muda com você: se algo não combinar com a sua rotina,
          responda no WhatsApp.
        </p>
      </section>

      {strategy && (
        <section aria-labelledby="titulo-estrategia" className="flex flex-col gap-3">
          <h2 id="titulo-estrategia" className="text-h3 font-semibold">
            {strategy.title}
          </h2>
          {strategy.studentMessage && <p className="text-body">{strategy.studentMessage}</p>}
          <ul className="list-disc pl-5 text-body text-muted-foreground">
            {strategy.rationale.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <p className="text-label text-muted-foreground">
            Vamos revisar a estratégia em {strategy.reviewAfterWeeks} semanas.
          </p>
        </section>
      )}

      {(plan.milestones.length > 0 || plan.tasks.length > 0) && (
        <section aria-labelledby="titulo-metas" className="flex flex-col gap-3">
          <h2 id="titulo-metas" className="text-h3 font-semibold">
            Suas metas
          </h2>
          <ul className="flex flex-col gap-2">
            {plan.tasks.map((task) => (
              <li key={task.title} className="rounded-xl border border-border bg-card p-3">
                <span className="font-medium">{task.title}</span>
                <span className="ml-2 text-label text-muted-foreground">
                  {task.progress}/{task.target}
                </span>
              </li>
            ))}
            {plan.milestones.map((m) => (
              <li key={m.milestone.description} className="rounded-xl border border-border p-3">
                {m.milestone.description}
                <span className="ml-2 text-label text-muted-foreground">
                  até{' '}
                  {new Date(`${m.dueOn}T00:00:00Z`).toLocaleDateString('pt-BR', {
                    timeZone: 'UTC',
                  })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {training && (
        <section aria-labelledby="titulo-treino" className="flex flex-col gap-4">
          <h2 id="titulo-treino" className="text-h3 font-semibold">
            Seu treino
          </h2>
          <p className="text-body">{training.structure.summary}</p>

          {training.upcoming.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-label font-semibold">Próximos treinos</h3>
              <ul className="flex flex-col gap-2">
                {training.upcoming.map((s) => (
                  <li
                    key={`${s.date}-${s.planSessionKey}`}
                    className="flex items-baseline justify-between gap-3 rounded-xl border border-border bg-card p-3"
                  >
                    <span>
                      <span className="font-medium">{s.title}</span>
                      <span className="ml-2 text-label text-muted-foreground">
                        {SESSION_MODALITY_LABELS[s.modality]} · {s.minutes} min
                      </span>
                    </span>
                    <span className="text-label text-muted-foreground">
                      {dayLabel(s.date, s.slot)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-col gap-3">
            {training.structure.sessions.map((session) => (
              <article key={session.key} className="rounded-xl border border-border p-4">
                <header className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold">{session.title}</h3>
                  <span className="text-label text-muted-foreground">
                    {SESSION_MODALITY_LABELS[session.content.modality]} ·{' '}
                    {SESSION_PRIORITY_LABELS[session.priority]} · {session.weeklyFrequency}×/semana
                    · {session.estimatedMinutes} min
                  </span>
                </header>
                <p className="mt-1 text-body text-muted-foreground">{session.purpose}</p>
                <ul className="mt-2 list-disc pl-5 text-body">
                  {sessionDetail(session).map((line, index) => (
                    <li key={`${line}-${index}`}>{line}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      )}

      {nutrition && (
        <section aria-labelledby="titulo-nutricao" className="flex flex-col gap-4">
          <h2 id="titulo-nutricao" className="text-h3 font-semibold">
            Sua alimentação
          </h2>
          <p className="text-label text-muted-foreground">
            {ENERGY_LABELS[nutrition.structure.strategy] ?? nutrition.structure.strategy}
          </p>
          <p className="text-body">{nutrition.structure.summary}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Targets title="Dia de treino" targets={nutrition.structure.trainingDay} />
            <Targets title="Dia de descanso" targets={nutrition.structure.restDay} />
          </div>
          <div className="flex flex-col gap-3">
            {nutrition.structure.meals.map((meal) => (
              <article key={meal.slot} className="rounded-xl border border-border p-4">
                <h3 className="font-semibold">
                  {MEAL_SLOT_LABELS[meal.slot]}{' '}
                  <span className="text-label font-normal text-muted-foreground">
                    ~{meal.proteinG} g de proteína
                  </span>
                </h3>
                <p className="text-body text-muted-foreground">{meal.guidance}</p>
                <ul className="mt-1 list-disc pl-5 text-body">
                  {meal.examples.map((example) => (
                    <li key={example}>{example}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <ul className="list-disc pl-5 text-body">
            {nutrition.structure.guidelines.map((guideline) => (
              <li key={guideline}>{guideline}</li>
            ))}
          </ul>
          {nutrition.structure.supplements.length > 0 && (
            <ul className="list-disc pl-5 text-body">
              {nutrition.structure.supplements.map((s) => (
                <li key={s.name}>
                  <strong>{s.name}:</strong> {s.guidance}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <footer className="border-t border-border pt-4 text-label text-muted-foreground">
        As orientações não substituem acompanhamento presencial nem orientação médica. Em caso de
        dor, tontura ou qualquer sintoma fora do esperado, pare e fale com a gente.
      </footer>
    </main>
  );
}
