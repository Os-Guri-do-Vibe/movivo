import { SetMetadata } from '@nestjs/common';
import type { ControlCenterCapability } from '@movivo/shared';

export const CAPABILITIES_KEY = 'control_center_capabilities';

export const RequireCapabilities = (
  ...capabilities: ControlCenterCapability[]
): MethodDecorator & ClassDecorator => SetMetadata(CAPABILITIES_KEY, capabilities);
