import { BadRequestException } from '@nestjs/common';

import { detectInjection } from '../protocol/validation/prompt-injection';

const MARKUP_OR_SCRIPT = /<\/?(?:script|iframe|object|embed)\b|javascript:/i;

function reject(code: string, message: string): never {
  throw new BadRequestException({ code, message });
}

/**
 * Varredura do texto já extraído de um artigo científico, antes de ele entrar no RAG.
 *
 * Artigos citam e-mails de autores, telefones de instituições e tabelas numéricas que casam
 * com padrões de dado pessoal; por isso a checagem de PII dos documentos internos não vale
 * aqui. O que continua barrado é o que ataca o RAG: conteúdo ativo e instruções dirigidas
 * ao agente (prompt injection indireta).
 */
export function scanArticleText(content: string): void {
  if (content.trim().length < 50) {
    reject('CONTENT_TOO_SHORT', 'O documento precisa ter ao menos 50 caracteres de texto.');
  }
  if (MARKUP_OR_SCRIPT.test(content)) {
    reject('ACTIVE_OR_BINARY_CONTENT', 'A varredura recusou conteúdo ativo (script ou marcação).');
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
