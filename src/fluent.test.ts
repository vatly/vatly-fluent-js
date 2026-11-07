import { createHmac } from "node:crypto";
import {
  type Subscription,
  VatlyClient,
  VatlyNotFoundError,
  type VatlyWebhookEvent,
} from "@getvatly/sdk";
import { describe, expect, it } from "vitest";
import {
  type DomainEvent,
  type LocalSubscription,
  type Repository,
  Vatly,
  type Wiring,
  subscriptionState,
} from "./index.js";

const secret = "local-test-signing-secret";
const now = Math.floor(Date.now() / 1000);
function envelope(eventName: string, object: object, id = crypto.randomUUID()) {
  return JSON.stringify({
    id,
    resource: "webhook_event",
    eventName,
    entityType: "subscription",
    entityId: "sub_1",
    testmode: true,
    createdAt: new Date().toISOString(),
    object,
  });
}
function signature(raw: string) {
  return `t=${now},v1=${createHmac("sha256", secret).update(`${now}.${raw}`).digest("hex")}`;
}
function repo<T extends { id: string }>(): Repository<T> & { all(): T[] } {
  const records = new Map<string, T>();
  return {
    all: () => [...records.values()],
    findByVatlyId: (id) => records.get(id) ?? null,
    store: (data) => {
      if (records.has(data.id)) throw new Error("duplicate");
      records.set(data.id, data);
      return data;
    },
    update: (id, data) => {
      const item = records.get(id);
      if (!item) throw new Error("missing");
      const result = { ...item, ...data };
      records.set(id, result);
      return result;
    },
  };
}
function harness(responses: { status?: number; body?: unknown }[] = []) {
  const requests: { url: string; method: string; body: Record<string, unknown> }[] = [];
  const api = new VatlyClient({
    apiKey: "test_local_fixture_not_a_credential",
    maxRetries: 0,
    fetch: async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : {},
      });
      const response = responses.shift();
      if (!response) throw new Error("Unexpected API request");
      return new Response(response.status === 204 ? null : JSON.stringify(response.body), {
        status: response.status ?? 200,
      });
    },
  });
  const subscriptions = repo<LocalSubscription>();
  const orders = repo<import("./index.js").Stored<import("@getvatly/sdk").Order>>();
  const dispatched: DomainEvent[] = [];
  const processed = new Set<string>();
  const bindings = new Map<string, string>();
  const wiring: Wiring = {
    api,
    subscriptions,
    orders,
    webhookSecret: secret,
    redirectUrlSuccess: "https://example.com/ok",
    redirectUrlCanceled: "https://example.com/no",
    bindings: {
      bind: (vatly, host) => {
        bindings.set(vatly, host);
      },
      record: () => {},
      hostCustomerIdFor: (id) => bindings.get(id) ?? null,
      vatlyCustomerIdFor: (id) => [...bindings].find(([, host]) => host === id)?.[0] ?? null,
    },
    events: {
      dispatch: (e) => {
        dispatched.push(e);
      },
    },
    webhookCalls: {
      process: async (event, work) => {
        if (processed.has(event.id)) return false;
        await work();
        processed.add(event.id);
        return true;
      },
    },
  };
  return { vatly: new Vatly(wiring), wiring, subscriptions, orders, dispatched, requests };
}
const subscription = {
  id: "sub_1",
  customerId: "customer_1",
  subscriptionPlanId: "old_plan",
  testmode: true,
  quantity: 3,
  name: "Team",
  status: "active",
  endedAt: null,
  canceledAt: null,
  mandate: { method: "card", maskedIdentifier: "4242" },
  cancellationReason: null,
} as Subscription;

describe("fluent public contract", () => {
  it("builds reusable subscription checkouts without accumulating products", async () => {
    const h = harness([{ body: { id: "a" } }, { body: { id: "b" } }]);
    const builder = h.vatly
      .subscriptionBuilder({ vatlyId: "customer_1" })
      .toPlan("plan_1")
      .withQuantity(3)
      .withLocale("de_AT")
      .withTrialEndsAt(new Date(86_400_001), 0)
      .withMetadata({ host: "host_1" })
      .withBillingAddress({ country: "NL" })
      .inTestmode();
    await builder.create();
    await builder.create();
    expect(h.requests.map((r) => r.body.products)).toEqual([
      [{ id: "plan_1", quantity: 3, trialDays: 2 }],
      [{ id: "plan_1", quantity: 3, trialDays: 2 }],
    ]);
    expect(h.requests[0]!.body).toMatchObject({
      customerId: "customer_1",
      locale: "de_AT",
      metadata: { host: "host_1" },
      billingAddress: { country: "NL" },
    });
    expect(h.requests[0]!.body).not.toHaveProperty("testmode");
    expect(() => builder.inLiveMode()).toThrow(/mode/);
  });
  it("rejects missing products, redirects, invalid quantity and nonfuture trials before sending", () => {
    const h = harness();
    expect(() => h.vatly.checkoutBuilder().create()).toThrow(/product/);
    expect(() => h.vatly.subscriptionBuilder().withQuantity(1.1)).toThrow(/integer/);
    expect(() => h.vatly.subscriptionBuilder().withTrialEndsAt(new Date(0), 0)).toThrow(/Trial/);
    expect(() =>
      h.vatly
        .checkoutBuilder()
        .withItems([{ id: "one_off" }])
        .withRedirectUrlSuccess("")
        .create(),
    ).toThrow(/redirect/);
    expect(h.requests).toHaveLength(0);
  });
  it("preserves explicit null identity updates and refreshes memoized handles", async () => {
    const h = harness([
      { body: { id: "c", name: "Before", email: "a@b.com" } },
      { body: { id: "c", name: null, email: "a@b.com" } },
    ]);
    const customer = h.vatly.customer("c");
    expect(await customer.name()).toBe("Before");
    expect(await customer.email()).toBe("a@b.com");
    await customer.update({ name: null });
    expect(await customer.identity()).toEqual({ name: null, email: "a@b.com" });
    expect(h.requests).toHaveLength(2);
    expect(h.requests[1]!.body).toEqual({ name: null });
  });
  it("binds both identities and rejects cross-host and cross-Vatly attribution", async () => {
    const h = harness([{ body: { id: "c", email: "a@b.com" } }]);
    await h.vatly.customers.createFor("host", { email: "a@b.com" });
    await h.vatly.customers.attribute("c", "host");
    await expect(h.vatly.customers.attribute("other", "host")).rejects.toThrow(/bound/);
    await expect(h.vatly.customers.attribute("c", "other-host")).rejects.toThrow(/bound/);
    await expect(h.vatly.customers.createFor("host", { email: "a@b.com" })).rejects.toThrow(
      /bound/,
    );
  });
  it("forwards the server email filter across pages rather than normalizing locally", async () => {
    const h = harness([
      {
        body: { data: [{ id: "c1" }], links: { next: { href: "/v1/customers?startingAfter=c1" } } },
      },
      { body: { data: [{ id: "c2" }], links: { next: null } } },
    ]);
    const ids = [];
    for await (const c of h.vatly.customers.findByEmail("büyer+demo@example.com")) ids.push(c.id);
    expect(ids).toEqual(["c1", "c2"]);
    expect(
      h.requests.every(
        (r) => new URL(r.url).searchParams.get("email") === "büyer+demo@example.com",
      ),
    ).toBe(true);
  });
  it("only converts checkout 404 to an absent identity; preserves SDK errors", async () => {
    const h = harness([
      { status: 404, body: {} },
      { status: 403, body: {} },
      { status: 404, body: {} },
    ]);
    expect(await h.vatly.customerIdFromCheckout("missing")).toBeNull();
    await expect(h.vatly.customerIdFromCheckout("forbidden")).rejects.toMatchObject({
      status: 403,
    });
    await expect(h.vatly.api.customers.get("missing")).rejects.toBeInstanceOf(VatlyNotFoundError);
  });
  it("applies swap intentions, leaves scheduled local plan unchanged, and clears resumed endsAt", async () => {
    const h = harness([
      { body: subscription },
      { body: { ...subscription, subscriptionPlanId: "new" } },
      { body: subscription },
      { status: 204 },
    ]);
    const record = { ...subscription, hostCustomerId: null, endsAt: "2030-01-01" };
    h.subscriptions.store(record);
    const handle = h.vatly.subscription(record);
    await handle.swap("new");
    expect(handle.model().subscriptionPlanId).toBe("old_plan");
    await handle.swapWithoutCharge("new");
    expect(h.requests[1]!.body).toEqual({
      subscriptionPlanId: "new",
      applyImmediately: true,
      prorationCharge: false,
    });
    await handle.resume();
    expect(handle.state().recurring).toBe(true);
    await handle.cancel({ immediately: true });
    expect(h.requests[3]!.url).toContain("immediately=true");
  });
  it.each([null, "2030-01-01T00:00:00Z", "2020-01-01T00:00:00Z"])(
    "matches PHP endsAt semantics for %s",
    (endsAt) => {
      const state = subscriptionState(endsAt, Date.parse("2025-01-01"));
      expect(state.active).toBe(endsAt !== "2020-01-01T00:00:00Z");
      expect(state.recurring).toBe(endsAt === null);
      expect(state.ended).toBe(endsAt === "2020-01-01T00:00:00Z");
    },
  );
  it("reads reversal progress without changing paid status or losing decimal precision", async () => {
    const h = harness([
      {
        body: {
          id: "o",
          status: "paid",
          reversedSubtotal: { value: "1.23", currency: "EUR" },
          refundableSubtotal: { value: "98.77", currency: "EUR" },
          links: { customerInvoice: null },
        },
      },
    ]);
    const order = h.vatly.order("o");
    expect(await order.reversedSubtotal()).toBe(123n);
    expect(await order.isPartiallyReversed()).toBe(true);
    expect((await order.model()).status).toBe("paid");
    expect(h.requests).toHaveLength(1);
  });
});

describe("signed webhook processing", () => {
  it("verifies before touching state, persists signed data, deduplicates, and dispatches after reactions", async () => {
    const h = harness();
    const raw = envelope("subscription.started", subscription);
    const processor = h.vatly.webhookProcessor();
    await expect(processor.handle(raw, "t=0,v1=bad")).rejects.toThrow();
    expect(h.subscriptions.all()).toHaveLength(0);
    expect(await processor.handle(raw, signature(raw))).toBe(true);
    expect(await processor.handle(raw, signature(raw))).toBe(false);
    expect(h.subscriptions.all()).toHaveLength(1);
    expect(h.dispatched.map((e) => e.eventName)).toEqual([
      "local.subscription_created",
      "subscription.started",
    ]);
    expect(h.requests).toHaveLength(0);
  });
  it("leaves scheduled updates untouched, handles grace completion without a cancellation, and resume clears the end", async () => {
    const h = harness();
    const send = async (name: string, object: object) => {
      const raw = envelope(name, object);
      await h.vatly.webhookProcessor().handle(raw, signature(raw));
    };
    await send("subscription.updated", subscription); // find-or-skip
    expect(h.subscriptions.all()).toHaveLength(0);
    await send("subscription.started", subscription);
    await send("subscription.update_scheduled", { ...subscription, subscriptionPlanId: "future" });
    expect(h.subscriptions.all()[0]!.subscriptionPlanId).toBe("old_plan");
    await send("subscription.cancellation_grace_period_completed", {
      ...subscription,
      endedAt: "2025-01-01",
      status: "canceled",
    });
    expect(h.subscriptions.all()[0]!.endsAt).toBe("2025-01-01");
    await send("subscription.resumed", subscription);
    expect(h.subscriptions.all()[0]!.endsAt).toBeNull();
  });
  it("does not wipe an existing mandate on a sparse billing webhook; explicit sync reconciles removal", async () => {
    const h = harness([{ body: { ...subscription, mandate: null } }]);
    const local = { ...subscription, endsAt: null, hostCustomerId: null };
    h.subscriptions.store(local);
    const raw = envelope("subscription.billing_updated", { ...subscription, mandate: null });
    await h.vatly.webhookProcessor().handle(raw, signature(raw));
    expect(h.subscriptions.all()[0]!.mandate).toEqual(subscription.mandate);
    await h.vatly.subscription(h.subscriptions.all()[0]!).sync();
    expect(h.subscriptions.all()[0]!.mandate).toBeNull();
  });
  it("retries failed reactions instead of marking the delivery complete", async () => {
    const h = harness();
    let fail = true;
    h.wiring.additionalWebhookReactions = [
      {
        supports: () => true,
        handle: () => {
          if (fail) throw new Error("retry");
        },
      },
    ];
    const raw = envelope("checkout.paid", { id: "checkout_1" });
    await expect(h.vatly.webhookProcessor().handle(raw, signature(raw))).rejects.toThrow("retry");
    fail = false;
    expect(await h.vatly.webhookProcessor().handle(raw, signature(raw))).toBe(true);
    expect(h.dispatched).toHaveLength(1);
  });
});
