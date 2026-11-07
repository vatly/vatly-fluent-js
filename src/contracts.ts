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
  | { eventName: "local.order_created"; object: Stored<Order> }
  | { eventName: "local.subscription_created"; object: LocalSubscription };
export interface EventDispatcher {
  dispatch(event: DomainEvent): Awaitable<void>;
}
export interface WebhookReaction {
  supports(event: VatlyWebhookEvent): boolean;
  handle(event: VatlyWebhookEvent): Awaitable<void>;
}
export interface WebhookCalls {
  /**
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
