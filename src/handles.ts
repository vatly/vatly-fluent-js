import {
  type Order,
  type RequestOptions,
  type UpdateSubscriptionBillingRequest,
  type UpdateSubscriptionRequest,
  toMinorUnits,
} from "@getvatly/sdk";
import { type LocalSubscription, type Wiring, required, subscriptionState } from "./contracts.js";

export class SubscriptionHandle {
  constructor(
    private readonly wiring: Wiring,
    private record: LocalSubscription,
  ) {}
  model() {
    return this.record;
  }
  state(now = Date.now()) {
    return subscriptionState(this.record.endsAt, now);
  }
  private async updateLocal(data: Partial<LocalSubscription>): Promise<this> {
    this.record = await required(this.wiring.subscriptions, "subscriptions").update(
      this.record.id,
      data,
    );
    return this;
  }
  async swap(
    planId: string,
    body: Omit<UpdateSubscriptionRequest, "subscriptionPlanId"> = {},
    opts?: RequestOptions,
  ) {
    const response = await this.wiring.api.subscriptions.update(
      this.record.id,
      { ...body, subscriptionPlanId: planId },
      opts,
    );
    return this.updateLocal({
      subscriptionPlanId: response.subscriptionPlanId,
      quantity: response.quantity,
    });
  }
  swapAndInvoice(
    planId: string,
    body: Omit<UpdateSubscriptionRequest, "subscriptionPlanId"> = {},
    opts?: RequestOptions,
  ) {
    return this.swap(planId, { ...body, applyImmediately: true, invoiceImmediately: true }, opts);
  }
  swapWithoutCharge(
    planId: string,
    body: Omit<UpdateSubscriptionRequest, "subscriptionPlanId"> = {},
    opts?: RequestOptions,
  ) {
    return this.swap(planId, { ...body, applyImmediately: true, prorationCharge: false }, opts);
  }
  async resume(opts?: RequestOptions) {
    const response = await this.wiring.api.subscriptions.resume(this.record.id, opts);
    return this.updateLocal({ ...response, endsAt: null });
  }
  cancel(opts?: RequestOptions & { immediately?: boolean }) {
    return this.wiring.api.subscriptions.cancel(this.record.id, opts);
  }
  async sync() {
    const response = await this.wiring.api.subscriptions.get(this.record.id);
    return this.updateLocal({ ...response, endsAt: response.endedAt ?? response.canceledAt });
  }
  async scheduledUpdate() {
    return (await this.wiring.api.subscriptions.get(this.record.id)).scheduledUpdate;
  }
  async hasScheduledUpdate() {
    return (await this.scheduledUpdate()) !== null;
  }
  async cancellationReason() {
    return (await this.wiring.api.subscriptions.get(this.record.id)).cancellationReason;
  }
  async updateBilling(body: Partial<UpdateSubscriptionBillingRequest> = {}, opts?: RequestOptions) {
    const payload = {
      redirectUrlSuccess: this.wiring.redirectUrlSuccess ?? "",
      redirectUrlCanceled: this.wiring.redirectUrlCanceled ?? "",
      ...body,
    };
    if (!payload.redirectUrlSuccess || !payload.redirectUrlCanceled)
      throw new Error("Success and cancellation billing redirect URLs are required.");
    return (
      await this.wiring.api.subscriptions.createBillingUpdateLink(this.record.id, payload, opts)
    ).href;
  }
}

export class OrderHandle {
  private cached?: Order;
  constructor(
    private readonly wiring: Wiring,
    readonly id: string,
  ) {}
  async model() {
    this.cached ??= await this.wiring.api.orders.get(this.id);
    return this.cached;
  }
  async sync(): Promise<this> {
    this.cached = await this.wiring.api.orders.get(this.id);
    return this;
  }
  async invoiceUrl() {
    return (await this.model()).links.customerInvoice?.href ?? null;
  }
  async reversedSubtotal() {
    return toMinorUnits((await this.model()).reversedSubtotal);
  }
  async refundableSubtotal() {
    return toMinorUnits((await this.model()).refundableSubtotal);
  }
  async isReversed() {
    return (await this.reversedSubtotal()) > 0n;
  }
  async isFullyReversed() {
    const order = await this.model();
    return (
      toMinorUnits(order.reversedSubtotal) > 0n && toMinorUnits(order.refundableSubtotal) === 0n
    );
  }
  async isPartiallyReversed() {
    return (await this.isReversed()) && !(await this.isFullyReversed());
  }
  refunds() {
    return this.wiring.refunds?.listForOrder(this.id) ?? [];
  }
  chargebacks() {
    return this.wiring.chargebacks?.listForOrder(this.id) ?? [];
  }
  async lines() {
    return (await this.model()).lines;
  }
}
