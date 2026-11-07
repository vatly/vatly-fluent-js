# PHP → TypeScript port

Source: `vatly/vatly-fluent-php` at
`db211e0cf8505017fcd2eea056628db2f19f5c8b` (read 2026-11-07).

| PHP responsibility | TypeScript surface |
| --- | --- |
| ConfigurationInterface / Wiring / apiOnly | `new Vatly({ api: new VatlyClient(...), ... })` |
| CustomerProfile DTO | structural `CustomerProfile` |
| CheckoutBuilder / SubscriptionBuilder | same builders; withItems + create(overrides, requestOptions) |
| CustomerService / CustomerHandle | `vatly.customers` / `vatly.customer(id)` |
| SubscriptionHandle + derived state trait | `vatly.subscription(local)` / `.state()` |
| OrderHandle | `vatly.order(id)`; local reversal repositories optional |
| Product services and one-action wrappers | SDK resources exposed directly; `.get` rather than `.find` |
| Renewal/order test helpers | `vatly.testHelpers()` |
| Repository reader/writer contracts | generic `Reader`, `Writer`, `Repository`, `ReversalRepository` |
| Store/Update DTOs | generated resource + `hostCustomerId`; optional fields mean unchanged, null clears |
| Webhook processor/factory/reactions | `vatly.webhookProcessor()`; automatic built-ins + extension reactions |
| Dedicated event classes | discriminated SDK events with full signed resources |
| FakeVatly recording hierarchy | inject SDK fetch in tests (no duplicate API to maintain) |
| Exception marker / ApiCallFailed wrapper | native SDK errors preserved; `FluentError` for local validation |

Intentional differences: async operations, no Laravel/PHP containers or action
classes, no duplicate config object, no inherited fake hierarchy, no DTO money
flattening, and no redundant status getter aliases when record properties do the
same job. Order lines come from the memoized full API resource, rather than a
separate local line-reader adapter. Consumers can persist the full signed lines.

The PHP webhook audit contract alone does not guarantee atomic deduplication.
This port explicitly delegates transactional execution and signed-id deduplication
to the host driver; the demo implements and tests this using SQLite. Event shape,
tax details, metadata, and testmode remain intact rather than being flattened into
per-event PHP classes. Optional refund/chargeback repositories gate persistence,
not event dispatch. Financial records remain segregated by the resource testmode;
the driver must also scope ids and credentials by tenant/storefront.

No field/schema/path is renamed relative to the production SDK. Vatly calls the
resource `Checkout`; it represents a hosted checkout session.
