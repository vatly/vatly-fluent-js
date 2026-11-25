import type {
  Chargeback,
  Customer,
  Order,
  Refund,
  Subscription,
  VatlyClient,
  VatlyWebhookEvent,
} from "@getvatly/sdk";

export type Awaitable<T> = T | Promise<T>;
export interface CustomerProfile {
  vatlyId?: string;
  email?: Customer["email"];
  name?: Customer["name"];
}

/** Implement bind atomically with unique constraints on BOTH sides; never silently reassign. */
export interface CustomerBindings {
  bind(vatlyId: string, hostId: string): Awaitable<void>;
  record(vatlyId: string): Awaitable<void>;
  vatlyCustomerIdFor(hostId: string): Awaitable<string | null>;
  hostCustomerIdFor(vatlyId: string): Awaitable<string | null>;
}

export type Stored<T> = T & { hostCustomerId: string | null };
export type LocalSubscription = Stored<Subscription> & { endsAt: string | null };
export interface Reader<T> {
  findByVatlyId(id: string): Awaitable<T | null>;
}
export interface Writer<T> {
  /** Return null if the host deliberately declines to persist. Unique resource id required. */
  store(data: T): Awaitable<T | null>;
  /** undefined means unchanged; null explicitly clears a nullable field. */
  update(id: string, data: Partial<T>): Awaitable<T>;
}
export interface Repository<T> extends Reader<T>, Writer<T> {}
export interface ReversalRepository<T> extends Repository<Stored<T>> {
  listForOrder(id: string): Awaitable<Stored<T>[]>;
  listForCustomer(id: string): Awaitable<Stored<T>[]>;
}
export type DomainEvent =
  | VatlyWebhookEvent
  | { known: true; eventName: "local.order_created"; object: Stored<Order> }
  | { known: true; eventName: "local.subscription_created"; object: LocalSubscription };
export interface EventDispatcher {
  dispatch(event: DomainEvent): Awaitable<void>;
}
export interface WebhookReaction {
  supports(event: VatlyWebhookEvent): boolean;
  handle(event: VatlyWebhookEvent): Awaitable<void>;
}
export interface WebhookCalls {
  /**
   * Retain the verified envelope (including unsupported events) for audit/triage.
   * Run work and mark signed event.id processed atomically, in the same transaction
   * as the wired repositories. Return false for an already committed id. Roll back
   * on failure so delivery retries can finish. Use an outbox for external effects.
   */
  process(event: VatlyWebhookEvent, work: () => Promise<void>): Promise<boolean>;
}
export interface Wiring {
  api: VatlyClient;
  redirectUrlSuccess?: string;
  redirectUrlCanceled?: string;
  webhookSecret?: string | readonly string[];
  bindings?: CustomerBindings;
  subscriptions?: Repository<LocalSubscription>;
  orders?: Repository<Stored<Order>>;
  refunds?: ReversalRepository<Refund>;
  chargebacks?: ReversalRepository<Chargeback>;
  webhookCalls?: WebhookCalls;
  events?: EventDispatcher;
  additionalWebhookReactions?: readonly WebhookReaction[];
}

export class FluentError extends Error {
  override name = "FluentError";
}
export function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new FluentError(`Missing wiring: ${name}`);
  return value;
}

/** Rejects metadata the API would answer with 422, before any request is sent. */
export function assertMetadata(metadata: unknown): void {
  if (metadata === undefined || metadata === null) return;
  if (typeof metadata !== "object" || Array.isArray(metadata))
    throw new FluentError("Metadata must be an object of string values.");
  const entries = Object.entries(metadata);
  if (entries.length > 50) throw new FluentError("Metadata allows at most 50 keys.");
  for (const [key, value] of entries) {
    if (key.length > 40) throw new FluentError(`Metadata key "${key}" exceeds 40 characters.`);
    if (typeof value !== "string")
      throw new FluentError(`Metadata value for "${key}" must be a string.`);
    if (value.length > 500)
      throw new FluentError(`Metadata value for "${key}" exceeds 500 characters.`);
  }
}

/** PHP's endsAt-based predicates; not a substitute for Vatly's status field. */
export function subscriptionState(endsAt: string | null, now = Date.now()) {
  const cancelled = endsAt !== null;
  const onGracePeriod = cancelled && Date.parse(endsAt) > now;
  return {
    cancelled,
    onGracePeriod,
    active: !cancelled || onGracePeriod,
    valid: !cancelled || onGracePeriod,
    recurring: !cancelled,
    ended: cancelled && !onGracePeriod,
  };
}
