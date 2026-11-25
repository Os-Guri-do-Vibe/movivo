/**
 * Textos do painel de agentes em português do dia a dia: quem usa o painel não é técnico, então
 * nível de modelo, fornecedor e resultado de teste aparecem com o que significam na prática.
 */
import { agentTaskLabel, type AgentsOverview, type ModelTierName } from '@movivo/shared';

import type { StatusTone } from './control-center-table';

type Task = AgentsOverview['tasks'][number];

export const TIER_INFO: Readonly<Record<ModelTierName, { name: string; description: string }>> = {
  FAST: {
    name: 'Respostas rápidas',
    description: 'Tarefas curtas, como entender a mensagem do aluno e detectar sinais de risco.',
  },
  STANDARD: {
    name: 'Uso geral',
    description: 'Conversa com o aluno, análise da semana e leitura do registro alimentar.',
  },
  REASONING: {
    name: 'Raciocínio avançado',
    description: 'Montagem dos protocolos: treino, alimentação e estratégia do objetivo.',
  },
  VISION: {
    name: 'Leitura de imagens',
    description: 'Prints de treino, fotos de refeição e exames enviados em foto ou PDF.',
  },
};

export const VENDOR_LABELS: Readonly<Record<string, string>> = {
  OPENAI: 'OpenAI',
  ANTHROPIC: 'Anthropic',
  DEEPSEEK: 'DeepSeek',
};

export function vendorLabel(vendor: string): string {
  return VENDOR_LABELS[vendor] ?? vendor;
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "Musculação: montar o bloco de treino" vira área "Musculação" e ação "Montar o bloco de treino". */
export function taskParts(taskId: string): { area: string | null; action: string } {
  const [area, ...rest] = agentTaskLabel(taskId).split(': ');
  const action = rest.join(': ');
  if (!action) return { area: null, action: area ?? '' };
  return { area: area ?? null, action: action.charAt(0).toUpperCase() + action.slice(1) };
}

export interface TestStatus {
  tone: StatusTone;
  label: string;
  detail: string;
  /** 0 pede atenção, 1 nunca foi testada, 2 está em dia: a lista mostra o que precisa de ação primeiro. */
  rank: 0 | 1 | 2;
}

export function testStatus(task: Task, formatDate: (iso: string) => string): TestStatus {
  const run = task.lastEval;
  if (!run) {
    return task.cases > 0
      ? {
          tone: 'quiet',
          label: 'Nunca testada',
          detail: 'Ainda não foi testada.',
          rank: 1,
        }
      : {
          tone: 'quiet',
          label: 'Sem testes',
          detail: 'Esta tarefa ainda não tem situações de teste cadastradas.',
          rank: 1,
        };
  }
  const date = formatDate(run.finishedAt);
  if (!run.current) {
    return {
      tone: 'attention',
      label: 'Testar de novo',
      detail: `A ficha ou a metodologia mudou depois do último teste, em ${date}.`,
      rank: 0,
    };
  }
  const result = `Acertou ${run.casesPassed} de ${plural(run.casesTotal, 'situação', 'situações')} · ${date}`;
  return run.passed
    ? { tone: 'positive', label: 'Aprovada', detail: result, rank: 2 }
    : { tone: 'attention', label: 'Reprovada', detail: result, rank: 0 };
}
