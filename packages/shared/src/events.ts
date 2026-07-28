import type { Identifier, SemVer, Timestamp } from './types';

export interface BaseEvent<T extends string = string, P = unknown> {
  eventId: Identifier;
  eventType: T;
  timestamp: Timestamp;
  version: SemVer;
  source: string;
  correlationId: Identifier;
  payload: P;
}
