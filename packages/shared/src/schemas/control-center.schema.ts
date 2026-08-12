import { z } from 'zod';

import { ControlCenterCapability, ControlCenterRole } from '../enums/control-center';

const roleValues = Object.values(ControlCenterRole) as [ControlCenterRole, ...ControlCenterRole[]];
const capabilityValues = Object.values(ControlCenterCapability) as [
  ControlCenterCapability,
  ...ControlCenterCapability[],
];

export const controlCenterRoleSchema = z.enum(roleValues);
export const controlCenterCapabilitySchema = z.enum(capabilityValues);

export const dataAvailabilitySchema = z.enum(['AVAILABLE', 'PROXY', 'UNAVAILABLE']);
export type DataAvailability = z.infer<typeof dataAvailabilitySchema>;

export const controlCenterMetricSchema = z.object({
  value: z.number().finite().nullable(),
  unit: z.enum(['COUNT', 'PERCENT', 'BRL', 'MILLISECONDS', 'MINUTES']),
  status: dataAvailabilitySchema,
  definition: z.string().min(1),
});
export type ControlCenterMetric = z.infer<typeof controlCenterMetricSchema>;

export const controlCenterMetaSchema = z.object({
  generatedAt: z.iso.datetime(),
  timezone: z.literal('America/Sao_Paulo'),
  dataQuality: z.array(z.string()),
});

export const controlCenterSessionSchema = z.object({
  userId: z.uuid(),
  role: controlCenterRoleSchema,
  capabilities: z.array(controlCenterCapabilitySchema),
});
export type ControlCenterSession = z.infer<typeof controlCenterSessionSchema>;

export const controlCenterOverviewResponseSchema = z.object({
  data: z.object({
    activeSubscriptions: controlCenterMetricSchema,
    trials: controlCenterMetricSchema,
    contractedMrr: controlCenterMetricSchema,
    northStar: controlCenterMetricSchema,
    criticalAlerts: controlCenterMetricSchema,
  }),
  meta: controlCenterMetaSchema,
});
export type ControlCenterOverviewResponse = z.infer<typeof controlCenterOverviewResponseSchema>;

export const marketingSegmentSchema = z.object({
  dimension: z.enum(['PRIMARY_GOAL', 'TRAINING_LOCATION', 'PREFERRED_PERIOD']),
  value: z.string(),
  count: z.number().int().nonnegative().min(10),
});

export const controlCenterMarketingResponseSchema = z.object({
  data: z.object({
    funnel: z.object({
      formStarted: controlCenterMetricSchema,
      formSubmitted: controlCenterMetricSchema,
      protocolActive: controlCenterMetricSchema,
      subscriptionActive: controlCenterMetricSchema,
    }),
    acquisition: controlCenterMetricSchema,
    segments: z.array(marketingSegmentSchema),
    suppressedSegments: z.number().int().nonnegative(),
    minimumSegmentSize: z.literal(10),
  }),
  meta: controlCenterMetaSchema,
});
export type ControlCenterMarketingResponse = z.infer<typeof controlCenterMarketingResponseSchema>;

const nullableText = z.string().nullable();

export const controlCenterStudentSummarySchema = z.object({
  id: z.uuid(),
  name: nullableText,
  email: nullableText,
  phoneNumber: z.string(),
  status: z.string(),
  subscriptionStatus: nullableText,
  protocolStatus: nullableText,
});

export const controlCenterStudentsResponseSchema = z.object({
  data: z.object({ students: z.array(controlCenterStudentSummarySchema) }),
  meta: controlCenterMetaSchema,
});
export type ControlCenterStudentsResponse = z.infer<typeof controlCenterStudentsResponseSchema>;

export const controlCenterStudentDetailResponseSchema = z.object({
  data: z.object({
    student: controlCenterStudentSummarySchema.extend({
      requiresProfessionalReview: z.boolean(),
      anamnesisStatus: nullableText,
      parqState: nullableText,
      currentProtocol: z
        .object({
          id: z.uuid(),
          version: z.number().int().positive(),
          currentWeek: z.number().int().positive(),
          totalWeeks: z.number().int().positive(),
          signedAt: z.iso.datetime().nullable(),
        })
        .nullable(),
      routine: z
        .object({
          primaryGoal: nullableText,
          trainingStatus: nullableText,
          experience: nullableText,
          daysPerWeek: z.number().int().nullable(),
          preferredDays: z.array(z.string()),
          sessionDuration: nullableText,
          location: nullableText,
          preferredPeriod: nullableText,
        })
        .nullable(),
      workoutHistory: z.object({
        status: z.literal('UNAVAILABLE'),
        reason: z.string(),
      }),
    }),
  }),
  meta: controlCenterMetaSchema,
});
export type ControlCenterStudentDetailResponse = z.infer<
  typeof controlCenterStudentDetailResponseSchema
>;

export const controlCenterSystemResponseSchema = z.object({
  data: z.object({
    databaseLatency: controlCenterMetricSchema,
    redisLatency: controlCenterMetricSchema,
    aiJobs: controlCenterMetricSchema,
    aiFailures: controlCenterMetricSchema,
    aiDlq: controlCenterMetricSchema,
    aiAverageLatency: controlCenterMetricSchema,
    whatsappDeliveryCost: controlCenterMetricSchema,
    infrastructureCost: controlCenterMetricSchema,
  }),
  meta: controlCenterMetaSchema,
});
export type ControlCenterSystemResponse = z.infer<typeof controlCenterSystemResponseSchema>;

export const controlCenterFinanceResponseSchema = z.object({
  data: z.object({
    activeSubscriptions: controlCenterMetricSchema,
    contractedMrr: controlCenterMetricSchema,
    aiCost: controlCenterMetricSchema,
    whatsappCost: controlCenterMetricSchema,
    infrastructureCost: controlCenterMetricSchema,
    receivedRevenue: controlCenterMetricSchema,
  }),
  meta: controlCenterMetaSchema,
});
export type ControlCenterFinanceResponse = z.infer<typeof controlCenterFinanceResponseSchema>;

export const controlCenterSupportResponseSchema = z.object({
  data: z.object({
    customers: z.array(
      controlCenterStudentSummarySchema.pick({
        id: true,
        name: true,
        email: true,
        phoneNumber: true,
        status: true,
        subscriptionStatus: true,
      }),
    ),
  }),
  meta: controlCenterMetaSchema,
});
export type ControlCenterSupportResponse = z.infer<typeof controlCenterSupportResponseSchema>;

export const controlCenterAuditEventSchema = z.object({
  id: z.number().int().nonnegative(),
  actorId: z.uuid(),
  subjectId: z.uuid(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.uuid(),
  createdAt: z.iso.datetime(),
});

export const controlCenterComplianceResponseSchema = z.object({
  data: z.object({
    activeConsents: controlCenterMetricSchema,
    revokedConsents: controlCenterMetricSchema,
    auditedHealthReads: controlCenterMetricSchema,
    privacyRequests: controlCenterMetricSchema,
    recentAuditEvents: z.array(controlCenterAuditEventSchema),
  }),
  meta: controlCenterMetaSchema,
});
export type ControlCenterComplianceResponse = z.infer<typeof controlCenterComplianceResponseSchema>;

export const destructiveActionDeniedSchema = z.object({
  code: z.literal('STEP_UP_REQUIRED_NOT_IMPLEMENTED'),
  status: z.literal('UNAVAILABLE'),
  message: z.string(),
});
export type DestructiveActionDenied = z.infer<typeof destructiveActionDeniedSchema>;
