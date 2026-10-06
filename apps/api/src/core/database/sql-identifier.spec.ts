import { describe, expect, it } from 'vitest';

import {
  buildAdSpendImmutabilitySql,
  buildAgentConfigImmutabilitySql,
  buildAuditIntegritySql,
  buildExpensesImmutabilitySql,
  buildFaqEntriesImmutabilitySql,
  buildKnowledgeDocumentsSecuritySql,
  buildPaymentsImmutabilitySql,
  buildProfessionalAccessSql,
  buildStatusTransitionsImmutabilitySql,
} from './security-policies';
import { sqlIdentifier } from './sql-identifier';

const PAYLOADS = [
  'movivo_app; DROP TABLE users',
  'movivo_app --',
  '"movivo_app"',
  "movivo_app'",
  'movivo app',
  'Movivo_App',
  '1movivo',
  '',
  'a'.repeat(64),
];

describe('sqlIdentifier', () => {
  it.each(['movivo_app', '_x', 'role1', 'a'.repeat(63)])('aceita %s', (name) => {
    expect(sqlIdentifier(name)).toBe(name);
  });

  it.each(PAYLOADS)('recusa %j antes de montar qualquer SQL', (name) => {
    expect(() => sqlIdentifier(name)).toThrow(/Identificador SQL inválido/);
  });
});

describe('builders de DDL (GRANT/REVOKE) recusam nome de role malicioso', () => {
  const builders = {
    buildAuditIntegritySql,
    buildAgentConfigImmutabilitySql,
    buildFaqEntriesImmutabilitySql,
    buildProfessionalAccessSql,
    buildStatusTransitionsImmutabilitySql,
    buildExpensesImmutabilitySql,
    buildPaymentsImmutabilitySql,
    buildAdSpendImmutabilitySql,
    buildKnowledgeDocumentsSecuritySql,
  };

  it.each(Object.entries(builders))('%s', (_name, build) => {
    expect(() => build('movivo_app; DROP TABLE users')).toThrow(/Identificador SQL inválido/);
    expect(build('movivo_app')).toContain('movivo_app');
  });
});
