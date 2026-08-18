/**
 * Painel "Sistema → Integração" — ferramenta INTERNA de teste do fluxo de WhatsApp via
 * EvolutionAPI. Arquivo separado do `control-center.service.spec.ts` (mesmo padrão de
 * `control-center-students.spec.ts`): esses dois métodos não tocam banco, só o
 * `EvolutionTransport` — reusar a fixture pesada dos outros seria ruído.
 */
import { describe, expect, it, vi } from 'vitest';

import type { AgentConfigRepository } from '../../core/agent-config/agent-config.repository';
import type { DatabaseHealthService } from '../../core/database';
import type { HealthCipherService } from '../../core/database/health-cipher.service';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import { RedisKeyBuilder, type RedisHealthService } from '../../core/redis';
import type { Redis } from 'ioredis';
import type { AuditService } from './audit.service';
import { ControlCenterService } from './control-center.service';
import type { EvolutionTransport } from '../whatsapp/evolution-transport';

function build(evolution: Partial<EvolutionTransport>) {
  const db = {} as unknown as TenantDatabase;
  const service = new ControlCenterService(
    db,
    {} as unknown as DatabaseHealthService,
    {} as unknown as RedisHealthService,
    {} as unknown as AuditService,
    {} as unknown as HealthCipherService,
    {} as unknown as Redis,
    new RedisKeyBuilder('movivo'),
    {} as unknown as AgentConfigRepository,
    evolution as EvolutionTransport,
  );
  return service;
}

describe('ControlCenterService.integration', () => {
  it('sem credencial: NOT_CONFIGURED, sem chamar a EvolutionAPI', async () => {
    const connectionState = vi.fn();
    const service = build({ hasCredentials: () => false, connectionState });
    const res = await service.integration();
    expect(res.data.whatsapp).toEqual({
      configured: false,
      instanceName: null,
      status: 'NOT_CONFIGURED',
      qrCodeBase64: null,
    });
    expect(connectionState).not.toHaveBeenCalled();
  });

  it('com credencial mas nenhuma instância criada: NOT_CONFIGURED, configured=true', async () => {
    const service = build({
      hasCredentials: () => true,
      currentInstanceName: vi.fn().mockResolvedValue(null),
    });
    const res = await service.integration();
    expect(res.data.whatsapp).toEqual({
      configured: true,
      instanceName: null,
      status: 'NOT_CONFIGURED',
      qrCodeBase64: null,
    });
  });

  it('com instância existente: consulta o estado real de conexão', async () => {
    const service = build({
      hasCredentials: () => true,
      currentInstanceName: vi.fn().mockResolvedValue('minha-empresa'),
      connectionState: vi.fn().mockResolvedValue('CONNECTED'),
    });
    const res = await service.integration();
    expect(res.data.whatsapp).toEqual({
      configured: true,
      instanceName: 'minha-empresa',
      status: 'CONNECTED',
      qrCodeBase64: null,
    });
  });

  it('falha ao consultar a EvolutionAPI: DISCONNECTED, nunca lança pro chamador', async () => {
    const service = build({
      hasCredentials: () => true,
      currentInstanceName: vi.fn().mockResolvedValue('minha-empresa'),
      connectionState: vi.fn().mockRejectedValue(new Error('timeout')),
    });
    const res = await service.integration();
    expect(res.data.whatsapp.status).toBe('DISCONNECTED');
  });

  it('CONNECTING: busca o QR atual a cada consulta (bug corrigido 2026-08-18 — sem isso o painel ficava preso sem QR)', async () => {
    const fetchQrCode = vi.fn().mockResolvedValue('data:image/png;base64,live-qr');
    const service = build({
      hasCredentials: () => true,
      currentInstanceName: vi.fn().mockResolvedValue('minha-empresa'),
      connectionState: vi.fn().mockResolvedValue('CONNECTING'),
      fetchQrCode,
    });
    const res = await service.integration();
    expect(fetchQrCode).toHaveBeenCalledWith('minha-empresa');
    expect(res.data.whatsapp.qrCodeBase64).toBe('data:image/png;base64,live-qr');
  });

  it('CONNECTED: não busca QR (não precisa mais)', async () => {
    const fetchQrCode = vi.fn();
    const service = build({
      hasCredentials: () => true,
      currentInstanceName: vi.fn().mockResolvedValue('minha-empresa'),
      connectionState: vi.fn().mockResolvedValue('CONNECTED'),
      fetchQrCode,
    });
    await service.integration();
    expect(fetchQrCode).not.toHaveBeenCalled();
  });

  it('CONNECTING mas fetchQrCode falha: qrCodeBase64 null, nunca lança pro chamador', async () => {
    const service = build({
      hasCredentials: () => true,
      currentInstanceName: vi.fn().mockResolvedValue('minha-empresa'),
      connectionState: vi.fn().mockResolvedValue('CONNECTING'),
      fetchQrCode: vi.fn().mockRejectedValue(new Error('timeout')),
    });
    const res = await service.integration();
    expect(res.data.whatsapp.qrCodeBase64).toBeNull();
  });
});

describe('ControlCenterService.createWhatsappInstance', () => {
  it('rejeita nome de instância fora do contrato (BadRequestException)', async () => {
    const service = build({});
    await expect(service.createWhatsappInstance({ instanceName: 'AB' })).rejects.toThrow();
    await expect(
      service.createWhatsappInstance({ instanceName: 'Nome Com Espaço' }),
    ).rejects.toThrow();
  });

  it('cria a instância e devolve o QR code', async () => {
    const createInstance = vi
      .fn()
      .mockResolvedValue({ status: 'CONNECTING', qrCodeBase64: 'data:image/png;base64,abc' });
    const service = build({ createInstance });
    const result = await service.createWhatsappInstance({ instanceName: 'minha-empresa' });
    expect(createInstance).toHaveBeenCalledWith('minha-empresa');
    expect(result.data.whatsapp).toEqual({
      configured: true,
      instanceName: 'minha-empresa',
      status: 'CONNECTING',
      qrCodeBase64: 'data:image/png;base64,abc',
    });
  });
});
