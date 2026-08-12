import type { ProtocolStructure } from '@movivo/shared';

export type { DashboardCapability, DashboardRole } from './control-center-access';
export type QueueKind = 'PROTOCOL' | 'HANDOFF' | 'PARQ' | 'CHECKIN';
export type QueueSeverity = 'SAFETY' | 'ALERT' | 'ROUTINE';

export interface QueueItem {
  id: string;
  kind: QueueKind;
  severity: QueueSeverity;
  createdAt: string;
  ageMinutes: number;
  title: string;
  summary: string;
  status: string;
}

export interface QueueResponse {
  items: QueueItem[];
  counts: Record<string, number>;
}

export interface ReplayMessage {
  role: 'USER' | 'ASSISTANT' | 'PROFESSIONAL' | 'SYSTEM';
  content: string;
  createdAt: string;
}

export interface AnonymizedReplay {
  conversationId: string;
  startedAt: string;
  messages: ReplayMessage[];
}

export interface ProtocolDetail {
  id: string;
  version: number;
  status: string;
  approvalStatus: string;
  content: ProtocolStructure;
  signedAt: string | null;
  signatureHash: string | null;
  validation?: { valid: boolean; issues: string[] };
}

export interface QueueDetail {
  item: QueueItem;
  context: Record<string, string | number | boolean | null>;
  protocol?: ProtocolDetail;
  replay?: AnonymizedReplay;
  parq?: { flags: string[]; state: string };
  handoff?: { reason: string; level: string; status: string };
}

export interface OperationsResponse {
  funnel: {
    formStarted: number;
    protocolSent: number;
    firstWorkout: number | null;
    converted: number;
  };
  sla: {
    protocolDeliveryMinutes: number | null;
    coachP95Seconds: number | null;
    protocolBreached: boolean;
    coachBreached: boolean;
  };
  replays: AnonymizedReplay[];
}

export interface ActionResult {
  message?: string;
  status?: string;
  validation?: { valid?: boolean; issues?: unknown[] };
}
