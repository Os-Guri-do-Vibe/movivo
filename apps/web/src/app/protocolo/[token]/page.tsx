import type { Metadata } from 'next';
import { Fragment } from 'react';

import {
  ADVANCED_TECHNIQUE_LABELS,
  PRIMARY_GOAL_LABELS,
  protocolReadSchema,
  TRAINING_PHASE_LABELS,
  type AdvancedTechnique,
  type ProtocolExercise,
  type ProtocolRead,
  type ProtocolSession,
} from '@movivo/shared';

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
 *
 * Layout atual (2026-08-22) é um protótipo de design a ser convertido em PDF — por
 * isso os dados pessoais do aluno abaixo são MOCK: o endpoint público por token é
 * IDOR-safe de propósito (nunca leva PII, ver `protocol.controller.ts`), e adicionar
 * nome/idade/peso/altura/sexo ali é uma decisão de segurança à parte, ainda não tomada.
 */
export const metadata: Metadata = {
  title: 'Seu protocolo · MOVIVO',
  robots: { index: false },
};

const MOCK_STUDENT = {
  name: 'Cahuã Lima',
  age: '29 anos',
  weight: '78 kg',
  height: '1,78 m',
  sex: 'Masculino',
};

/**
 * Rótulos de dia da semana (mesmos do formulário de anamnese, `step2-anamnesis.tsx`).
 * Duplicado aqui em vez de importado: aquele módulo é `'use client'` e um export não-
 * componente dele quebra a coleta de dados desta página, que é Server Component.
 */
const WEEKDAY_LABELS: Record<string, string> = {
  MON: 'Segunda',
  TUE: 'Terça',
  WED: 'Quarta',
  THU: 'Quinta',
  FRI: 'Sexta',
  SAT: 'Sábado',
  SUN: 'Domingo',
};

const TECHNIQUE_GLOSSARY: Readonly<Record<AdvancedTechnique, string>> = {
  DROP_SET: 'Ao chegar perto da falha, reduz a carga e continua a série sem descansar.',
  REST_PAUSE: 'Pausa curta (10–20s) ao chegar perto da falha e continua a série com a mesma carga.',
  CLUSTER_SET: 'A série é dividida em blocos menores com pausas curtas entre eles.',
  BI_SET: 'Dois exercícios feitos em sequência, sem descanso entre eles.',
  TRI_SET: 'Três exercícios feitos em sequência, sem descanso entre eles.',
  SUPERSET: 'Dois exercícios de grupos musculares diferentes, feitos em sequência.',
  ISOMETRIA: 'Contração mantida numa posição fixa, sem movimento da articulação.',
  REPETICOES_CONTROLADAS: 'Execução com tempo controlado na descida e/ou na subida do movimento.',
  PIRAMIDE: 'A carga sobe (ou desce) a cada série, com as repetições variando na direção oposta.',
  DESCANSO_ATIVO: 'Movimento leve durante o intervalo, em vez de ficar parado.',
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

/** "8–12 reps" para exercício tradicional, "40s por série" para isométrico/cardio (achado 2026-08-18). */
function amountLabel(entry: { durationSeconds?: number; reps?: { min: number; max: number } }): string {
  if (entry.durationSeconds !== undefined) return `${entry.durationSeconds}s`;
  if (!entry.reps) return '';
  const { min, max } = entry.reps;
  return min === max ? `${min} reps` : `${min}–${max} reps`;
}

function sessionTitle(session: ProtocolSession): string {
  const day = session.weekday ? (WEEKDAY_LABELS[session.weekday] ?? session.weekday) : null;
  return day ? `${day} · ${session.dayLabel}` : session.dayLabel;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

function Shell({ children }: { children: React.ReactNode }) {
  // `protocolo-light`: página sempre clara, sem seguir o tema do site nem oferecer
  // troca (decisão do fundador, 2026-08-22) — é o protótipo do que vira PDF depois.
  // Fundo claro cobre a viewport inteira (não só a coluna), mesmo padrão de `/anamnese`.
  return (
    <div className="protocolo-light min-h-dvh w-full bg-background text-foreground">
      <header className="flex w-full justify-center bg-petroleo px-6 py-6 print:py-4">
        {/* Faixa de ponta a ponta: o SVG da marca tem o lettering em branco, feito para
            fundo escuro (Kimura) — a faixa é sempre petroleo, não varia com o tema. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- SVG estático de marca, sem otimização de imagem necessária. */}
        <img src="/brand/movivo-logo-horizontal.svg" alt="MOVIVO" className="h-12 w-auto" />
      </header>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-8 print:max-w-none print:gap-8 print:px-0">
        {children}
      </div>
    </div>
  );
}

function BrandSymbol({ className }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- SVG estático de marca, sem otimização de imagem necessária.
  return <img src="/brand/movivo-symbol.svg" alt="" aria-hidden="true" className={className} />;
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
  const techniquesUsed = Array.from(
    new Set(
      content.sessions.flatMap((session) =>
        session.exercises.map((exercise) => exercise.technique).filter((t) => t !== undefined),
      ),
    ),
  );

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
        <section aria-labelledby="titulo-aluno" className="flex flex-col gap-3">
          <h1 id="titulo-aluno" className="text-h2 font-semibold">
            Informações do aluno
          </h1>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-1.5">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-label font-bold text-foreground">Nome:</dt>
                <dd className="text-label text-foreground">{MOCK_STUDENT.name}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-label font-bold text-foreground">Idade:</dt>
                <dd className="text-label text-foreground">{MOCK_STUDENT.age}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-label font-bold text-foreground">Objetivo:</dt>
                <dd className="text-label text-foreground">
                  {PRIMARY_GOAL_LABELS[content.goal] ?? content.goal}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-label font-bold text-foreground">Mesociclo:</dt>
                <dd className="text-label text-foreground">
                  {TRAINING_PHASE_LABELS[content.phase] ?? content.phase}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-label font-bold text-foreground">Data início do protocolo:</dt>
                <dd className="font-mono text-label text-foreground">
                  {formatDate(protocol.startDate)}
                </dd>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-label font-bold text-foreground">Peso atual:</dt>
                <dd className="text-label text-foreground">{MOCK_STUDENT.weight}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-label font-bold text-foreground">Altura:</dt>
                <dd className="text-label text-foreground">{MOCK_STUDENT.height}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-label font-bold text-foreground">Sexo:</dt>
                <dd className="text-label text-foreground">{MOCK_STUDENT.sex}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-label font-bold text-foreground">Frequência:</dt>
                <dd className="text-label text-foreground">
                  {content.weeklyFrequency}x por semana
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-label font-bold text-foreground">Data final do protocolo:</dt>
                <dd className="font-mono text-label text-foreground">
                  {formatDate(protocol.endDate)}
                </dd>
              </div>
            </div>
          </dl>
        </section>

        <section aria-labelledby="titulo-explicacao" className="flex flex-col gap-3">
          <h2 id="titulo-explicacao" className="text-h2 font-semibold">
            Sobre o seu protocolo
          </h2>
          {/* Coral (calor humano/alerta gentil, Kimura §3): preenchimento tênue + borda,
              nunca cor de texto pequeno sobre claro — o texto continua em --foreground. */}
          <div className="rounded-lg border border-coral/40 bg-coral/10 p-5">
            <p className="text-body text-foreground">
              {content.generalNotes ??
                `Seu protocolo está na fase de ${TRAINING_PHASE_LABELS[content.phase] ?? content.phase}, estruturado para o seu objetivo de ${PRIMARY_GOAL_LABELS[content.goal] ?? content.goal}, com ${content.weeklyFrequency}x de treino por semana ao longo de ${protocol.totalWeeks} semanas. Ele foi planejado com apoio de inteligência artificial e revisado por um profissional de Educação Física registrado no CREF, que acompanha sua evolução.`}{' '}
              Se sentir dor aguda, tontura ou mal-estar, pare o exercício imediatamente e avise seu
              profissional responsável antes de continuar.
            </p>
          </div>
        </section>

        <section aria-labelledby="titulo-treinos" className="flex flex-col gap-6">
          <h2 id="titulo-treinos" className="text-h2 font-semibold">
            Seus treinos
          </h2>
          {/* A tabela tem 7 colunas e não cabe em telas estreitas; abaixo de ~700px o
              scroll horizontal não tem indicador visível em todo navegador/SO (ex.: macOS
              esconde a barra até o toque), então avisamos por texto nesse recorte. */}
          <p className="hidden text-label text-muted-foreground max-[700px]:block">
            Arraste a tabela para o lado para ver todas as colunas.
          </p>
          {content.sessions.map((session: ProtocolSession, i) => (
            <div key={i} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h3 className="text-h3 font-semibold text-card-foreground">
                  {sessionTitle(session)}
                </h3>
                <p className="text-label text-muted-foreground">{session.focus}</p>
              </div>
              <div className="sidebar-scrollbar overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[640px] border-collapse text-label">
                  <thead>
                    {/* Barra sempre escura (petroleo) com texto branco fixo: dá destaque ao
                        cabeçalho independente do tema, mesmo tratamento do chip da logo. */}
                    <tr className="border-b border-white/15 bg-petroleo text-left">
                      <th className="px-3 py-2 font-bold text-white">Exercício</th>
                      <th className="px-3 py-2 font-bold text-white">Série</th>
                      <th className="px-3 py-2 font-bold text-white">Repetição/Duração</th>
                      <th className="px-3 py-2 font-bold text-white">Descanso</th>
                      <th className="px-3 py-2 font-bold text-white">RIR</th>
                      <th className="px-3 py-2 font-bold text-white">Estratégia</th>
                      <th className="px-3 py-2 font-bold text-white">Vídeo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {session.exercises.map((exercise: ProtocolExercise, j) => (
                      <Fragment key={j}>
                        {/* Blocos de aquecimento (opcionais, item 8): uma linha por bloco,
                            antes da série válida, com o nome do exercício mudo. */}
                        {(exercise.warmupBlocks ?? []).map((block, k) => (
                          <tr
                            key={`warmup-${k}`}
                            className="border-b border-border/60 text-muted-foreground italic last:border-0"
                          >
                            <td className="px-3 py-1.5">
                              {k === 0 ? `${exercise.name} (aquecimento)` : ''}
                            </td>
                            <td className="px-3 py-1.5 font-mono">{block.sets}</td>
                            <td className="px-3 py-1.5 font-mono">{amountLabel(block)}</td>
                            <td className="px-3 py-1.5 font-mono">
                              {block.restSeconds !== undefined ? `${block.restSeconds}s` : '-'}
                            </td>
                            <td className="px-3 py-1.5 font-mono">-</td>
                            <td className="px-3 py-1.5">-</td>
                            <td className="px-3 py-1.5">-</td>
                          </tr>
                        ))}
                        <tr className="border-b border-border last:border-0 even:bg-muted/40">
                          <td className="px-3 py-2 font-medium text-card-foreground">
                            {exercise.name}
                          </td>
                          <td className="px-3 py-2 font-mono text-card-foreground">
                            {exercise.sets}
                          </td>
                          <td className="px-3 py-2 font-mono text-card-foreground">
                            {amountLabel(exercise)}
                          </td>
                          <td className="px-3 py-2 font-mono text-card-foreground">
                            {exercise.restSeconds}s
                          </td>
                          <td className="px-3 py-2 font-mono text-card-foreground">
                            {exercise.rir ?? '-'}
                          </td>
                          <td className="px-3 py-2 text-card-foreground">
                            {exercise.technique ? ADVANCED_TECHNIQUE_LABELS[exercise.technique] : '-'}
                          </td>
                          <td className="px-3 py-2">
                            {exercise.videoUrl ? (
                              <a
                                href={exercise.videoUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="font-medium text-primary underline underline-offset-2"
                              >
                                Assistir
                              </a>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                        </tr>
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              {session.exercises.some((exercise) => exercise.notes) ? (
                <ul className="flex flex-col gap-1 text-label text-muted-foreground">
                  {session.exercises
                    .filter((exercise) => exercise.notes)
                    .map((exercise, k) => (
                      <li key={k}>
                        <span className="font-medium text-card-foreground">{exercise.name}:</span>{' '}
                        {exercise.notes}
                      </li>
                    ))}
                </ul>
              ) : null}
            </div>
          ))}
        </section>

        <section aria-labelledby="titulo-legenda" className="flex flex-col gap-3">
          <h2 id="titulo-legenda" className="text-h2 font-semibold">
            Legenda
          </h2>
          <dl className="flex flex-col gap-2 text-label text-muted-foreground">
            <div className="flex gap-2">
              <dt className="shrink-0 font-medium text-card-foreground">RIR (Repetições em Reserva):</dt>
              <dd>
                quantas repetições você ainda conseguiria fazer ao terminar a série, sendo RIR 0 até
                a falha.
              </dd>
            </div>
            {techniquesUsed.map((technique) => (
              <div key={technique} className="flex gap-2">
                <dt className="shrink-0 font-medium text-card-foreground">
                  {ADVANCED_TECHNIQUE_LABELS[technique]}:
                </dt>
                <dd>{TECHNIQUE_GLOSSARY[technique]}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>

      <footer className="flex flex-col items-center gap-2 border-t border-border pt-6 text-center">
        <BrandSymbol className="h-7 w-auto" />
        <p className="max-w-prose font-mono text-label text-muted-foreground">
          Metodologia revisada e assinada por um profissional de Educação Física registrado no CREF
        </p>
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
