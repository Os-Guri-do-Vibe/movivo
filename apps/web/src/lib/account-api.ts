import { toDashboardAvatarUrl } from './avatar-url';
import { isDashboardRole, type DashboardRole } from './control-center-access';
import { DashboardApiError } from './dashboard-api';

export interface AccountProfile {
  name: string | null;
  email: string | null;
  phoneNumber: string;
  avatarUrl: string | null;
  role: DashboardRole;
}

export interface UpdateAccountProfileInput {
  name?: string;
  phoneNumber?: string;
}

export interface ChangeAccountPasswordInput {
  currentPassword: string;
  newPassword: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseAccountProfile(value: unknown): AccountProfile {
  if (!isRecord(value) || typeof value.phoneNumber !== 'string' || !isDashboardRole(value.role)) {
    throw new DashboardApiError(502, 'A conta devolveu dados em formato inesperado.');
  }
  return {
    name: typeof value.name === 'string' ? value.name : null,
    email: typeof value.email === 'string' ? value.email : null,
    phoneNumber: value.phoneNumber,
    avatarUrl: toDashboardAvatarUrl(typeof value.avatarUrl === 'string' ? value.avatarUrl : null),
    role: value.role,
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`/api/dashboard/account${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    credentials: 'same-origin',
  });
  const value = await readJson(response);
  if (!response.ok) {
    const record = isRecord(value) ? value : {};
    throw new DashboardApiError(
      response.status,
      typeof record.message === 'string'
        ? record.message
        : 'Não foi possível concluir a solicitação.',
      record.issues,
    );
  }
  return value;
}

export async function getAccountProfile(signal?: AbortSignal): Promise<AccountProfile> {
  return parseAccountProfile(await request('/profile', { signal }));
}

export async function updateAccountProfile(
  input: UpdateAccountProfileInput,
): Promise<AccountProfile> {
  return parseAccountProfile(
    await request('/profile', { method: 'PATCH', body: JSON.stringify(input) }),
  );
}

export async function changeAccountPassword(input: ChangeAccountPasswordInput): Promise<void> {
  await request('/password', { method: 'POST', body: JSON.stringify(input) });
}

export async function uploadAccountAvatar(file: File): Promise<AccountProfile> {
  const formData = new FormData();
  formData.append('avatar', file);
  const response = await fetch('/api/dashboard/account/avatar', {
    method: 'POST',
    credentials: 'same-origin',
    body: formData,
  });
  const value = await readJson(response);
  if (!response.ok) {
    const record = isRecord(value) ? value : {};
    throw new DashboardApiError(
      response.status,
      typeof record.message === 'string' ? record.message : 'Não foi possível enviar a foto.',
      record.issues,
    );
  }
  return parseAccountProfile(value);
}
