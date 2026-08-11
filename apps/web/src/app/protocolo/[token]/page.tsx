import type { Metadata } from 'next';

import {
  protocolReadSchema,
  type LoadStrategy,
  type GenerationGoal,
  type ProtocolExercise,
  type ProtocolRead,
  type ProtocolSession,
  type TrainingPhase,
} from '@movivo/shared';

import { ThemeToggle } from '@/components/theme-toggle';
import { ProtocolViewed } from '@/components/protocolo/protocol-viewed';
import { publicEnv } from '@/lib/env';

/**
 * Página read-only do protocolo (US-2.6) — RSC. Renderiza o `content` JSONB legível
 * (fases/semanas/treinos/exercícios) e o respaldo CREF, acessível por token opaco (o
 * UUID do protocolo, ADR-006). É o alvo do deep-link da entrega (US-2.5).
 *
 * Toda a copy respeita os guardrails (CLAUDE.md): sem diagnóstico/tratamento/cura/
 * garantia, a IA nunca aparece como quem decide sozinha, respaldo CREF sempre visível.
 * Token inválido/expirado → estado neutro, sem vazar dado (o backend já devolve 404).
 */
export const metadata: Metadata = {
  title: 'Seu protocolo · MOVIVO',
  robots: { index: false },
};

const PHASE_LABEL: Record<TrainingPhase, string> = {
  ADAPTACAO: 'Adaptação',
  HIPERTROFIA: 'Hipertrofia',
  FORCA: 'Força',
  DELOAD: 'Recuperação (deload)',
};

// Rótulos dos objetivos de GERAÇÃO (o "Outro" da anamnese nunca chega ao protocolo —
// é traduzido por `toGenerationGoal` antes de o gerador ver).
const GOAL_LABEL: Record<GenerationGoal, string> = {
  GAIN_MUSCLE: 'Ganhar massa muscular',
  GAIN_STRENGTH: 'Ganhar força',
  LOSE_FAT: 'Reduzir gordura corporal',
  CONDITIONING: 'Melhorar o condicionamento físico',
  HEALTH_ENERGY: 'Saúde e disposição',
  BUILD_ROUTINE: 'Criar uma rotina de treino',
  RETURN_TO_TRAINING: 'Voltar a treinar',
  SPORT_EVENT: 'Preparação para esporte ou evento',
};

const LOAD_LABEL: Record<LoadStrategy, string> = {
  BODYWEIGHT: 'Peso do corpo',
  FIXED_LOAD: 'Carga fixa',
  DOUBLE_PROGRESSION: 'Dupla progressão',
  RPE: 'Percepção de esforço (RPE)',
};

async function fetchProtocol(token: string): Promise<ProtocolRead | null> {
  let res: Response;
  try {
    res = await fetch(`${publicEnv.apiUrl}/protocols/by-token/${token}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const parsed = protocolReadSchema.safeParse(await res.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

function reps(exercise: ProtocolExercise): string {
  const { min, max } = exercise.reps;
  return min === max ? `${min}` : `${min}–${max}`;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-10 px-6 py-8">
      <header className="flex items-center justify-between gap-4">
        <p className="flex items-center gap-2 font-mono text-label tracking-wide text-muted-foreground">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-primary" />
          movivo
        </p>
        <ThemeToggle />
      </header>
      {children}
    </div>
  );
}

export default async function ProtocoloPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const protocol = await fetchProtocol(token);

  if (!protocol) {
    return (
      <Shell>
        <main id="conteudo" className="flex flex-1 flex-col justify-center gap-4">
          <p className="font-mono text-label text-muted-foreground">link indisponível</p>
          <h1 className="text-h1 font-bold">Não encontramos este protocolo</h1>
          <p className="max-w-prose text-body text-muted-foreground">
            O link pode ter expirado ou estar incorreto. Abra o link mais recente enviado no seu
            WhatsApp, ou fale com a gente por lá.
          </p>
        </main>
      </Shell>
    );
  }

  const { content } = protocol;

  return (
    <Shell>
      <ProtocolViewed />
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:text-label focus:ring-[3px] focus:ring-ring"
      >
        Pular para o conteúdo
      </a>

      <main id="conteudo" className="flex flex-1 flex-col gap-10">
        <section className="flex flex-col gap-4">
          <p className="font-mono text-label tracking-wide text-muted-foreground">seu protocolo</p>
          <h1 className="text-h1 font-bold">{GOAL_LABEL[content.goal] ?? content.goal}</h1>
          <dl className="flex flex-wrap gap-x-8 gap-y-3">
            <div>
              <dt className="text-label text-muted-foreground">Fase atual</dt>
              <dd className="text-body font-medium">
                {PHASE_LABEL[content.phase] ?? content.phase}
              </dd>
            </div>
            <div>
              <dt className="text-label text-muted-foreground">Frequência</dt>
              <dd className="text-body font-medium">{content.weeklyFrequency}x por semana</dd>
            </div>
            <div>
              <dt className="text-label text-muted-foreground">Duração</dt>
              <dd className="text-body font-medium">
                semana {protocol.currentWeek} de {protocol.totalWeeks}
              </dd>
            </div>
          </dl>
          {content.generalNotes ? (
            <p className="max-w-prose text-body text-muted-foreground">{content.generalNotes}</p>
          ) : null}
        </section>

        <section aria-labelledby="titulo-treinos" className="flex flex-col gap-4">
          <h2 id="titulo-treinos" className="text-h2 font-semibold">
            Seus treinos da semana
          </h2>
          <ol className="flex flex-col gap-4">
            {content.sessions.map((session: ProtocolSession, i) => (
              <li
                key={i}
                className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5"
              >
                <div className="flex flex-col gap-1">
                  <h3 className="text-h3 font-semibold text-card-foreground">{session.dayLabel}</h3>
                  <p className="text-label text-muted-foreground">{session.focus}</p>
                </div>
                <ul className="flex flex-col divide-y divide-border">
                  {session.exercises.map((exercise: ProtocolExercise, j) => (
                    <li key={j} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                      <p className="text-body font-medium text-card-foreground">{exercise.name}</p>
                      <p className="font-mono text-label text-muted-foreground">
                        {exercise.sets} séries · {reps(exercise)} reps · {exercise.restSeconds}s de
                        descanso · {LOAD_LABEL[exercise.loadStrategy] ?? exercise.loadStrategy}
                      </p>
                      {exercise.notes ? (
                        <p className="text-label text-muted-foreground">{exercise.notes}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="flex flex-col gap-3 border-t border-border pt-6">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="text-h3 leading-none">
            🛡
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-body font-medium">Respaldo profissional CREF</p>
            <p className="max-w-prose font-mono text-label text-muted-foreground">
              Metodologia revisada e assinada por um profissional de Educação Física registrado no
              CREF, que usa a IA como ferramenta de apoio.
            </p>
          </div>
        </div>
        {protocol.signatureHash ? (
          <p className="font-mono text-label text-muted-foreground">
            assinatura {protocol.signatureHash.slice(0, 12)}
            {protocol.signedAt ? (
              <>
                {' '}
                ·{' '}
                <time dateTime={protocol.signedAt}>
                  {new Date(protocol.signedAt).toLocaleDateString('pt-BR')}
                </time>
              </>
            ) : null}
          </p>
        ) : null}
      </footer>
    </Shell>
  );
}
