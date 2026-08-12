import {
  controlCenterComplianceResponseSchema,
  controlCenterFinanceResponseSchema,
  controlCenterMarketingResponseSchema,
  controlCenterOverviewResponseSchema,
  controlCenterStudentDetailResponseSchema,
  controlCenterStudentsResponseSchema,
  controlCenterSupportResponseSchema,
  controlCenterSystemResponseSchema,
  type ControlCenterComplianceResponse,
  type ControlCenterFinanceResponse,
  type ControlCenterMarketingResponse,
  type ControlCenterOverviewResponse,
  type ControlCenterStudentDetailResponse,
  type ControlCenterStudentsResponse,
  type ControlCenterSupportResponse,
  type ControlCenterSystemResponse,
} from '@movivo/shared';

interface Parser<T> {
  parse(value: unknown): T;
}

export class ControlCenterApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function request<T>(path: string, schema: Parser<T>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/dashboard/control/${path}`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal,
  });
  const value = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      isRecord(value) && typeof value.message === 'string'
        ? value.message
        : response.status === 403
          ? 'Seu papel não pode acessar este setor.'
          : 'Não foi possível carregar este setor.';
    throw new ControlCenterApiError(response.status, message);
  }
  try {
    return schema.parse(value);
  } catch {
    throw new ControlCenterApiError(502, 'O setor devolveu dados fora do contrato esperado.');
  }
}

export const parseControlCenterOverview = (value: unknown) =>
  controlCenterOverviewResponseSchema.parse(value);
export const parseControlCenterMarketing = (value: unknown) =>
  controlCenterMarketingResponseSchema.parse(value);
export const parseControlCenterStudents = (value: unknown) =>
  controlCenterStudentsResponseSchema.parse(value);
export const parseControlCenterStudent = (value: unknown) =>
  controlCenterStudentDetailResponseSchema.parse(value);
export const parseControlCenterSystem = (value: unknown) =>
  controlCenterSystemResponseSchema.parse(value);
export const parseControlCenterFinance = (value: unknown) =>
  controlCenterFinanceResponseSchema.parse(value);
export const parseControlCenterSupport = (value: unknown) =>
  controlCenterSupportResponseSchema.parse(value);
export const parseControlCenterCompliance = (value: unknown) =>
  controlCenterComplianceResponseSchema.parse(value);

export function getOverview(signal?: AbortSignal): Promise<ControlCenterOverviewResponse> {
  return request('overview', controlCenterOverviewResponseSchema, signal);
}

export function getMarketing(signal?: AbortSignal): Promise<ControlCenterMarketingResponse> {
  return request('marketing', controlCenterMarketingResponseSchema, signal);
}

export function getStudents(signal?: AbortSignal): Promise<ControlCenterStudentsResponse> {
  return request('students', controlCenterStudentsResponseSchema, signal);
}

export function getStudent(
  id: string,
  signal?: AbortSignal,
): Promise<ControlCenterStudentDetailResponse> {
  return request(
    `students/${encodeURIComponent(id)}`,
    controlCenterStudentDetailResponseSchema,
    signal,
  );
}

export function getSystemSummary(signal?: AbortSignal): Promise<ControlCenterSystemResponse> {
  return request('system', controlCenterSystemResponseSchema, signal);
}

export function getFinanceSummary(signal?: AbortSignal): Promise<ControlCenterFinanceResponse> {
  return request('finance', controlCenterFinanceResponseSchema, signal);
}

export function getSupportSummary(signal?: AbortSignal): Promise<ControlCenterSupportResponse> {
  return request('support', controlCenterSupportResponseSchema, signal);
}

export function getComplianceSummary(
  signal?: AbortSignal,
): Promise<ControlCenterComplianceResponse> {
  return request('compliance', controlCenterComplianceResponseSchema, signal);
}
