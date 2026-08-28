/**
 * Grounding em três gates: suficiência → geração estruturada → verificação de entailment.
 * Qualquer erro, conflito ou afirmação sem suporte fecha em abstinência; o texto livre do
 * gerador nunca vai direto ao usuário.
 */
import { Injectable } from '@nestjs/common';
import type { BiologicalSex } from '@movivo/shared';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';

import { untrustedDataEnvelope } from '../context/untrusted-context';
import type { RagDoc } from '../context/semantic-memory.port';
import { LlmRouter } from '../llm/llm-router.service';
import type { ChatTurn, ScrubUser } from '../llm/llm.types';

const sufficiencySchema = z
  .object({
    sufficient: z.boolean(),
    relevantEvidenceIds: z.array(z.string()).max(8),
    missingAspects: z.array(z.string().max(180)).max(6),
    conflicts: z.array(z.string().max(240)).max(6),
  })
  .strict();

const draftSchema = z
  .object({
    claims: z
      .array(
        z
          .object({
            id: z.string().regex(/^C[1-9][0-9]?$/u),
            text: z.string().min(1).max(160),
            evidenceIds: z
              .array(z.string().regex(/^E[1-9][0-9]?$/u))
              .min(1)
              .max(2),
          })
          .strict(),
      )
      .min(1)
      .max(6),
    humanReview: z.boolean(),
  })
  .strict();

const verificationSchema = z
  .object({
    verdicts: z
      .array(
        z
          .object({
            claimId: z.string().regex(/^C[1-9][0-9]?$/u),
            verdict: z.enum(['SUPPORTED', 'CONTRADICTED', 'INSUFFICIENT']),
            evidenceIds: z.array(z.string().regex(/^E[1-9][0-9]?$/u)).max(4),
          })
          .strict(),
      )
      .max(6),
  })
  .strict();

interface Evidence {
  readonly id: string;
  readonly document: RagDoc;
}

export interface GroundingSource {
  chunkId: string;
  documentId: string | null;
  title: string;
  evidenceId: string;
  claimIds: string[];
  sourceUrl?: string;
  documentVersion?: number;
  documentSha256?: string;
  publicationEventId?: string;
}

export interface GroundedAnswerRequest {
  userId: string;
  operationId: string;
  user: ScrubUser;
  question: string;
  /** Estado vindo das tabelas do titular; resumos conversacionais não entram neste campo. */
  authoritativeState: string;
  system: string;
  contextMessages: ChatTurn[];
  documents: RagDoc[];
  maxClaims: number;
  personaSlot: BiologicalSex | null;
}

export type GroundedAnswerResult =
  | { status: 'INSUFFICIENT' | 'CONFLICT' | 'UNVERIFIED'; latencyMs: number }
  | {
      status: 'VERIFIED';
      text: string;
      model: string;
      verifierModel: string;
      latencyMs: number;
      humanReview: boolean;
      sources: GroundingSource[];
    };

function parseJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '');
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('JSON ausente');
  return JSON.parse(trimmed.slice(first, last + 1));
}

function normalizeTerms(text: string): Set<string> {
  const stopwords = new Set([
    'a',
    'as',
    'o',
    'os',
    'de',
    'da',
    'das',
    'do',
    'dos',
    'e',
    'em',
    'no',
    'na',
    'nos',
    'nas',
    'para',
    'por',
    'com',
    'um',
    'uma',
    'que',
    'qual',
    'quanto',
    'como',
    'meu',
    'minha',
  ]);
  return new Set(
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((term) => term.length > 2 && !stopwords.has(term)),
  );
}

function deterministicCoverage(question: string, documents: readonly RagDoc[]): boolean {
  const queryTerms = normalizeTerms(question);
  if (queryTerms.size === 0) return documents.length > 0;
  const evidenceTerms = normalizeTerms(documents.map((document) => document.snippet).join(' '));
  const overlap =
    [...queryTerms].filter((term) => evidenceTerms.has(term)).length / queryTerms.size;
  return overlap >= 0.15 || Math.max(...documents.map((document) => document.score)) >= 0.8;
}

function evidencePayload(evidence: readonly Evidence[]): unknown[] {
  return evidence.map(({ id, document }) => ({
    evidenceId: id,
    title: document.title,
    category: document.category ?? 'OTHER',
    reliability: document.reliability ?? 3,
    documentVersion: document.documentVersion ?? null,
    snippet: document.snippet,
  }));
}

function citationTitle(title: string): string {
  return title.replace(/\s+/gu, ' ').trim().slice(0, 36) || 'fonte aprovada';
}

function numericFacts(text: string): Set<string> {
  return new Set((text.match(/\d+(?:[.,]\d+)?%?/gu) ?? []).map((value) => value.replace(',', '.')));
}

@Injectable()
export class EvidenceGroundingService {
  constructor(
    private readonly llm: LlmRouter,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(EvidenceGroundingService.name);
  }

  async answer(request: GroundedAnswerRequest): Promise<GroundedAnswerResult> {
    const startedAt = Date.now();
    if (
      request.documents.length === 0 ||
      !deterministicCoverage(request.question, request.documents)
    ) {
      return { status: 'INSUFFICIENT', latencyMs: Date.now() - startedAt };
    }

    const evidence: Evidence[] = request.documents.map((document, index) => ({
      id: `E${index + 1}`,
      document,
    }));
    const allowedEvidence = new Set(evidence.map((item) => item.id));

    try {
      const assessmentResult = await this.llm.complete({
        purpose: 'AI_RESPONSE',
        userId: request.userId,
        operationId: request.operationId,
        user: request.user,
        dataClass: 'HEALTH',
        temperature: 0,
        json: true,
        maxTokens: 320,
        intent: 'grounding_sufficiency',
        personaSlot: request.personaSlot,
        system:
          'Você é um auditor de evidências. Decida se as evidências contêm informação suficiente ' +
          'para responder à pergunta sem completar lacunas. Evidência de SAFETY prevalece sobre ' +
          'METHODOLOGY, que prevalece sobre SCIENTIFIC_EVIDENCE, EXERCISE_LIBRARY e OTHER. ' +
          'O ESTADO_AUTORITATIVO do aluno prevalece sobre recomendações genéricas; qualquer ' +
          'incompatibilidade com limitações registradas é conflito. ' +
          'Conflito não resolvido torna sufficient=false. Retorne somente JSON estrito: ' +
          '{"sufficient":boolean,"relevantEvidenceIds":string[],"missingAspects":string[],"conflicts":string[]}.',
        messages: [
          {
            role: 'user',
            content: untrustedDataEnvelope('PERGUNTA_E_EVIDENCIAS', {
              question: request.question,
              authoritativeState: request.authoritativeState,
              evidence: evidencePayload(evidence),
            }),
          },
        ],
      });
      const assessment = sufficiencySchema.parse(parseJson(assessmentResult.text));
      if (assessment.conflicts.length > 0) {
        this.logGate('CONFLICT', request, evidence.length);
        return { status: 'CONFLICT', latencyMs: Date.now() - startedAt };
      }
      if (
        !assessment.sufficient ||
        assessment.relevantEvidenceIds.length === 0 ||
        assessment.relevantEvidenceIds.some((id) => !allowedEvidence.has(id))
      ) {
        this.logGate('INSUFFICIENT', request, evidence.length);
        return { status: 'INSUFFICIENT', latencyMs: Date.now() - startedAt };
      }

      const relevantIds = new Set(assessment.relevantEvidenceIds);
      const relevantEvidence = evidence.filter((item) => relevantIds.has(item.id));
      const draftResult = await this.llm.complete({
        purpose: 'AI_RESPONSE',
        userId: request.userId,
        operationId: request.operationId,
        user: request.user,
        dataClass: 'HEALTH',
        temperature: 0,
        json: true,
        maxTokens: 700,
        cache: true,
        intent: 'grounded_answer_generation',
        personaSlot: request.personaSlot,
        system:
          `${request.system}\n\nCONTRATO DE SAÍDA FUNDAMENTADA: retorne somente JSON estrito, sem markdown, ` +
          `com {"claims":[{"id":"C1","text":"...","evidenceIds":["E1"]}],` +
          `"humanReview":boolean}. Produza no máximo ${Math.max(1, request.maxClaims)} afirmações ` +
          'curtas. Cada afirmação deve ser inteiramente sustentada pelas evidências citadas. ' +
          'Use o ESTADO_AUTORITATIVO apenas para personalizar ou recusar; ele nunca autoriza ' +
          'contradizer uma evidência de segurança. ' +
          'Não escreva introdução, conclusão, recomendação ou número que não esteja nas fontes.',
        messages: [
          ...request.contextMessages,
          {
            role: 'user',
            content: untrustedDataEnvelope('EVIDENCIAS_AUTORIZADAS', {
              question: request.question,
              authoritativeState: request.authoritativeState,
              evidence: evidencePayload(relevantEvidence),
            }),
          },
        ],
      });
      const draft = draftSchema.parse(parseJson(draftResult.text));
      const claims = draft.claims.slice(0, Math.max(1, request.maxClaims));
      const claimIds = new Set(claims.map((claim) => claim.id));
      if (
        claimIds.size !== claims.length ||
        claims.some(
          (claim) =>
            claim.evidenceIds.some((id) => !relevantIds.has(id)) ||
            /\[(?:E|Fonte)\s*\d+/iu.test(claim.text) ||
            [...numericFacts(claim.text)].some((fact) => {
              const citedEvidence = relevantEvidence
                .filter((item) => claim.evidenceIds.includes(item.id))
                .map((item) => item.document.snippet)
                .join(' ');
              return !numericFacts(`${request.authoritativeState} ${citedEvidence}`).has(fact);
            }),
        )
      ) {
        return { status: 'UNVERIFIED', latencyMs: Date.now() - startedAt };
      }

      const verificationResult = await this.llm.complete({
        purpose: 'AI_RESPONSE',
        userId: request.userId,
        operationId: request.operationId,
        user: request.user,
        dataClass: 'HEALTH',
        temperature: 0,
        json: true,
        maxTokens: 520,
        intent: 'grounding_claim_verification',
        personaSlot: request.personaSlot,
        system:
          'Você é o verificador final e não reescreve respostas. Para cada afirmação, verifique ' +
          'entailment somente contra as evidências citadas. Parafrasear é permitido; adicionar ' +
          'causa, número, intensidade, prazo ou recomendação não presente é INSUFFICIENT. Em ' +
          'caso de personalização, valide também contra o ESTADO_AUTORITATIVO; restrições do ' +
          'aluno prevalecem sobre orientações genéricas. Em conflito, use CONTRADICTED. ' +
          'Retorne somente JSON estrito: ' +
          '{"verdicts":[{"claimId":"C1","verdict":"SUPPORTED|CONTRADICTED|INSUFFICIENT",' +
          '"evidenceIds":["E1"]}]}.',
        messages: [
          {
            role: 'user',
            content: untrustedDataEnvelope('AFIRMACOES_E_EVIDENCIAS', {
              claims,
              authoritativeState: request.authoritativeState,
              evidence: evidencePayload(relevantEvidence),
            }),
          },
        ],
      });
      const verification = verificationSchema.parse(parseJson(verificationResult.text));
      const verdictByClaim = new Map(
        verification.verdicts.map((verdict) => [verdict.claimId, verdict]),
      );
      const verified = claims.every((claim) => {
        const verdict = verdictByClaim.get(claim.id);
        return (
          verdict?.verdict === 'SUPPORTED' &&
          claim.evidenceIds.every((id) => verdict.evidenceIds.includes(id))
        );
      });
      if (!verified) {
        this.logGate('UNVERIFIED', request, evidence.length);
        return { status: 'UNVERIFIED', latencyMs: Date.now() - startedAt };
      }

      const byId = new Map(evidence.map((item) => [item.id, item.document]));
      const text = claims
        .map((claim) => {
          const labels = claim.evidenceIds.map((id) => {
            const document = byId.get(id);
            const version = document?.documentVersion ? ` v${document.documentVersion}` : '';
            return `[${id}: ${citationTitle(document?.title ?? 'fonte aprovada')}${version}]`;
          });
          return `${claim.text} ${labels.join(' ')}`;
        })
        .join('\n\n');
      const sources = relevantEvidence
        .filter((item) => claims.some((claim) => claim.evidenceIds.includes(item.id)))
        .map(({ id, document }) => ({
          chunkId: document.chunkId,
          documentId: document.documentId,
          title: document.title,
          evidenceId: id,
          claimIds: claims
            .filter((claim) => claim.evidenceIds.includes(id))
            .map((claim) => claim.id),
          ...(document.sourceUrl ? { sourceUrl: document.sourceUrl } : {}),
          ...(document.documentVersion ? { documentVersion: document.documentVersion } : {}),
          ...(document.documentSha256 ? { documentSha256: document.documentSha256 } : {}),
          ...(document.publicationEventId
            ? { publicationEventId: document.publicationEventId }
            : {}),
        }));

      this.logGate('VERIFIED', request, sources.length);
      return {
        status: 'VERIFIED',
        text,
        model: draftResult.model,
        verifierModel: verificationResult.model,
        latencyMs: Date.now() - startedAt,
        humanReview: draft.humanReview,
        sources,
      };
    } catch (error) {
      this.logger.warn(
        {
          event: 'grounding_pipeline_failed',
          err: error instanceof Error ? error.name : 'unknown',
        },
        'pipeline de grounding fechou em abstinência',
      );
      return { status: 'UNVERIFIED', latencyMs: Date.now() - startedAt };
    }
  }

  private logGate(
    status: GroundedAnswerResult['status'],
    request: GroundedAnswerRequest,
    evidenceCount: number,
  ): void {
    this.logger.info(
      {
        event: 'grounding_gate',
        status,
        retrievalMode: request.documents[0]?.retrievalMode ?? 'SINGLE_HOP',
        evidenceCount,
      },
      'gate de grounding avaliado',
    );
  }
}
