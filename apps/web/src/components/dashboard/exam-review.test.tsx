import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MedicalExamView } from '@movivo/shared';

import type * as ControlCenterApi from '@/lib/control-center-api';

const { getExceptionExamFile } = vi.hoisted(() => ({ getExceptionExamFile: vi.fn() }));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getExceptionExamFile,
}));

import { ExamReview } from './exam-review';

const CASE_ID = '11111111-1111-4111-8111-111111111111';

const exam: MedicalExamView = {
  id: '22222222-2222-4222-8222-222222222222',
  receivedAt: '2026-10-31T12:00:00.000Z',
  status: 'COMMENTED',
  reading: {
    isExam: true,
    examType: 'Exames de sangue',
    examDate: '2026-10-20',
    legibility: 'GOOD',
    values: [
      { name: 'TSH', value: '7,8', unit: 'mUI/L', referenceRange: '0,4 a 4,5', flag: 'HIGH' },
    ],
  },
  comment: {
    message: 'O TSH veio acima da referência do laboratório. Vale levar a um endocrinologista.',
    attentionPoints: [{ marker: 'TSH', status: 'HIGH', note: 'Acima da referência.' }],
    specialties: ['Endocrinologia'],
    urgency: 'SOON',
    contextSummary: 'TSH acima da referência.',
  },
};

describe('ExamReview', () => {
  it('mostra a leitura, o comentário enviado e abre o arquivo original', async () => {
    getExceptionExamFile.mockResolvedValue({ mediaType: 'application/pdf', base64: 'JVBERi0=' });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    URL.createObjectURL = vi.fn(() => 'blob:exame');
    URL.revokeObjectURL = vi.fn();
    render(<ExamReview caseId={CASE_ID} exam={exam} />);

    expect(screen.getByText('Exames de sangue · 20/10/2026')).toBeInTheDocument();
    expect(screen.getByText('Acima')).toBeInTheDocument();
    expect(screen.getByText(/Especialidade sugerida: Endocrinologia/)).toBeInTheDocument();
    expect(screen.getByText(/endocrinologista/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Ver arquivo original' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('blob:exame', '_blank', 'noopener'));
    expect(getExceptionExamFile).toHaveBeenCalledWith(CASE_ID);
  });
});
