/**
 * Publicação sem chamar modelo de IA: banco e eventos de mentira. Garante a regra do estúdio:
 * só a PRIMEIRA versão de um domínio publica sem o teste com os agentes; depois, só `TESTING`.
 */
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { exampleParameters, methodologyDomainSpec } from '@movivo/shared';

import { MethodologyService, type MethodologyDocument } from './methodology.service';

const spec = methodologyDomainSpec('STRENGTH');
const draft = (over: Record<string, unknown> = {}) =>
  ({
    id: '3e8f9372-0781-4f84-b6cc-4923feb8e0da',
    domain: 'STRENGTH',
    version: 1,
    status: 'DRAFT',
    parameters: exampleParameters(spec),
    guidance: {},
    justifications: {},
    evalRunIds: [],
    ...over,
  }) as unknown as MethodologyDocument;

/** Cada `select` consome o próximo resultado da fila: primeiro o rascunho, depois a versão em vigor. */
function build(doc: MethodologyDocument, inForce: unknown[]) {
  const selects: unknown[][] = [[doc], inForce];
  const updates: unknown[] = [];
  const chainOf = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {};
    for (const name of ['from', 'where', 'limit']) chain[name] = () => chain;
    chain.set = (values: unknown) => {
      updates.push(values);
      return chain;
    };
    chain.returning = () => Promise.resolve([{ ...doc, status: 'PUBLISHED' }]);
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve);
    return chain;
  };
  const tx = {
    select: () => chainOf(selects.shift() ?? []),
    update: () => chainOf([]),
  };
  const record = vi.fn();
  const service = new MethodologyService(
    { runAsSystem: (cb: (t: unknown) => unknown) => cb(tx) } as never,
    { invalidate: vi.fn() } as never,
    {} as never,
    {} as never,
    { record } as never,
    { flushSoon: vi.fn() } as never,
  );
  return { service, updates, record };
}

describe('publicar uma versão da metodologia', () => {
  it('a primeira versão do domínio publica sem teste com os agentes', async () => {
    const { service, record } = build(draft(), []);
    const saved = await service.publish('id', 'staff-1');
    expect(saved.status).toBe('PUBLISHED');
    expect(record).toHaveBeenCalled();
  });

  it('com versão já em vigor, rascunho sem teste continua recusado', async () => {
    const { service, updates } = build(draft({ version: 2 }), [{ id: 'v1' }]);
    await expect(service.publish('id', 'staff-1')).rejects.toBeInstanceOf(ConflictException);
    expect(updates).toEqual([]);
  });

  it('a primeira versão ainda exige justificar valor fora da faixa usual', async () => {
    const parameters = exampleParameters(spec) as Record<string, Record<string, unknown>>;
    const outOfRange = {
      ...parameters,
      periodization: {
        ...parameters.periodization,
        blockWeeksByPhase: {
          ...(parameters.periodization?.blockWeeksByPhase as object),
          HYPERTROPHY: { weeks: { min: 1, max: 12 } },
        },
      },
    };
    const { service } = build(draft({ parameters: outOfRange }), []);
    await expect(service.publish('id', 'staff-1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('versão descartada não publica nunca', async () => {
    const { service } = build(draft({ status: 'DISCARDED' }), []);
    await expect(service.publish('id', 'staff-1')).rejects.toBeInstanceOf(ConflictException);
  });
});
