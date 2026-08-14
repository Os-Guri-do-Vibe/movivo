/**
 * Testes da tela de setor ainda não construído (US-7.7 / TASK-7.7.4).
 *
 * O contrato dela é honestidade: diz o que vai existir, de que depende e quando —
 * e não expõe nenhum controle que não funcione.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RoadmapSector } from './roadmap-sector';

describe('RoadmapSector', () => {
  it('explica escopo, dependência e sprint sem oferecer controle não funcional', () => {
    render(
      <RoadmapSector
        title="Educação Física"
        sprint="Sprint 9"
        what="Revisão dos protocolos assinados pelo profissional CREF."
        dependency="Motor determinístico de treino publicado."
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Educação Física' })).toBeVisible();
    expect(screen.getByText(/Previsto para a Sprint 9/)).toBeVisible();
    expect(
      screen.getByText('Revisão dos protocolos assinados pelo profissional CREF.'),
    ).toBeVisible();
    expect(screen.getByText('Motor determinístico de treino publicado.')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
