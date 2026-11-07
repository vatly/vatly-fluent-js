import {
  type FastForwardSubscriptionRenewalRequest,
  type RequestOptions,
  VatlyNotFoundError,
} from "@getvatly/sdk";
import { CheckoutBuilder, SubscriptionBuilder } from "./builders.js";
import type { CustomerProfile, LocalSubscription, Wiring } from "./contracts.js";
import { CustomerHandle, CustomerService } from "./customers.js";
import { OrderHandle, SubscriptionHandle } from "./handles.js";
import { WebhookProcessor } from "./webhooks.js";

/** Composes the SDK with driver-owned persistence; it never constructs another transport. */
export class Vatly {
  readonly customers: CustomerService;
  constructor(readonly wiring: Wiring) {
    this.customers = new CustomerService(wiring);
  }
  get api(): Wiring["api"] {
    return this.wiring.api;
  }
  oneOffProducts(): Wiring["api"]["oneOffProducts"] {
    return this.api.oneOffProducts;
  }
  subscriptionPlans(): Wiring["api"]["subscriptionPlans"] {
    return this.api.subscriptionPlans;
  }
  customer(id: string) {
    return new CustomerHandle(this.wiring, id);
  }
  checkoutBuilder(profile: CustomerProfile = {}) {
    return new CheckoutBuilder(this.wiring, profile);
  }
  subscriptionBuilder(profile: CustomerProfile = {}) {
    return new SubscriptionBuilder(this.wiring, profile);
  }
  subscription(record: LocalSubscription) {
    return new SubscriptionHandle(this.wiring, record);
  }
  order(id: string) {
    return new OrderHandle(this.wiring, id);
  }
  webhookProcessor() {
    return new WebhookProcessor(this.wiring);
  }
  async customerIdFromCheckout(id: string): Promise<string | null> {
    try {
      return (await this.api.checkouts.get(id)).customerId || null;
    } catch (error) {
      if (error instanceof VatlyNotFoundError) return null;
      throw error;
    }
  }
  /** Call only after the host verifies checkout ownership, never on an untrusted id alone. */
  async claimCustomerFromCheckout(id: string, hostId: string) {
    const customerId = await this.customerIdFromCheckout(id);
    if (!customerId) return false;
    await this.customers.attribute(customerId, hostId);
    return true;
  }
  testHelpers() {
    const api = this.api.testHelpers;
    return {
      fastForwardRenewal: api.fastForwardRenewal.bind(api),
      simulateOrderPayment: api.simulateOrderPayment.bind(api),
      advanceRenewal: (id: string, opts?: RequestOptions) => api.fastForwardRenewal(id, {}, opts),
      forceRenewalPaid: (id: string, opts?: RequestOptions) =>
        api.fastForwardRenewal(id, { paymentStatus: "paid" }, opts),
      forceRenewalFailed: (
        id: string,
        failureReason?: FastForwardSubscriptionRenewalRequest["failureReason"],
        opts?: RequestOptions,
      ) => api.fastForwardRenewal(id, { paymentStatus: "failed", failureReason }, opts),
      forceOrderPaymentPaid: (id: string, opts?: RequestOptions) =>
        api.simulateOrderPayment(id, { paymentStatus: "paid" }, opts),
      forceOrderPaymentFailed: (
        id: string,
        failureReason?: FastForwardSubscriptionRenewalRequest["failureReason"],
        opts?: RequestOptions,
      ) => api.simulateOrderPayment(id, { paymentStatus: "failed", failureReason }, opts),
    };
  }
}
export * from "./builders.js";
export * from "./contracts.js";
export * from "./customers.js";
export * from "./handles.js";
export * from "./webhooks.js";
