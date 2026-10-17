import { describe, expect, it } from 'vitest';

import {
  createMethodologyVersionSchema,
  MAX_METHODOLOGY_NOTE_LENGTH,
  methodologyActionSchema,
  methodologyNoteSchema,
  methodologyPublishActionSchema,
} from './knowledge.schema';

const VERSION_ID = '11111111-1111-4111-8111-111111111111';

describe('versão de metodologia', () => {
  it('não limita o tamanho do conteúdo (metodologia longa)', () => {
    const content = 'Diretriz metodológica. '.repeat(40_000);
    expect(
      createMethodologyVersionSchema.safeParse({ content, changeNote: 'Revisão completa' }).success,
    ).toBe(true);
  });

  it('aceita motivo da mudança longo, até o teto', () => {
    const content = 'x'.repeat(300);
    const longNote = 'a'.repeat(MAX_METHODOLOGY_NOTE_LENGTH);
    expect(
      createMethodologyVersionSchema.safeParse({ content, changeNote: longNote }).success,
    ).toBe(true);
    expect(
      createMethodologyVersionSchema.safeParse({ content, changeNote: `${longNote}a` }).success,
    ).toBe(false);
  });

  it('permite salvar sem resumo da alteração', () => {
    expect(createMethodologyVersionSchema.safeParse({ content: 'x'.repeat(300) }).success).toBe(
      true,
    );
  });

  it('publicar e restaurar não exigem justificativa', () => {
    expect(methodologyPublishActionSchema.safeParse({ versionId: VERSION_ID }).success).toBe(true);
    expect(
      methodologyPublishActionSchema.safeParse({ versionId: VERSION_ID, note: '' }).success,
    ).toBe(true);
  });

  it('aceita justificativa longa nas transições (enviar, revisar, publicar, restaurar)', () => {
    const note = 'b'.repeat(2000);
    expect(methodologyNoteSchema.safeParse({ note }).success).toBe(true);
    expect(methodologyActionSchema.safeParse({ versionId: VERSION_ID, note }).success).toBe(true);
  });
});
