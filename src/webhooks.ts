import {
  type Chargeback,
  type KnownWebhookEvent,
  type Order,
  type RawBody,
  type Refund,
  type Subscription,
  type VerifyOptions,
  constructWebhookEvent,
} from "@getvatly/sdk";
import {
  type LocalSubscription,
  type Repository,
  type Stored,
  type Wiring,
  required,
} from "./contracts.js";

/** Signed snapshots are authoritative; processing does not make follow-up API requests. */
export class WebhookProcessor {
  constructor(private readonly wiring: Wiring) {
    required(wiring.webhookSecret, "webhookSecret");
    required(wiring.webhookCalls, "webhookCalls");
  }
  async handle(raw: RawBody, signature: string | null, options?: VerifyOptions) {
    const event = await constructWebhookEvent(
      raw,
      signature,
      required(this.wiring.webhookSecret, "webhookSecret"),
      options,
    );
    return required(this.wiring.webhookCalls, "webhookCalls").process(event, async () => {
      if (event.known) await this.react(event);
      for (const reaction of this.wiring.additionalWebhookReactions ?? [])
        if (reaction.supports(event)) await reaction.handle(event);
      await this.wiring.events?.dispatch(event);
    });
  }
  async handleRequest(request: Request, options?: VerifyOptions) {
    return this.handle(await request.text(), request.headers.get("Vatly-Signature"), options);
  }
  private async owner(customerId: string | null): Promise<string | null> {
    if (!customerId || !this.wiring.bindings) return null;
    await this.wiring.bindings.record(customerId);
    return this.wiring.bindings.hostCustomerIdFor(customerId);
  }
  private async persist<T extends { id: string; customerId: string | null }>(
    repository: Repository<Stored<T>>,
    object: T,
  ) {
    const existing = await repository.findByVatlyId(object.id);
    if (existing)
      return {
        created: false,
        record: await repository.update(object.id, {
          ...object,
          hostCustomerId: existing.hostCustomerId,
        }),
      };
    const record = await repository.store({
      ...object,
      hostCustomerId: await this.owner(object.customerId),
    });
    return { created: record !== null, record };
  }
  private async react(event: KnownWebhookEvent): Promise<void> {
    switch (event.eventName) {
      case "subscription.started": {
        if (!this.wiring.subscriptions) break;
        const s = event.object;
        const existing = await this.wiring.subscriptions.findByVatlyId(s.id);
        if (existing) {
          await this.wiring.subscriptions.update(s.id, this.subscriptionFields(s));
        } else {
          const record = await this.wiring.subscriptions.store({
            ...s,
            endsAt: s.endedAt ?? s.canceledAt,
            hostCustomerId: await this.owner(s.customerId),
          });
          if (record)
            await this.wiring.events?.dispatch({
              known: true,
              eventName: "local.subscription_created",
              object: record,
            });
        }
        break;
      }
      case "subscription.updated":
      case "subscription.billing_updated":
      case "subscription.resumed":
      case "subscription.canceled_immediately":
      case "subscription.canceled_with_grace_period":
      case "subscription.canceled_for_nonpayment":
      case "subscription.cancellation_grace_period_completed": {
        const repository = this.wiring.subscriptions;
        const s = event.object;
        if (!repository || !(await repository.findByVatlyId(s.id))) break;
        let fields: Partial<LocalSubscription> = this.subscriptionFields(s);
        if (event.eventName === "subscription.resumed") fields = { ...fields, endsAt: null };
        if (
          event.eventName.startsWith("subscription.canceled") ||
          event.eventName === "subscription.cancellation_grace_period_completed"
        )
          fields = {
            ...fields,
            endsAt: s.endedAt ?? s.canceledAt,
            cancellationReason: s.cancellationReason,
          };
        await repository.update(s.id, fields);
        break;
      }
      case "order.paid":
      case "order.payment_failed": {
        if (!this.wiring.orders) break;
        const result = await this.persist<Order>(this.wiring.orders, event.object);
        if (result.created && result.record && event.eventName === "order.paid")
          await this.wiring.events?.dispatch({
            known: true,
            eventName: "local.order_created",
            object: result.record,
          });
        break;
      }
      case "order.canceled": {
        const repository = this.wiring.orders;
        if (repository && (await repository.findByVatlyId(event.object.id)))
          await repository.update(event.object.id, {
            status: event.object.status,
            cancellationReason: event.object.cancellationReason,
          });
        break;
      }
      case "refund.completed":
      case "refund.failed":
      case "refund.canceled":
        if (this.wiring.refunds) await this.persist<Refund>(this.wiring.refunds, event.object);
        break;
      case "order.chargeback_received":
      case "order.chargeback_reversed":
        if (this.wiring.chargebacks)
          await this.persist<Chargeback>(this.wiring.chargebacks, event.object);
        break;
      // Scheduled changes, catalog, checkout and setup events are dispatch-only.
    }
  }
  private subscriptionFields(s: Subscription): Partial<LocalSubscription> {
    return {
      subscriptionPlanId: s.subscriptionPlanId,
      name: s.name,
      quantity: s.quantity,
      status: s.status,
      ...(s.mandate ? { mandate: s.mandate } : {}),
    };
  }
}
