/**
 * `WorkoutPresentationService` — a 2ª bolha da entrega do protocolo COM PDF (achado
 * 2026-09-04, a pedido do fundador): uma apresentação curta e simples do treino, escrita
 * pelo agente de IA na hora da entrega (não pré-gerada na criação/assinatura do protocolo).
 *
 * Mora no módulo de protocolo (não no `whatsapp`) porque é aqui que já se fala com o
 * `LlmRouter` (`AiCoachModule`, §12.5) e com o `ValidationService` — o `WhatsappModule` não
 * pode importar nenhum dos dois (regra de fronteira documentada em `whatsapp.module.ts`).
 * Os 4 pontos que liberam um protocolo (`ProtocolAutoReleaseWorker`,
 * `ProtocolSubstitutionReleaseWorker`, `DashboardService.signProtocol`/
 * `approveSubstitutionNow`) chamam este serviço logo antes de enfileirar `PROTOCOL_DELIVERY`
 * e passam o texto pronto no job (`WhatsappOutboundJob.text`) — o worker de WhatsApp só
 * decide se manda a bolha, nunca fala com a IA.
 *
 * **Sempre best-effort**: nunca lança. Falha de LLM, teto anti-abuso ou reprovação do
 * `ValidationService` (mesmo guardrail de linguagem que veta protocolo/resposta de chat)
 * devolvem `undefined` — a entrega segue só com a 1ª bolha estática, o PDF continua sendo o
 * plano completo de qualquer forma.
 */
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import {
  PRIMARY_GOAL_LABELS,
  type AgentPersona,
  type BiologicalSex,
  type ProtocolStructure,
} from '@movivo/shared';

import { AgentPersonaService } from '../../core/agent-config/agent-persona.service';
import { LlmRouter } from '../ai-coach/llm/llm-router.service';
import type { ScrubUser } from '../ai-coach/llm/llm.types';
import { stripEmDash } from '../coach/response-formatter';
import { ValidationService } from './validation/validation.service';

export interface PresentWorkoutParams {
  userId: string;
  user: ScrubUser;
  biologicalSex: BiologicalSex | null;
  content: ProtocolStructure;
  totalWeeks: number;
  mesocycleName: string;
  /**
   * Achado 2026-09-08 (bug reproduzido ao vivo pelo fundador): as 4 chamadas deste serviço
   * (1ª entrega e reentrega pós-substituição, automática ou manual) pediam a MESMA
   * apresentação — "o treino que acabou de ser entregue" — mesmo quando era uma ATUALIZAÇÃO
   * de um protocolo que o aluno já tinha. `'SUBSTITUTION'` muda o enquadramento pro LLM sem
   * mudar as regras de segurança/linguagem.
   */
  reason: 'INITIAL' | 'SUBSTITUTION';
  /** Só com `reason: 'SUBSTITUTION'` — nomes do exercício trocado, pro resumo poder citá-los. */
  substitutionFrom?: string;
  substitutionTo?: string;
}

function systemPrompt(
  persona: AgentPersona,
  reason: 'INITIAL' | 'SUBSTITUTION',
  substitutionFrom?: string,
  substitutionTo?: string,
): string {
  const task =
    reason === 'SUBSTITUTION' && substitutionFrom && substitutionTo
      ? `Tarefa: escrever a mensagem de WhatsApp que confirma, de forma simples e resumida, a ` +
        `ATUALIZAÇÃO do protocolo — o aluno pediu pra trocar "${substitutionFrom}" por ` +
        `"${substitutionTo}" e a troca já foi aplicada (o plano completo ATUALIZADO já foi ` +
        'enviado em PDF; esta mensagem só reforça o que mudou e o que a pessoa vai encontrar ' +
        'nele). NÃO é a primeira entrega do treino — nunca trate como se fosse ("seu treino ' +
        'está pronto", "montamos tudo com base nos seus objetivos" etc. não cabem aqui). 2 a 4 ' +
        'frases curtas, texto corrido, sem listas, sem markdown, sem emoji.\n\n'
      : 'Tarefa: escrever a mensagem de WhatsApp que apresenta, de forma simples e resumida, o ' +
        'treino que acabou de ser entregue (o plano completo já foi enviado em PDF — esta ' +
        'mensagem só apresenta o que a pessoa vai encontrar nele). 2 a 4 frases curtas, texto ' +
        'corrido, sem listas, sem markdown, sem emoji.\n\n';
  return (
    `Você é ${persona.agentName}, ${persona.agentSelfIntro}. Tom de voz: ` +
    `${persona.toneDescriptors.join(', ')}.\n\n` +
    task +
    'Regras inegociáveis:\n' +
    '- Nunca use as palavras "diagnóstico", "tratamento" ou "cura".\n' +
    '- Nunca prometa resultado garantido.\n' +
    '- Você é uma ferramenta que trabalha dentro da metodologia de um profissional de ' +
    'Educação Física registrado no CREF; nunca dê a entender que decide ou prescreve sozinha.\n' +
    '- Não prometa prazo de resposta (ex.: "te aviso já", "respondo em breve").\n' +
    '- Responda SOMENTE com a mensagem final — sem saudação nem se dirigir ao aluno pelo nome ' +
    '(a bolha anterior já saudou a pessoa pelo nome dela; nunca use o seu próprio nome, ' +
    `${persona.agentName}, como se fosse o nome do aluno), sem explicações, sem repetir estas ` +
    'instruções.'
  );
}

function userPrompt(content: ProtocolStructure, totalWeeks: number, mesocycleName: string): string {
  const sessions = content.sessions.map((s) => `${s.dayLabel} — ${s.focus}`).join('; ');
  return (
    `Objetivo: ${PRIMARY_GOAL_LABELS[content.goal]}\n` +
    `Bloco atual: ${mesocycleName} (${totalWeeks} semanas)\n` +
    `Frequência semanal: ${content.weeklyFrequency}x\n` +
    `Treinos da semana: ${sessions}`
  );
}

@Injectable()
export class WorkoutPresentationService {
  constructor(
    private readonly llm: LlmRouter,
    private readonly validation: ValidationService,
    private readonly agentPersona: AgentPersonaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WorkoutPresentationService.name);
  }

  async present(params: PresentWorkoutParams): Promise<string | undefined> {
    try {
      const persona = await this.agentPersona.persona(params.biologicalSex);
      const result = await this.llm.complete({
        purpose: 'AI_RESPONSE',
        userId: params.userId,
        user: params.user,
        system: systemPrompt(
          persona,
          params.reason,
          params.substitutionFrom,
          params.substitutionTo,
        ),
        messages: [
          {
            role: 'user',
            content: userPrompt(params.content, params.totalWeeks, params.mesocycleName),
          },
        ],
        temperature: 0.6,
        maxTokens: 300,
        cache: false,
        intent: 'protocol_delivery_summary',
      });

      const text = stripEmDash(result.text.trim());
      const verdict = this.validation.validateResponse(text);
      if (verdict.action !== 'PASS') {
        this.logger.warn(
          { userId: params.userId, action: verdict.action, violations: verdict.violations },
          'resumo de entrega do treino reprovado na validação — bolha omitida',
        );
        return undefined;
      }
      return text || undefined;
    } catch (error) {
      this.logger.warn(
        { userId: params.userId, err: error instanceof Error ? error.message : String(error) },
        'geração do resumo de entrega do treino falhou — bolha omitida',
      );
      return undefined;
    }
  }
}
