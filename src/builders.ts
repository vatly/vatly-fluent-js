import type {
  BillingAddress,
  CheckoutProduct,
  CreateCheckoutRequest,
  Metadata,
  RequestOptions,
} from "@getvatly/sdk";
import { type CustomerProfile, FluentError, type Wiring } from "./contracts.js";

export class CheckoutBuilder {
  protected data: CreateCheckoutRequest;
  constructor(
    protected readonly wiring: Wiring,
    profile: CustomerProfile = {},
  ) {
    this.data = {
      products: [],
      customerId: profile.vatlyId,
      redirectUrlSuccess: wiring.redirectUrlSuccess ?? "",
      redirectUrlCanceled: wiring.redirectUrlCanceled ?? "",
    };
  }
  withRedirectUrlSuccess(url: string): this {
    this.data.redirectUrlSuccess = url;
    return this;
  }
  withRedirectUrlCanceled(url: string): this {
    this.data.redirectUrlCanceled = url;
    return this;
  }
  withMetadata(metadata: Metadata): this {
    this.data.metadata = metadata;
    return this;
  }
  withLocale(locale: string | null): this {
    this.data.locale = locale;
    return this;
  }
  withBillingAddress(address: BillingAddress): this {
    this.data.billingAddress = address;
    return this;
  }
  withItems(items: readonly CheckoutProduct[]): this {
    this.data.products.push(...structuredClone(items));
    return this;
  }
  /** Mode is controlled by the SDK key, never a spoofable payload flag. */
  withTestmode(testmode: boolean): this {
    if (testmode !== (this.wiring.api.mode === "test"))
      throw new FluentError("Requested checkout mode does not match the API key.");
    return this;
  }
  inTestmode(): this {
    return this.withTestmode(true);
  }
  inLiveMode(): this {
    return this.withTestmode(false);
  }
  payload(overrides: Partial<CreateCheckoutRequest> = {}): CreateCheckoutRequest {
    return structuredClone({ ...this.data, ...overrides });
  }
  create(overrides: Partial<CreateCheckoutRequest> = {}, opts?: RequestOptions) {
    const body = this.payload(overrides);
    if (!body.products.length || body.products.some((p) => !p.id))
      throw new FluentError("At least one product or subscription plan is required.");
    if (!body.redirectUrlSuccess || !body.redirectUrlCanceled)
      throw new FluentError("Success and cancellation redirect URLs are required.");
    return this.wiring.api.checkouts.create(body, opts).then((checkout) =>
      Object.assign(checkout, {
        getUrl: () => checkout.links.checkoutUrl.href,
      }),
    );
  }
}

export class SubscriptionBuilder extends CheckoutBuilder {
  private item: CheckoutProduct = { id: "", quantity: 1 };
  toPlan(id: string): this {
    this.item.id = id;
    return this;
  }
  withQuantity(quantity: number): this {
    if (!Number.isSafeInteger(quantity) || quantity < 1)
      throw new FluentError("Quantity must be a positive integer.");
    this.item.quantity = quantity;
    return this;
  }
  withTrialDays(days: number): this {
    if (!Number.isSafeInteger(days) || days < 1)
      throw new FluentError("Trial days must be a positive integer.");
    this.item.trialDays = days;
    return this;
  }
  withTrialEndsAt(date: Date, now = Date.now()): this {
    const days = Math.ceil((date.getTime() - now) / 86_400_000);
    return this.withTrialDays(days);
  }
  override payload(overrides: Partial<CreateCheckoutRequest> = {}): CreateCheckoutRequest {
    return super.payload({ products: [this.item], ...overrides });
  }
}
