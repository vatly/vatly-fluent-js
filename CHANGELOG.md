# Changelog

All notable changes to `@getvatly/fluent` are documented here.
Every alpha release may include breaking changes; pin exact versions.

## [Unreleased]

## 0.1.0-alpha.2

### Added

- Order lines are typed with `relatedResources.subscriptionId`, the subscription
  a signup, renewal or immediate-update line belongs to. `relatedResources` is
  null on historical and unrelated lines, and may be absent from older payloads.
  `subscriptionId` is null while a signup's subscription is not yet available.
  `productType` and `productId` keep their meaning: signup lines still reference
  the plan. Persisted `order.paid` orders and `vatly.order(id).lines()` carry the
  field. The [orders guide](docs/Orders.md#link-order-lines-to-subscriptions)
  shows how to read it.

### Dependencies

- Requires `@getvatly/sdk@0.3.0-alpha.4` as an exact peer dependency; upgrade both
  packages together.

## 0.1.0-alpha.1

### Added

- Framework-agnostic TypeScript port of `vatly/vatly-fluent-php`, with checkout
  and subscription builders, customer bindings, and customer/order/subscription
  handles. See `PORTING.md` for upstream revision and deliberate adaptations.
- Host-owned persistence contracts and signature-verified webhook processing,
  with transactional deduplication, built-in reactions, and event dispatch.
- SDK escape hatch, typed catalogue access, and permission-sensitive test helpers.
- ESM/CommonJS exports and matching TypeScript declarations, with no additional
  HTTP client or runtime dependencies beyond the SDK peer.
- Usage and integration documentation, tests, Node 20/22/24 CI, and staged npm
  publishing with provenance and mandatory maintainer approval.

### Dependencies

- Requires the published `@getvatly/sdk@0.3.0-alpha.2` as an exact peer dependency;
  development uses the same registry version. No vendored SDK snapshot is needed.
