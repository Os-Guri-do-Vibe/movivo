import { methodologyDomainSpec } from '@movivo/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  DocumentStatusBadge,
  agentLabelOfTask,
  formatDate,
  formatValue,
  readableChanges,
} from './methodology-ui';

describe('formatValue', () => {
  it('escreve cada tipo de valor em linguagem de gente', () => {
    expect(formatValue(null)).toBe('vazio');
    expect(formatValue('')).toBe('vazio');
    expect(formatValue(true)).toBe('Sim');
    expect(formatValue(false)).toBe('Não');
    expect(formatValue(12)).toBe('12');
    expect(formatValue({ min: 10, max: 16 })).toBe('10 a 16');
    expect(formatValue(['a', 'b'])).toBe('a, b');
    expect(formatValue([])).toBe('nenhum');
    expect(formatValue({ outra: 1 })).toBe('{"outra":1}');
  });
});

describe('readableChanges', () => {
  it('abre a tabela célula a célula com os nomes da tela', () => {
    const spec = methodologyDomainSpec('STRENGTH');
    const [change] = readableChanges(spec, [
      {
        path: 'volume.weeklySets',
        label: 'Séries por grupo muscular por semana',
        before: {
          BEGINNER: { sets: { min: 6, max: 10 } },
          INTERMEDIATE: { sets: { min: 10, max: 16 } },
        },
        after: {
          BEGINNER: { sets: { min: 8, max: 10 } },
          INTERMEDIATE: { sets: { min: 10, max: 16 } },
        },
      },
    ]);

    expect(change).toMatchObject({
      where: 'Volume · Séries por grupo muscular por semana',
      detail: 'Iniciante · Séries/semana',
      before: '6 a 10',
      after: '8 a 10',
    });
  });

  it('campo simples vira uma linha só, com o nome da seção', () => {
    const spec = methodologyDomainSpec('RECOVERY');
    const changes = readableChanges(spec, [
      { path: 'flags.minSleepHours', label: 'Sono abaixo de', before: 6, after: 5.5 },
    ]);

    expect(changes).toEqual([
      {
        key: 'flags.minSleepHours',
        where: 'Sinais de atenção · Sono abaixo de',
        before: '6',
        after: '5.5',
      },
    ]);
  });
});

describe('apresentação', () => {
  it('traduz a tarefa do agente para uma descrição legível', () => {
    expect(agentLabelOfTask('recovery.analyze_week')).toBe('Recuperação: analisar a semana');
    expect(agentLabelOfTask('goals.nova_tarefa')).toBe('Tarefa interna dos agentes');
    expect(agentLabelOfTask('tarefa.desconhecida')).toBe('Tarefa interna dos agentes');
  });

  it('formata data no fuso de São Paulo e ignora data inválida', () => {
    expect(formatDate('2026-10-20T15:00:00.000Z')).toContain('20/10/2026');
    expect(formatDate('não é data')).toBe('');
  });

  it('o selo de estado sempre escreve o estado por extenso', () => {
    render(
      <>
        <DocumentStatusBadge status="PUBLISHED" />
        <DocumentStatusBadge status="TESTING" />
        <DocumentStatusBadge status="DRAFT" />
        <DocumentStatusBadge status="SUPERSEDED" />
        <DocumentStatusBadge status="DISCARDED" />
      </>,
    );
    for (const text of [
      'Em vigor',
      'Testada, pronta para publicar',
      'Rascunho',
      'Versão anterior',
      'Descartada',
    ]) {
      expect(screen.getByText(text)).toBeVisible();
    }
  });
});
