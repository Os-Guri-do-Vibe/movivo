'use client';

/**
 * Painel "Sistema → Integração" (EvolutionAPI) — ferramenta INTERNA de teste do fluxo
 * de WhatsApp via QR Code/Baileys (protocolo não-oficial), usada enquanto a criação de
 * templates do BSP oficial está bloqueada. **Nunca** é o canal de produção dos usuários
 * finais — esse continua 100% o BSP já integrado no módulo `whatsapp/` do backend.
 *
 * Sem tabela própria: o estado (instância existe? conectada?) vem sempre ao vivo da
 * EvolutionAPI via `GET .../integration` — por isso faz polling a cada 3s enquanto
 * `CONNECTING`, mesmo espírito do fallback de polling já usado em `queue-board.tsx`.
 */
import { CircleHelp, MessageSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ControlCenterIntegrationResponse, EvolutionConnectionState } from '@movivo/shared';

import { Button } from '@/components/ui/button';
import { createWhatsappInstance, getIntegration } from '@/lib/control-center-api';
import { cn } from '@/lib/utils';

import { ResourceState, SectorHeader, useControlCenterResource } from './control-center-ui';

const POLL_INTERVAL_MS = 3_000;

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-body focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none';

const STATUS_LABEL: Record<EvolutionConnectionState, string> = {
  NOT_CONFIGURED: 'Não configurado',
  CONNECTING: 'Conectando…',
  CONNECTED: 'Conectado',
  DISCONNECTED: 'Desconectado',
};

function StatusBadge({ status }: { status: EvolutionConnectionState }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold',
        status === 'CONNECTED' && 'bg-accent text-accent-foreground',
        status === 'CONNECTING' && 'bg-secondary text-secondary-foreground',
        (status === 'NOT_CONFIGURED' || status === 'DISCONNECTED') &&
          'border border-border text-muted-foreground',
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function IntegrationDashboard() {
  const { data, error, forbidden, loading, refresh } = useControlCenterResource(getIntegration);
  const [instanceNameInput, setInstanceNameInput] = useState('minha-empresa');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  // Estado otimista logo após criar: a resposta do POST já tem o QR code de verdade,
  // não precisa esperar o próximo GET. Vale até o próximo `refresh()` (poll) trazer
  // dado novo do backend — aí o dado real assume, sem risco de mostrar um estado
  // desatualizado (`data` só muda de referência quando um `refresh()` de fato resolve).
  const [override, setOverride] = useState<ControlCenterIntegrationResponse['data']['whatsapp'] | null>(
    null,
  );
  useEffect(() => {
    if (data) setOverride(null);
  }, [data]);

  const whatsapp = override ?? data?.data.whatsapp;
  const status = whatsapp?.status ?? 'NOT_CONFIGURED';

  // Polling: só enquanto aguarda o scan. Some assim que sai de CONNECTING (conectou,
  // desconectou, ou a página é desmontada).
  useEffect(() => {
    if (status !== 'CONNECTING') return;
    const id = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [status, refresh]);

  async function handleCreate() {
    setCreating(true);
    setCreateError('');
    try {
      const response = await createWhatsappInstance({ instanceName: instanceNameInput });
      setOverride(response.data.whatsapp);
    } catch (caught) {
      setCreateError(
        caught instanceof Error ? caught.message : 'Não foi possível criar a instância.',
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <section aria-labelledby="integration-title">
      <SectorHeader
        title="Integração"
        description="Ferramenta interna de teste do fluxo de WhatsApp — não é o canal de produção dos usuários finais."
        meta={data?.meta}
        refreshing={loading}
        onRefresh={() => void refresh()}
      />
      <ResourceState loading={loading} error={error} forbidden={forbidden} onRetry={() => void refresh()} />

      {!loading && !error && whatsapp ? (
        <div className="mt-6 max-w-2xl rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <MessageSquare aria-hidden="true" className="size-5 text-muted-foreground" />
                <h2 className="text-h3 font-semibold">WhatsApp</h2>
                <CircleHelp aria-hidden="true" className="size-4 text-muted-foreground" />
              </div>
              <p className="mt-1 text-label text-muted-foreground">
                Escaneie o QR Code para conectar
              </p>
            </div>
            <StatusBadge status={status} />
          </div>

          {status !== 'CONNECTED' ? (
            <div className="mt-4 rounded-lg border border-border bg-secondary p-4">
              <p className="text-label font-semibold">Como configurar:</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-label text-muted-foreground">
                <li>Escolha um nome único para sua instância (ex: minha-empresa)</li>
                <li>Clique em Criar Instância e aguarde o QR Code</li>
                <li>Escaneie o QR Code com o WhatsApp do número desejado</li>
              </ol>
            </div>
          ) : null}

          {status === 'NOT_CONFIGURED' || status === 'DISCONNECTED' ? (
            <div className="mt-4">
              <label className="text-label font-semibold" htmlFor="instanceName">
                Nome da instância
              </label>
              <div className="mt-1 flex flex-wrap gap-3">
                <input
                  id="instanceName"
                  className={cn(INPUT_CLASS, 'mt-0 flex-1')}
                  value={instanceNameInput}
                  placeholder="minha-empresa"
                  maxLength={50}
                  disabled={creating}
                  onChange={(event) => setInstanceNameInput(event.target.value)}
                />
                <Button onClick={() => void handleCreate()} disabled={creating || !instanceNameInput.trim()}>
                  {creating ? 'Criando…' : 'Criar Instância'}
                </Button>
              </div>
              {createError ? (
                <p role="alert" className="mt-2 text-xs text-coral">
                  {createError}
                </p>
              ) : null}
            </div>
          ) : null}

          {status === 'CONNECTING' && whatsapp?.qrCodeBase64 ? (
            <div className="mt-4 flex flex-col items-center gap-3 rounded-lg border border-border bg-secondary p-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- base64 dinâmico, sem otimização de imagem cabível aqui */}
              <img
                src={whatsapp.qrCodeBase64}
                alt="QR Code para conectar o WhatsApp"
                className="size-56"
              />
              <p className="text-label text-muted-foreground">
                Aguardando leitura — atualiza sozinho a cada poucos segundos.
              </p>
            </div>
          ) : null}

          {status === 'CONNECTED' ? (
            <p className="mt-4 rounded-lg border border-border bg-secondary p-3 text-label">
              Instância <span className="font-mono">{whatsapp.instanceName}</span> conectada.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
