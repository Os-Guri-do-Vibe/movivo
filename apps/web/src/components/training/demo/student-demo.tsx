'use client';

import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { AccessScreen } from '../access-screen';
import { StudentPathsProvider } from '../student-nav';
import { TrainingApiProvider } from '../training-api-context';
import { TrainingDayView } from '../training-day-view';
import { createDemoApi, localToday, type DemoBody } from './demo-api';
import { DEMO_SCENARIOS, type DemoScenario } from './demo-scenarios';
import { createDemoStudentData } from './demo-student-data';

const DEMO_PATHS = {
  '/hoje': '/hoje/demo',
  '/alimentacao': '/hoje/demo/alimentacao',
  '/evolucao': '/hoje/demo/evolucao',
} as const;

interface DemoState {
  scenario: DemoScenario;
  /** Chave que recria o diário (cenário, silhueta e "recomeçar"). */
  run: string;
  entered: boolean;
  enter: () => void;
}

const DemoContext = createContext<DemoState | null>(null);

const GROUPS = [...new Set(DEMO_SCENARIOS.map((s) => s.group))];
function scenarioAt(index: number): DemoScenario {
  const scenario = DEMO_SCENARIOS[index] ?? DEMO_SCENARIOS[0];
  if (!scenario) throw new Error('Demonstração sem cenários.');
  return scenario;
}

/** Silhueta do modelo Músculos: rótulo curto no botão, descrição completa para leitor de tela. */
const BODIES: ReadonlyArray<{ value: DemoBody; label: string; description: string }> = [
  { value: 'MALE', label: 'Homem', description: 'Silhueta masculina no cartão' },
  { value: 'FEMALE', label: 'Mulher', description: 'Silhueta feminina no cartão' },
  { value: null, label: 'Nenhum', description: 'Sem sexo no cadastro (sem modelo Músculos)' },
];

const ICON_BUTTON =
  'grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-background text-petroleo hover:bg-muted';

/**
 * Casca da demonstração local (layout de `/hoje/demo`): a barra de cenários e a API em memória
 * por baixo das três abas do aluno. Trocar de cenário (ou "recomeçar") volta tudo ao início.
 */
export function StudentDemo({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [body, setBody] = useState<DemoBody>('MALE');
  const [round, setRound] = useState(0);
  const [entered, setEntered] = useState(false);
  const scenario = scenarioAt(index);
  // Alimentação e evolução continuam as mesmas ao trocar de cenário de treino.
  const [studentData] = useState(() => createDemoStudentData(localToday()));
  const api = useMemo(
    () => ({ ...studentData, ...createDemoApi(scenario, { body }) }),
    // `round` recria a API (e o diário) ao recomeçar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [studentData, scenario, body, round],
  );

  // Cenário vindo do link (`?cenario=...`), lido uma vez ao abrir.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('cenario');
    const at = DEMO_SCENARIOS.findIndex((s) => s.id === wanted);
    if (at > 0) setIndex(at);
  }, []);

  function go(next: number) {
    const target = (next + DEMO_SCENARIOS.length) % DEMO_SCENARIOS.length;
    setIndex(target);
    setEntered(false);
    router.replace(`/hoje/demo?cenario=${scenarioAt(target).id}`);
  }

  const state: DemoState = {
    scenario,
    run: `${scenario.id}-${body}-${round}`,
    entered,
    enter: () => setEntered(true),
  };

  return (
    <>
      {/* Ferramenta de demonstração, não o app: barra clara e fina, separada do cabeçalho da marca. */}
      <section
        aria-label="Cenários da demonstração"
        className="protocolo-light border-b border-dashed border-verde-pulso bg-card px-4 py-2 text-foreground"
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Cenário anterior"
              onClick={() => go(index - 1)}
              className={ICON_BUTTON}
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <label className="sr-only" htmlFor="demo-scenario">
              Cenário
            </label>
            <select
              id="demo-scenario"
              value={scenario.id}
              onChange={(event) => go(DEMO_SCENARIOS.findIndex((s) => s.id === event.target.value))}
              className="h-10 min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-2 text-label font-bold text-petroleo"
            >
              {GROUPS.map((group) => (
                <optgroup key={group} label={group}>
                  {DEMO_SCENARIOS.filter((s) => s.group === group).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.group} · {s.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              type="button"
              aria-label="Próximo cenário"
              onClick={() => go(index + 1)}
              className={ICON_BUTTON}
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 rounded-md bg-petroleo px-2 py-1 text-[11px] leading-none font-bold tracking-wider text-verde-pulso uppercase">
              Demo {index + 1}/{DEMO_SCENARIOS.length}
            </span>
            <div
              role="radiogroup"
              aria-label="Silhueta do cartão"
              className="grid min-w-0 flex-1 grid-cols-3 rounded-lg border border-border bg-background p-0.5"
            >
              {BODIES.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  role="radio"
                  aria-checked={body === option.value}
                  aria-label={option.description}
                  title={option.description}
                  onClick={() => setBody(option.value)}
                  className={`h-8 truncate rounded-md px-1 text-[12px] font-bold ${body === option.value ? 'bg-petroleo text-white' : 'text-muted-foreground hover:text-petroleo'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-label="Recomeçar cenário"
              title="Recomeçar cenário"
              onClick={() => {
                setRound((value) => value + 1);
                setEntered(false);
              }}
              className={ICON_BUTTON}
            >
              <RotateCcw size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>
      <DemoContext.Provider value={state}>
        <StudentPathsProvider paths={DEMO_PATHS}>
          <TrainingApiProvider api={api}>{children}</TrainingApiProvider>
        </StudentPathsProvider>
      </DemoContext.Provider>
    </>
  );
}

/**
 * A aba Treino da demonstração. Nos cenários de fluxo completo começa pela etapa 1 (o acesso
 * pelo link, sem login nem senha); depois é o diário de verdade sobre a API em memória.
 */
export function DemoTraining() {
  const demo = useContext(DemoContext);
  const [busy, setBusy] = useState(false);
  if (!demo) return null;
  if (demo.scenario.access && !demo.entered) {
    return (
      <AccessScreen
        firstName="Rodrigo"
        busy={busy}
        error=""
        onOpen={() => {
          setBusy(true);
          window.setTimeout(() => {
            setBusy(false);
            demo.enter();
          }, 500);
        }}
      />
    );
  }
  return <TrainingDayView key={demo.run} />;
}
