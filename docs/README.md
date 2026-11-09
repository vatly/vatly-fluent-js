# Getting Started

> **Alpha — under active development. Every alpha release may include breaking changes. Pin exact versions during alpha.**

`@getvatly/fluent` adds checkout builders, customer bindings, subscription and
order handles, and webhook processing to `@getvatly/sdk`. Your application owns
authentication, database tables, and background jobs. No framework or ORM is required.

These guides target **Fluent `0.1.0-alpha.1` with SDK `0.3.0-alpha.2`**:

```sh
npm install --save-exact @getvatly/sdk@0.3.0-alpha.2 @getvatly/fluent@0.1.0-alpha.1
```

## Start here

1. [Installation and configuration](Configuration.md): server-only setup, API keys,
   redirects, errors, and runtime support.
2. [Core concepts and storage](CoreConcepts.md): billables, bindings, repositories,
   and adapting your existing tables.
3. [Customers and bindings](Customers.md): create or link a customer to your user.
4. [Checkouts](Checkouts.md): one-off purchases, subscriptions, trials, and retries.
5. [Webhooks](Webhooks.md): verify deliveries and commit billing changes safely.

## Manage billing

- [Subscriptions](Subscriptions.md): swap, cancel, resume, and update billing.
- [Customer portal](CustomerPortal.md): issue a single-use portal link for a user.
- [Orders and invoices](Orders.md): invoice links, order lines, refunds, and money.
- [Testing](Testing.md): isolated tests, test-mode checkouts, and webhook delivery.
- [Porting from PHP](Porting.md): map PHP concepts to the TypeScript API.

## First checkout

Run this on your server with a customer and product from the same storefront and
API-key mode. Authenticate the caller and authorize their customer before using it.

```ts
import { VatlyClient } from '@getvatly/sdk';
import { Vatly } from '@getvatly/fluent';

export async function startCheckout(apiKey: string, customerId: string, productId: string) {
  const vatly = new Vatly({
    api: new VatlyClient({ apiKey }),
    redirectUrlSuccess: 'https://app.example.com/billing/return',
    redirectUrlCanceled: 'https://app.example.com/billing/canceled',
  });
  const checkout = await vatly.checkoutBuilder({ vatlyId: customerId })
    .withItems([{ id: productId, quantity: 1 }])
    .create();
  return checkout.getUrl(); // Redirect the customer's browser to this URL.
}
```

A return-page visit is not payment confirmation. Use verified webhooks to grant
access, record payment, and update subscriptions. API-only checkout creation needs
no local repositories; webhook persistence does.

For field details, see the [API reference](https://docs.vatly.com/api-reference).
The [OpenAPI spec](https://docs.vatly.com/openapi.yaml) is also available for tooling.
