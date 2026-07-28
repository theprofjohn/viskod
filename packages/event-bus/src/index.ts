import type { BaseEvent, Identifier, Result } from '@viskod/shared';
import { ErrorCategory, ErrorSeverity, err, ok } from '@viskod/shared';
import type { ViskodError } from '@viskod/shared';

// ---- Types ----

export type EventHandler<T extends BaseEvent = BaseEvent> = (event: T) => Promise<void> | void;

export interface SubscribeOptions {
  filter?: (event: BaseEvent) => boolean;
  priority?: number;
  once?: boolean;
}

export interface Subscription {
  id: string;
  eventType: string;
  createdAt: string;
}

export interface EventBusOptions {
  maxQueueSize?: number;
  deliveryTimeout?: number;
  errorStrategy?: 'continue' | 'pause-subscriber';
  enableHistory?: boolean;
  historySize?: number;
}

export interface EventBusDiagnostics {
  totalPublished: number;
  totalDelivered: number;
  totalFailed: number;
  activeSubscriptions: number;
  queueSize: number;
  subscriberStats: Map<string, { delivered: number; failed: number; lastDeliveryMs: number }>;
}

type SubscriberEntry = {
  handler: EventHandler;
  options: Required<Omit<SubscribeOptions, 'once'>> & { once: boolean };
  subscription: Subscription;
  paused: boolean;
  delivered: number;
  failed: number;
  lastDeliveryMs: number;
};

// ---- EventBus Implementation ----

export class EventBus {
  private subscribers = new Map<string, SubscriberEntry[]>();
  private totalPublished = 0;
  private totalDelivered = 0;
  private totalFailed = 0;
  private state: 'created' | 'active' | 'draining' | 'stopped' = 'created';
  private history: BaseEvent[] = [];
  private options: Required<EventBusOptions>;

  constructor(options: EventBusOptions = {}) {
    this.options = {
      maxQueueSize: options.maxQueueSize ?? 10000,
      deliveryTimeout: options.deliveryTimeout ?? 5000,
      errorStrategy: options.errorStrategy ?? 'continue',
      enableHistory: options.enableHistory ?? false,
      historySize: options.historySize ?? 100,
    };
    this.state = 'active';
  }

  publish<T extends BaseEvent>(event: T): Result<void> {
    if (this.state === 'stopped') {
      return err(this.busError('EB_BUS_STOPPED', 'Event bus is stopped'));
    }

    if (!event.eventType || !event.eventId) {
      return err(this.busError('EB_PUBLISH_INVALID', 'Event missing required fields'));
    }

    this.totalPublished++;

    if (this.options.enableHistory) {
      this.history.push(event as BaseEvent);
      if (this.history.length > this.options.historySize) {
        this.history.shift();
      }
    }

    const entries = this.subscribers.get(event.eventType) ?? [];
    const toRemove: string[] = [];
    for (const entry of entries) {
      if (entry.paused) continue;
      if (entry.options.filter && !entry.options.filter(event as BaseEvent)) continue;

      entry.delivered++;
      this.totalDelivered++;
      entry.lastDeliveryMs = Date.now();

      if (entry.options.once) {
        toRemove.push(entry.subscription.id);
      }

      try {
        const result = entry.handler(event as unknown as Parameters<typeof entry.handler>[0]);
        if (result instanceof Promise) {
          // Fire-and-forget with timeout
          void Promise.race([
            result,
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error('Delivery timeout')), this.options.deliveryTimeout),
            ),
          ]).catch(() => {
            entry.failed++;
            this.totalFailed++;
            if (this.options.errorStrategy === 'pause-subscriber') {
              entry.paused = true;
            }
          });
        }
      } catch {
        entry.failed++;
        this.totalFailed++;
        if (this.options.errorStrategy === 'pause-subscriber') {
          entry.paused = true;
        }
      }
    }

    // Remove once subscribers after delivery
    for (const id of toRemove) {
      this.unsubscribe(id);
    }

    return ok(undefined);
  }

  subscribe<T extends BaseEvent>(
    eventType: string,
    handler: EventHandler<T>,
    options: SubscribeOptions = {},
  ): Result<Subscription> {
    if (this.state === 'stopped') {
      return err(this.busError('EB_BUS_STOPPED', 'Event bus is stopped'));
    }

    const subscription: Subscription = {
      id: crypto.randomUUID(),
      eventType,
      createdAt: new Date().toISOString(),
    };

    const entry: SubscriberEntry = {
      handler: handler as EventHandler,
      options: {
        filter: options.filter ?? (() => true),
        priority: options.priority ?? 0,
        once: options.once ?? false,
      },
      subscription,
      paused: false,
      delivered: 0,
      failed: 0,
      lastDeliveryMs: 0,
    };

    const existing = this.subscribers.get(eventType) ?? [];
    existing.push(entry);
    existing.sort((a, b) => b.options.priority - a.options.priority);
    this.subscribers.set(eventType, existing);

    return ok(subscription);
  }

  unsubscribe(subscriptionId: Identifier): Result<void> {
    for (const [eventType, entries] of this.subscribers) {
      const index = entries.findIndex((e) => e.subscription.id === subscriptionId);
      if (index !== -1) {
        entries.splice(index, 1);
        if (entries.length === 0) {
          this.subscribers.delete(eventType);
        }
        return ok(undefined);
      }
    }
    return ok(undefined); // idempotent
  }

  getDiagnostics(): EventBusDiagnostics {
    const subscriberStats = new Map<
      string,
      { delivered: number; failed: number; lastDeliveryMs: number }
    >();
    for (const entries of this.subscribers.values()) {
      for (const entry of entries) {
        subscriberStats.set(entry.subscription.id, {
          delivered: entry.delivered,
          failed: entry.failed,
          lastDeliveryMs: entry.lastDeliveryMs,
        });
      }
    }
    return {
      totalPublished: this.totalPublished,
      totalDelivered: this.totalDelivered,
      totalFailed: this.totalFailed,
      activeSubscriptions: this.subscribers.size,
      queueSize: 0, // in-process, no queuing
      subscriberStats,
    };
  }

  async drain(): Promise<void> {
    this.state = 'draining';
    // In-process: all deliveries are synchronous, drain is immediate
    this.state = 'stopped';
  }

  stop(): void {
    this.state = 'stopped';
    this.subscribers.clear();
  }

  getState(): string {
    return this.state;
  }

  // NEVER owns business logic — only transport
  private busError(code: string, message: string): ViskodError {
    return {
      code,
      category: ErrorCategory.RUNTIME,
      severity: ErrorSeverity.RECOVERABLE,
      message,
      correlationId: crypto.randomUUID(),
      subsystem: 'event-bus',
      timestamp: new Date().toISOString(),
    };
  }
}
