import {
  CAPABILITIES_BY_ROLE,
  type ControlCenterCapability,
  type ControlCenterRole,
} from '@movivo/shared';

/** Mapa fechado e deny-by-default: papel desconhecido não herda capacidade alguma. */
export function capabilitiesForRole(
  role: ControlCenterRole | string,
): readonly ControlCenterCapability[] {
  return CAPABILITIES_BY_ROLE[role as ControlCenterRole] ?? [];
}

export function roleHasCapabilities(
  role: ControlCenterRole | string,
  required: readonly ControlCenterCapability[],
): boolean {
  if (required.length === 0) return false;
  const granted = new Set(capabilitiesForRole(role));
  return required.every((capability) => granted.has(capability));
}
