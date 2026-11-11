/**
 * Porta entre o planejamento (que sabe montar o PDF do protocolo) e o envio pelo WhatsApp (que só
 * entrega o arquivo). O WhatsApp não importa módulos de domínio (regra §12.5), então o planejamento
 * registra aqui quem gera o PDF e o worker de envio pede o arquivo na hora de mandar.
 *
 * O PDF é gerado no momento do envio e vai como arquivo (base64) para o WhatsApp: nada de link para
 * o aluno abrir nem URL para o provedor baixar. Também não passa pela fila: o conteúdo do protocolo
 * (dado de saúde) não fica gravado no Redis.
 */
import { Injectable } from '@nestjs/common';

export type PlanDocumentKind = 'treino' | 'alimentacao';

export interface RenderedPlanDocument {
  buffer: Buffer;
  fileName: string;
}

export interface PlanDocumentRenderer {
  /** PDF do protocolo vigente do aluno; `null` quando ele não tem esse protocolo ativo. */
  render(userId: string, kind: PlanDocumentKind): Promise<RenderedPlanDocument | null>;
}

@Injectable()
export class PlanDocumentRegistry {
  private renderer: PlanDocumentRenderer | null = null;

  register(renderer: PlanDocumentRenderer): void {
    this.renderer = renderer;
  }

  async render(userId: string, kind: PlanDocumentKind): Promise<RenderedPlanDocument | null> {
    if (!this.renderer) throw new Error('gerador de PDF do protocolo não registrado');
    return this.renderer.render(userId, kind);
  }
}
