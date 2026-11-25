import type { PhotoAssessmentAudit, StudentPhotoAssessments } from '@movivo/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

import { studentDetailResponse } from '../../../test/control-center-fixtures';

const { getStudent } = vi.hoisted(() => ({ getStudent: vi.fn() }));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getStudent,
}));

import { PHOTO_ASSESSMENT_EMPTY, PhysiqueAssessmentCard } from './physique-assessment-card';
import { StudentDetail } from './student-detail';

const latest: PhotoAssessmentAudit = {
  id: '44444444-4444-4444-8444-444444444444',
  assessedOn: '2026-10-01',
  photoCount: 4,
  confidence: 'MEDIUM',
  bodyFatRange: { min: 18, max: 22 },
  comparisonSummary: 'Cintura um pouco mais definida.',
  observationsForProfessional: ['Ombros levemente à frente nas fotos laterais.'],
  limitations: ['Luz lateral forte na foto de costas.'],
  physique: {
    muscleGroups: [
      { region: 'SHOULDERS', status: 'STRENGTH', note: 'Deltoides bem marcados.' },
      { region: 'CHEST', status: 'BALANCED', note: 'Proporcional ao tronco.' },
      { region: 'ARMS', status: 'TO_DEVELOP', note: 'Pouco volume de braço.' },
      { region: 'CALVES', status: 'NOT_ASSESSABLE', note: 'Fora do enquadramento.' },
    ],
    posture: [
      {
        region: 'SHOULDERS',
        finding: 'Ombros projetados à frente',
        degree: 'NOTABLE',
        seenIn: ['RIGHT', 'LEFT'],
      },
      {
        region: 'KNEES',
        finding: 'Joelhos levemente para dentro',
        degree: 'MILD',
        seenIn: ['FRONT'],
      },
      {
        region: 'FEET',
        finding: 'Apoio dos pés alinhado',
        degree: 'NONE_VISIBLE',
        seenIn: ['BACK'],
      },
    ],
    symmetry: 'Ombro direito um pouco mais alto na foto frontal.',
    strengths: ['Boa base de membros inferiores.'],
    attentionPoints: ['Alinhamento dos ombros.'],
  },
};

/** Avaliação anterior à avaliação completa: sem `physique`. */
const legacy: PhotoAssessmentAudit = {
  id: '66666666-6666-4666-8666-666666666666',
  assessedOn: '2026-07-01',
  photoCount: 4,
  confidence: 'LOW',
  bodyFatRange: { min: 20, max: 25 },
  comparisonSummary: null,
  observationsForProfessional: [],
  limitations: ['Fotos com roupa larga.'],
  physique: null,
};

const both: StudentPhotoAssessments = { latest, previous: legacy };

function headings() {
  return screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
}

/** O bloco (título + conteúdo) de um subtítulo da seção. */
function blockOf(name: string): HTMLElement {
  const block = screen.getByRole('heading', { name }).parentElement;
  if (!block) throw new Error(`Bloco "${name}" sem contêiner.`);
  return block;
}

function pick<T>(items: readonly T[], match: (item: T) => boolean): T {
  const found = items.find(match);
  if (found === undefined) throw new Error('Item não encontrado.');
  return found;
}

describe('PhysiqueAssessmentCard', () => {
  it('lê do resumo ao detalhe, na ordem combinada', () => {
    render(<PhysiqueAssessmentCard assessments={both} />);
    expect(headings()).toEqual([
      'Gordura corporal',
      'Grupos musculares',
      'Postura',
      'Simetria e destaques',
      'Limitações da leitura',
    ]);
    expect(screen.getByText('Avaliação de 01/10/2026')).toBeVisible();
    expect(screen.getByText('Leitura da IA, para auditoria')).toBeVisible();
    expect(screen.getByText('Média')).toBeVisible();
    expect(screen.getByText('± 2 p.p. na faixa')).toBeVisible();
  });

  it('gordura corporal sempre em faixa, com a variação e a margem de erro por perto', () => {
    render(<PhysiqueAssessmentCard assessments={both} />);
    expect(screen.getByText(/18% a 22%/)).toBeVisible();
    expect(
      screen.getByText(
        'Ponto médio 2,5 p.p. abaixo da avaliação de 01/07/2026 (20% a 25%). As faixas se sobrepõem: a variação fica dentro da margem de erro.',
      ),
    ).toBeVisible();
    expect(screen.getByText(/Comparação da IA: Cintura/)).toBeVisible();
  });

  it('mostra os 9 grupos, cada um com etiqueta de texto (não só cor)', () => {
    render(<PhysiqueAssessmentCard assessments={both} />);
    const block = blockOf('Grupos musculares');
    const items = within(block).getAllByRole('listitem');
    expect(items).toHaveLength(9);
    const byName = (name: string) =>
      pick(items, (item) => item.textContent?.startsWith(name) ?? false);
    expect(within(byName('Ombros')).getByText('Ponto forte')).toBeVisible();
    expect(within(byName('Peitoral')).getByText('Equilibrado')).toBeVisible();
    expect(within(byName('Braços')).getByText('A desenvolver')).toBeVisible();
    expect(within(byName('Panturrilhas')).getByText('Não avaliável')).toBeVisible();
    expect(within(byName('Glúteos')).getByText('Sem leitura')).toBeVisible();
    expect(within(byName('Braços')).getByText('Pouco volume de braço.')).toBeVisible();
    expect(
      within(block).getByText('1 ponto forte · 1 equilibrado · 1 a desenvolver · 1 não avaliável'),
    ).toBeVisible();
  });

  it('postura lista os 7 segmentos com grau em texto, o que foi visto e em quais posições', () => {
    render(<PhysiqueAssessmentCard assessments={both} />);
    const block = blockOf('Postura');
    const items = within(block).getAllByRole('listitem');
    expect(items.map((item) => item.firstChild?.textContent)).toEqual([
      'Cabeça e cervical',
      'Ombros',
      'Coluna torácica',
      'Coluna lombar',
      'Pelve',
      'Joelhos',
      'Pés',
    ]);
    const segment = (name: string) => pick(items, (item) => item.firstChild?.textContent === name);
    const shoulders = segment('Ombros');
    expect(within(shoulders).getByText('Marcante')).toBeVisible();
    expect(within(shoulders).getByText('Ombros projetados à frente')).toBeVisible();
    expect(within(shoulders).getByText('Visto em: Lado direito, Lado esquerdo')).toBeVisible();
    expect(shoulders.className).toMatch(/border-l-coral/);
    expect(within(segment('Joelhos')).getByText('Leve')).toBeVisible();
    expect(within(segment('Pés')).getByText('Sem alteração visível')).toBeVisible();
    expect(within(segment('Pelve')).getByText('Sem leitura')).toBeVisible();
    expect(within(block).getByText('1 segmento com alteração marcante.')).toBeVisible();
  });

  it('traz simetria, destaques, limitações e o aviso, sem linguagem clínica', () => {
    const { container } = render(<PhysiqueAssessmentCard assessments={both} />);
    expect(screen.getByText(/Ombro direito um pouco mais alto/)).toBeVisible();
    expect(screen.getByText('Boa base de membros inferiores.')).toBeVisible();
    expect(screen.getByText('Alinhamento dos ombros.')).toBeVisible();
    expect(screen.getByText('Luz lateral forte na foto de costas.')).toBeVisible();
    expect(
      screen.getByText(/recomendação de procurar uma avaliação profissional externa/),
    ).toBeVisible();
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/diagn[óo]stic|tratamento|\bcura\b|presencialmente|—/i);
    expect(container.querySelector('img')).toBeNull();
  });

  it('o seletor por data abre a avaliação anterior, que é de antes da avaliação completa', async () => {
    const user = userEvent.setup();
    render(<PhysiqueAssessmentCard assessments={both} />);
    const group = screen.getByRole('group', { name: 'Escolher a avaliação' });
    const recent = within(group).getByRole('button', { name: '01/10/2026 (mais recente)' });
    expect(recent).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(group).getByRole('button', { name: '01/07/2026 (anterior)' }));

    expect(screen.getByText('Avaliação de 01/07/2026')).toBeVisible();
    expect(screen.getByText(/antes da avaliação física completa/)).toBeVisible();
    expect(screen.getByText('Baixa')).toBeVisible();
    expect(screen.getByText('Fotos com roupa larga.')).toBeVisible();
    expect(headings()).toEqual([
      'Gordura corporal',
      'Simetria e destaques',
      'Limitações da leitura',
    ]);
    // A anterior não tem com quem comparar dentro do payload.
    expect(screen.queryByText(/Ponto médio/)).toBeNull();
  });

  it('sem seletor quando só há uma avaliação', () => {
    render(<PhysiqueAssessmentCard assessments={{ latest, previous: null }} />);
    expect(screen.queryByRole('group', { name: 'Escolher a avaliação' })).toBeNull();
    expect(screen.queryByText(/Ponto médio/)).toBeNull();
  });

  it('sem fotos ou sem autorização, e também com servidor antigo, mostra o estado vazio', () => {
    const { rerender } = render(
      <PhysiqueAssessmentCard assessments={{ latest: null, previous: null }} />,
    );
    expect(screen.getByText(PHOTO_ASSESSMENT_EMPTY)).toBeVisible();
    rerender(<PhysiqueAssessmentCard assessments={undefined} />);
    expect(screen.getByText('O aluno não enviou fotos ou não autorizou o uso.')).toBeVisible();
  });

  it('carregando e erro', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<PhysiqueAssessmentCard loading />);
    expect(screen.getByText('Carregando a avaliação física por foto.')).toBeInTheDocument();

    rerender(<PhysiqueAssessmentCard error="Tempo esgotado." onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/Não foi possível carregar/);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('StudentDetail: seção "Avaliação física por foto"', () => {
  beforeEach(() => getStudent.mockReset());

  const withHealth = (health: unknown) => ({
    ...studentDetailResponse,
    data: { student: { ...studentDetailResponse.data.student, health } },
  });

  it('aparece dentro do corte de saúde, logo depois da seção Saúde', async () => {
    getStudent.mockResolvedValue(
      withHealth({ ...studentDetailResponse.data.student.health, photoAssessment: both }),
    );
    render(<StudentDetail id={studentDetailResponse.data.student.id} />);
    const section = await screen.findByRole('region', { name: 'Avaliação física por foto' });
    expect(within(section).getByText('Leitura da IA, para auditoria')).toBeVisible();
    const regions = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(regions.indexOf('Avaliação física por foto')).toBe(regions.indexOf('Saúde') + 1);
  });

  it('servidor sem o campo novo cai no estado vazio; sem saúde, a seção não existe', async () => {
    getStudent.mockResolvedValueOnce(studentDetailResponse);
    const { unmount } = render(<StudentDetail id={studentDetailResponse.data.student.id} />);
    const section = await screen.findByRole('region', { name: 'Avaliação física por foto' });
    expect(within(section).getByText(PHOTO_ASSESSMENT_EMPTY)).toBeVisible();
    unmount();

    getStudent.mockResolvedValueOnce(withHealth(null));
    render(<StudentDetail id={studentDetailResponse.data.student.id} />);
    await screen.findByRole('heading', { name: 'Ana Souza' });
    expect(screen.queryByRole('region', { name: 'Avaliação física por foto' })).toBeNull();
  });
});
