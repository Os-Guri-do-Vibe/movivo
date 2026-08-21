import { BadRequestException } from '@nestjs/common';

import { detectInjection } from '../protocol/validation/prompt-injection';

const MARKUP_OR_SCRIPT = /<\/?(?:script|iframe|object|embed|html|body)\b|javascript:/i;
const PERSONAL_DATA =
  /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b|\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b(?:\+?55\s*)?\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4}\b/;

function reject(code: string, message: string): never {
  throw new BadRequestException({ code, message });
}

export function scanKnowledgeContent(content: string): void {
  if (content.trim().length < 50)
    reject('CONTENT_TOO_SHORT', 'O documento precisa ter 50 caracteres.');
  if (content.includes('\uFFFD')) reject('INVALID_UTF8', 'O arquivo não contém UTF-8 válido.');
  const hasForbiddenControl = [...content].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 && code !== 9 && code !== 10 && code !== 13;
  });
  if (hasForbiddenControl || MARKUP_OR_SCRIPT.test(content)) {
    reject('ACTIVE_OR_BINARY_CONTENT', 'A varredura recusou conteúdo ativo ou binário.');
  }
  if (PERSONAL_DATA.test(content)) {
    reject('PERSONAL_DATA_DETECTED', 'Remova dados pessoais antes do envio.');
  }
  if (detectInjection(content)) {
    reject('PROMPT_INJECTION_DETECTED', 'A varredura recusou instruções direcionadas a agente.');
  }
}

export function knowledgeProcessingErrorCode(error: unknown): string {
  if (error instanceof BadRequestException) {
    const response = error.getResponse();
    if (typeof response === 'object' && response && 'code' in response) {
      const code = (response as { code?: unknown }).code;
      if (typeof code === 'string') return code.slice(0, 80);
    }
  }
  return 'PROCESSING_FAILED';
}
