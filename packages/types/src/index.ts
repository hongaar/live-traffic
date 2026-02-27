import { z } from 'zod';

// Geometry: GeoJSON Point or LineString with optional road reference
export const GeometrySchema = z.union([
  z.object({
    type: z.literal('Point'),
    coordinates: z.tuple([z.number(), z.number()]), // [lon, lat]
  }),
  z.object({
    type: z.literal('LineString'),
    coordinates: z.array(z.tuple([z.number(), z.number()])),
  }),
]);

export type Geometry = z.infer<typeof GeometrySchema>;

// Base event structure
const BaseEventSchema = z.object({
  id: z.string().uuid(),
  source: z.string(), // e.g. "ndw"
  sourceId: z.string(), // external ID from source
  type: z.string(),
  geometry: GeometrySchema,
  timestamp: z.number(), // Unix timestamp in milliseconds
  validFrom: z.number(),
  validTo: z.number(),
  attributes: z.record(z.unknown()), // type-specific metadata
  createdAt: z.number(), // when stored locally
});

// Event types

export const TrafficIncidentSchema = BaseEventSchema.extend({
  type: z.literal('incident'),
  attributes: z.object({
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    description: z.string().optional(),
    category: z.string().optional(), // e.g. "accident", "hazard", "congestion"
  }).passthrough(),
});

export type TrafficIncident = z.infer<typeof TrafficIncidentSchema>;

export const SpeedMeasurementSchema = BaseEventSchema.extend({
  type: z.literal('speed'),
  attributes: z.object({
    speed: z.number(), // km/h
    averageSpeed: z.number().optional(),
    maxSpeed: z.number().optional(),
    minSpeed: z.number().optional(),
    flowRate: z.number().optional(), // vehicles per hour
    occupancy: z.number().optional(), // 0-100 %
  }).passthrough(),
});

export type SpeedMeasurement = z.infer<typeof SpeedMeasurementSchema>;

export const TravelTimeSchema = BaseEventSchema.extend({
  type: z.literal('travel_time'),
  attributes: z.object({
    duration: z.number(), // seconds
    distance: z.number().optional(), // meters
    confidence: z.number().optional(), // 0-100 %
  }).passthrough(),
});

export type TravelTime = z.infer<typeof TravelTimeSchema>;

export const RoadWorkSchema = BaseEventSchema.extend({
  type: z.literal('road_work'),
  attributes: z.object({
    description: z.string().optional(),
    impact: z.enum(['none', 'minor', 'moderate', 'severe']).optional(),
    lanesClosed: z.number().optional(),
    lanesTotal: z.number().optional(),
    scheduledEnd: z.number().optional(), // Unix timestamp
  }).passthrough(),
});

export type RoadWork = z.infer<typeof RoadWorkSchema>;

export const MessageSignSchema = BaseEventSchema.extend({
  type: z.literal('message_sign'),
  attributes: z.object({
    message: z.string().optional(),
    icon: z.string().optional(),
    displayDuration: z.number().optional(), // seconds
  }).passthrough(),
});

export type MessageSign = z.infer<typeof MessageSignSchema>;

export const AnyEventSchema = z.union([
  TrafficIncidentSchema,
  SpeedMeasurementSchema,
  TravelTimeSchema,
  RoadWorkSchema,
  MessageSignSchema,
]);

export type AnyEvent = z.infer<typeof AnyEventSchema>;

// API query types

export const EventQueryParamsSchema = z.object({
  type: z.string().optional(), // filter by event type
  bbox: z
    .string()
    .optional()
    .refine(
      (val) => !val || /^-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*$/.test(val),
      'bbox must be minLon,minLat,maxLon,maxLat'
    ), // minLon,minLat,maxLon,maxLat
  since: z.coerce.number().optional(), // Unix timestamp ms
  until: z.coerce.number().optional(), // Unix timestamp ms
  limit: z.coerce.number().int().positive().default(100),
});

export type EventQueryParams = z.infer<typeof EventQueryParamsSchema>;

export const EventListResponseSchema = z.object({
  events: z.array(AnyEventSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number().optional(),
});

export type EventListResponse = z.infer<typeof EventListResponseSchema>;

// WebSocket message types

export const WSQueryMessageSchema = z.object({
  method: z.literal('query'),
  params: EventQueryParamsSchema,
});

export type WSQueryMessage = z.infer<typeof WSQueryMessageSchema>;

export const WSSubscribeParamsSchema = z.object({
  type: z.string().optional(),
  bbox: z.string().optional(),
});

export const WSSubscribeMessageSchema = z.object({
  method: z.literal('subscribe'),
  params: WSSubscribeParamsSchema,
});

export type WSSubscribeMessage = z.infer<typeof WSSubscribeMessageSchema>;

export const WSUnsubscribeMessageSchema = z.object({
  method: z.literal('unsubscribe'),
});

export type WSUnsubscribeMessage = z.infer<typeof WSUnsubscribeMessageSchema>;

export const WSClientMessageSchema = z.union([
  WSQueryMessageSchema,
  WSSubscribeMessageSchema,
  WSUnsubscribeMessageSchema,
]);

export type WSClientMessage = z.infer<typeof WSClientMessageSchema>;

export const WSQueryResponseSchema = z.object({
  method: z.literal('query_response'),
  data: EventListResponseSchema,
});

export type WSQueryResponse = z.infer<typeof WSQueryResponseSchema>;

export const WSEventMessageSchema = z.object({
  method: z.literal('event'),
  data: AnyEventSchema,
});

export type WSEventMessage = z.infer<typeof WSEventMessageSchema>;

export const WSServerMessageSchema = z.union([
  WSQueryResponseSchema,
  WSEventMessageSchema,
]);

export type WSServerMessage = z.infer<typeof WSServerMessageSchema>;

// Adapter state tracking

export const SourceSchema = z.object({
  id: z.string().uuid(),
  adapterId: z.string(),
  lastFetchAt: z.number().nullable(),
  lastSuccessAt: z.number().nullable(),
  cursor: z.string().nullable(), // for pagination/etag
  errorMessage: z.string().nullable(),
  config: z.record(z.unknown()).default({}),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Source = z.infer<typeof SourceSchema>;

// Data retention config

export const RetentionPolicySchema = z.object({
  type: z.string(), // event type
  ttlDays: z.number().int().positive(),
});

export type RetentionPolicy = z.infer<typeof RetentionPolicySchema>;

export const RetentionConfigSchema = z.object({
  policies: z.array(RetentionPolicySchema),
  defaultTtlDays: z.number().int().positive().default(30),
});

export type RetentionConfig = z.infer<typeof RetentionConfigSchema>;
