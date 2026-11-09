# Porting from PHP

Replace PHP's billable action with a builder on a configured `Vatly` instance:

```ts
import type { Vatly } from '@getvatly/fluent';

export async function subscribe(vatly: Vatly, customerId: string, planId: string) {
  const checkout = await vatly.subscribe({ vatlyId: customerId })
    .toPlan(planId)
    .withQuantity(1)
    .create();
  return checkout.getUrl();
}
```

Await remote calls and driver results. Resources are plain data, not active-record
models. Use `vatly.api` for SDK operations without Fluent helpers.

## PHP to TypeScript

| PHP concept | TypeScript equivalent |
| --- | --- |
| Configuration/container | `new Vatly({ api: new VatlyClient(...), ...drivers })` |
| Billable model/trait | Your user/account plus `CustomerProfile` and [bindings](CoreConcepts.md#billables-and-bindings). |
| Checkout/subscription builder | [Checkouts](Checkouts.md): `checkoutBuilder(profile)` / `subscribe(profile).toPlan(id)`. |
| Resource getters | SDK properties or `handle.model()`. |
| Subscription state helpers | [Subscriptions](Subscriptions.md): `handle.state()` from local `endsAt`. |
| Repository interfaces and DTOs | [Storage contracts](CoreConcepts.md): `Repository<T>`, `Stored<T>`, partial updates. |
| Event classes | [Webhooks](Webhooks.md): `DomainEvent`; check `known`, then `eventName`. |
| FakeVatly | [Testing](Testing.md): inject SDK `fetch`. |
| API exception wrapper | [Configuration](Configuration.md#handle-errors-and-retries): SDK errors pass through; `FluentError` covers local input/wiring. |

Keep full SDK fields, including `testmode`, metadata, lines, and tax data. Use
`subscriptionPlanId`, not a PHP `planId` alias. Money stays `{ value, currency }`;
see [money and reversals](Orders.md#money-and-reversals) for bigint conversion.
Follow the linked storage and webhook contracts rather than copying PHP update
or audit behavior: null/omitted fields and transaction boundaries differ.

This documents Fluent `0.1.0-alpha.1`, ported from PHP revision
`db211e0cf8505017fcd2eea056628db2f19f5c8b`, not later PHP additions.
The [porting record](../PORTING.md) lists the original scope. Use the
[API reference](https://docs.vatly.com/api-reference) for remote field details;
the [OpenAPI spec](https://docs.vatly.com/openapi.yaml) is also available for tooling.
