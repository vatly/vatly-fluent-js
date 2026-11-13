# @getvatly/fluent

> **Alpha — under active development. Every alpha release may include breaking changes. Pin exact versions during alpha.**

Framework-agnostic TypeScript billing for [Vatly](https://vatly.com), the European Merchant of Record for AI, software and digital products.
Built on `@getvatly/sdk` and ported from [vatly-fluent-php](https://github.com/vatly/vatly-fluent-php).
No framework, database, Node builtins, or second HTTP client is required at runtime.
ESM/CJS and matching declarations are included.

Start with the [integration guides](docs/README.md) for configuration, customer
bindings, storage, checkouts, subscriptions, the portal, webhooks, orders, and testing.
For remote field details, see the [API reference](https://docs.vatly.com/api-reference);
the [OpenAPI spec](https://docs.vatly.com/openapi.yaml) is also available for tooling.

## Alpha installation

Install the published alpha pair with exact versions:

```sh
npm install --save-exact @getvatly/sdk@0.3.0-alpha.2 @getvatly/fluent@0.1.0-alpha.1
```

## Development

Node 20+ and pnpm 9.15.0:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm pack
```

Development and consumers both use the published registry SDK, not a vendored
snapshot. Install the SDK alongside Fluent (a peer dependency). This release pins
SDK `0.3.0-alpha.2` because alpha releases may contain breaking changes.

## API-only usage

```ts
import { VatlyClient } from '@getvatly/sdk';
import { Vatly } from '@getvatly/fluent';

const vatly = new Vatly({
  api: new VatlyClient({ apiKey: process.env.VATLY_API_KEY }),
  redirectUrlSuccess: 'https://app.example.com/return?checkout_id={CHECKOUT_ID}',
  redirectUrlCanceled: 'https://app.example.com/canceled',
});

const checkout = await vatly.subscribe({ vatlyId: 'customer_...' })
  .toPlan('subscription_plan_...')
  .withQuantity(3)
  .withTrialDays(14)
  .withLocale('de_AT')
  .create();
// Redirect to checkout.getUrl().

const customer = vatly.customer('customer_...');
await customer.identity();                  // lazily fetched and cached per handle
await customer.update({ name: null });      // explicit null is preserved
await customer.portalSession({ returnUrl: 'https://app.example.com/account' });

for await (const match of vatly.customers.findByEmail('buyer@example.com')) {
  // Server-side matching, all cursor pages, no client-side canonicalization.
}
await vatly.oneOffProducts().list();         // complete typed SDK catalog surface
await vatly.api.webhookEndpoints.list();    // SDK escape hatch for every operation
```

`subscribe(profile)` follows Laravel's `Billable.subscribe()` naming and returns
a subscription checkout builder; it sends no request until `create()`. For one-off
or mixed carts, use `checkoutBuilder(profile).withItems([...]).create()`. Both
builders return the full SDK checkout resource plus `getUrl()`, which returns the
hosted payment URL. Direct SDK calls through `vatly.api` return plain resources.

Builders are mutable per-flow objects. `payload()` returns a detached snapshot;
repeated `create()` calls do not accumulate subscription products. Each create is
a NEW mutation unless you pass a stable `RequestOptions.idempotencyKey` as the
second argument. Trial end dates round up to whole days. The key, not a JSON
`testmode` flag, selects the mode; `inTestmode()`/`inLiveMode()` reject mismatches.

## Host persistence and handles

Supply `bindings`, `orders`, `subscriptions`, optional `refunds`/`chargebacks`,
`webhookCalls`, and `events` through `Wiring`. Contracts accept synchronous or
asynchronous drivers, except `webhookCalls.process`, which must return a promise.
`Reader` and `Writer` can be used independently.
Missing wiring fails when that feature is used, not at API-only construction.

`vatly.customers.createFor(hostId, profile)` creates and binds a customer;
`createUnattributed` records an anonymous one; `attribute` links an existing id.
Binding drivers must enforce unique host AND Vatly ids atomically. A failed bind
after an API create cannot roll back the remote creation. Reconcile the customer
and verify ownership before using `attribute`; email matching alone is not proof.
Use stable API idempotency keys on retried creates.

`vatly.subscription(localRecord)` supports `swap`, `swapAndInvoice`,
`swapWithoutCharge`, `cancel`, `resume`, `sync`, `scheduledUpdate`,
`hasScheduledUpdate`, `cancellationReason`, and `updateBilling`. Cancellation
waits for webhooks to update the local end date. `state()` derives PHP's
active/valid/recurring/cancelled/grace/ended flags from `endsAt`; read Vatly's
`status` separately (e.g. paused is not represented by those legacy predicates).

In `0.1.0-alpha.1`, cancellation reactions and `sync()` can mistake the
cancellation request time for the grace deadline. Do not use `state()` alone to
revoke access; see the [grace-period limitation](docs/Subscriptions.md#grace-period-limitation-in-010-alpha1).

`vatly.order(id)` memoizes the API order and exposes invoice URL, lines, reversal
predicates, and local refund/chargeback lists. Money remains decimal-string
`Money`; minor-unit helpers return `bigint`, never unsafe JS numbers. `sync()`
invalidates stale snapshots. Portal/billing URLs are minted on demand: never log
or persist them.

`customerIdFromCheckout` returns null only for missing customers/404. Calling
`claimCustomerFromCheckout` is safe only AFTER the host verifies that the signed-in
user owns that checkout; a query-string checkout id is not proof of ownership.

## Webhooks

```ts
const vatly = new Vatly({ api, ...yourDriver, webhookSecret: secret });
// A server route passes the original unread Request, without JSON reserialization.
const processed = await vatly.webhookProcessor().handleRequest(request);
return new Response(null, { status: processed ? 201 : 200 });
```

The processor verifies HMAC/timestamp before touching persistence, then asks
`webhookCalls.process` to deduplicate the SIGNED `event.id` transactionally.
Resource writes, audit, processed-id marking, and local event/outbox writes must
share that transaction. Failed work must roll back and remain retryable. Never
implement this as “insert dedupe id, then do work”; a failure would lose the event.
Dispatch email/network effects through a durable outbox, not inside the transaction.

Standard reactions mirror PHP: subscription started creates/updates; billing and
immediate updates find-or-skip; cancellation/grace completion sets `endsAt`;
resume clears it. Scheduled updates are dispatch-only. Paid/failed orders are
upserted without inventing new statuses; canceled orders find-or-skip. Optional
refund/chargeback repositories upsert signed snapshots without changing paid
orders into fictional refunded states. No follow-up API GET is required.
Null billing-webhook mandates do not wipe existing mandates; explicit `sync()`
reconciles actual removal. Catalog/checkout/setup events are dispatch-only.

`additionalWebhookReactions` run after built-ins and before the event dispatcher.
Events are the SDK's `VatlyWebhookEvent` union, plus
`local.order_created`/`local.subscription_created` on new local rows. Local events
and recognized SDK deliveries have `known: true`; future signed event names have
`known: false` and `object: unknown`. Check `event.known` before switching on the
name. Unsupported deliveries skip built-in billing mutations but still go through
transactional deduplication, custom reactions, and dispatch. Your `webhookCalls`
driver must retain the verified envelope for audit/triage, and the dispatcher must
use durable storage/outbox writes before acknowledgement. A failed retention or
reaction remains retryable; unknown events are not silently discarded. All 32
delivery names remain available. Resource schemas are compile-time types, not
runtime schema validation. Reconcile out-of-order snapshots with the API; this
port does not claim event-time ordering across separate delivery ids.

Catch SDK `VatlyError` subclasses unchanged; Fluent validation/wiring failures use
`FluentError` in most cases. Missing billing-update redirects currently throw a
plain `Error`. No PHP-style exception wrapper hides SDK status/details/cause.

## Test helpers and edge

`testHelpers()` includes advance/paid/failed renewal and order-payment helpers.
They mutate the real test account and must only be used with explicit permission.
For isolated tests, inject an SDK `fetch` implementation rather than inventing a
parallel FakeVatly API. `pnpm test` exercises the public fluent surface through
the actual installed SDK; the demo runs both packages inside real local workerd.

## Publishing

1. Keep the source repository `vatly/vatly-fluent-js` public when publishing with
   provenance. The npm package name stays `@getvatly/fluent`.
2. Publish the SDK version required by `package.json` first. The workflow checks that the
   exact SDK peer is available on npm before staging Fluent.
3. Configure a GitHub Actions trusted publisher in npm package settings:
   organization `vatly`, repository `vatly-fluent-js`, workflow `release.yml`, no
   environment. Stage-only permission is sufficient; no npm token, direct publish,
   or dist-tag management permission is needed.
4. Bump the version and changelog, commit, and publish a GitHub release tagged
   `vX.Y.Z` matching `package.json` (mark alpha releases as prereleases).
   `.github/workflows/release.yml` verifies the version, runs `pnpm check`, and
   stages with `npm stage publish --provenance --access public --tag latest`.
   Pushing a Git tag alone does not trigger staging.
5. Review the candidate in npm's **Staged Packages** tab and approve it with 2FA.
   Approval publishes it and updates `latest`, including for alpha versions.
   Approve releases in order: approving an older candidate later can move `latest`
   backwards. The staged tag cannot be changed after staging.

`latest` is the supported install channel during alpha; pin exact versions for
stability. Existing `alpha` dist-tags are legacy pointers and are not advanced by
this workflow.

See [npm staged publishing](https://docs.npmjs.com/staged-publishing) and
[trusted publishing](https://docs.npmjs.com/trusted-publishers).

MIT. See [PORTING.md](PORTING.md) for the exact upstream revision and deliberate
TypeScript adaptations.
