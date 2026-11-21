# Stripe payment plan

Plan for roadmap step 6 (Milestone 3): taking payment with Stripe. Written 2026-11-21, before any Stripe code exists. Nothing here is built yet. It is meant to be enough to start from in a fresh session.

Status: **blocked on keys, not on design.** The owner has a Stripe account but has not yet copied the test keys into `.env.local`. All the code can be written and unit-tested without them. Only the end-to-end check against Stripe needs them.

Stripe API names below (parameters, event names, limits) come from memory of the Stripe docs, not from a check against the current docs. Confirm each against the [Stripe docs](https://docs.stripe.com) when building, and fix this page where they differ.

## Goal

Replace "no payment is taken" with a real payment step, in Stripe **test mode** only, so the demo store can show the whole flow: cart, checkout, payment, confirmation. An order becomes `paid` only when Stripe confirms the payment.

## Decisions already made

| Decision | Source |
| --- | --- |
| A custom checkout page now, Stripe added later as a payment step | [roadmap.md](roadmap.md) Milestone 3, decided 2026-11-01 |
| Accounts stay required | Same |
| Standard delivery free, Express $12.99, tax 8% of goods, all computed by our server | [redesign_research.md](audits/redesign_research.md) step 5 |
| The shipping address is collected by our form and stored on the order | Same |

## Proposed design (not yet approved)

### Hosted Checkout, not an embedded card form

Use Stripe-hosted Checkout (a redirect to a Stripe page), not Elements.

| | Hosted Checkout | Elements (embedded) |
| --- | --- | --- |
| Code to write | Create a session, redirect, handle a webhook | The same, plus a client form, a payment intent, and confirmation handling |
| Card data touches our server | Never | Never (iframe fields), but more surface to get wrong |
| Look and feel | Stripe's page, light branding | Matches the site |
| Payment methods, 3-D Secure, wallets | Handled by Stripe | Each needs wiring |

Hosted wins on effort and risk. Elements can replace it later without changing the order model.

### Flow

1. The shopper fills the checkout form and clicks the button, which changes from "Place order" to "Continue to payment".
2. The server validates the form again, then in **one transaction** does what `placeOrder` does today: decrements stock, inserts the order as `pending` with its totals and address, and inserts the items.
3. After the commit, the server creates a Stripe Checkout Session for that order and stores the session id on the order.
4. The browser is redirected to Stripe's page. The cart is cleared once the session exists (see "Cart timing").
5. Stripe redirects back to `/account/orders/{id}?placed=1` on success, or to the order page without the flag if the shopper cancels.
6. Stripe calls our webhook. On `checkout.session.completed` the order becomes `paid`. On `checkout.session.expired` the order becomes `cancelled` and its stock is returned.

### Building the session

- One line item per order line, using the stored unit price, so the amounts match what the shopper saw.
- Shipping and tax are added as their own line items ("Shipping", "Tax"), because our server computes them and Stripe's total must equal ours. The alternative (Stripe Tax and shipping rates) is out of scope, see [roadmap.md](roadmap.md) "Out of scope".
- The order id goes in the session's `client_reference_id` and `metadata`, so the webhook can find the order.
- The account email goes in as `customer_email`.
- The address we already collected goes in `payment_intent_data.shipping`, so it shows on the payment in the Stripe dashboard. Do not turn on Stripe's own shipping address collection, or the shopper types it twice.
- `expires_at` set to 30 minutes ahead (Stripe's minimum, to confirm in the docs).
- `success_url` and `cancel_url` built from `NEXT_PUBLIC_SITE_URL` ([lib/site.ts](../lib/site.ts)).

### The webhook

- A new route handler, `app/api/stripe/webhook/route.ts`. This is the second route handler in the app, so update the architecture line in [AGENTS.md](../AGENTS.md) ("the only route handler") when it is added.
- Read the raw body with `await request.text()` and verify the signature with the webhook secret before doing anything. Reject anything unsigned with 400.
- Only accept `checkout.session.completed` and `checkout.session.expired` at first. Ignore other events with a 200.
- Handlers must be **idempotent**, because Stripe retries. Use conditional updates: `UPDATE orders SET status = 'paid' WHERE id = ? AND status = 'pending'`. A second delivery changes nothing.
- On completion, check that the session's `amount_total` equals the order total in cents. If it does not, do not mark the order paid, and log it loudly.
- On expiry, in one transaction: set `cancelled` where still `pending`, and add each line's quantity back to `products.stock`. Only restock if the update changed a row, so a retry cannot restock twice.
- Return a 2xx quickly. Do slow work (email) later, in Milestone 4.

### Data model changes (migration `0002`)

| Column on `orders` | Type | Why |
| --- | --- | --- |
| `stripe_session_id` | text, unique, nullable | Links the order to its Checkout Session, and lets the order page resume payment. Nullable for old orders |
| `paid_at` | timestamp, nullable | When payment was confirmed |

The `order_status` enum already has `pending`, `paid`, `shipped`, `delivered`, `cancelled`. No new status is needed.

### Order page and wording

This settles open question 4 in the research report, as a proposal:

| Status | Label shown | Notes |
| --- | --- | --- |
| `pending`, session still open | "Awaiting payment" | With a "Complete payment" button that sends the shopper back to the open session |
| `pending`, session expired or none | "Awaiting payment" until the webhook cancels it | Old pre-Stripe orders also show this, with the existing "no payment was taken" note |
| `paid` | "Paid" | Banner "Payment received. Thank you." |
| `cancelled` | "Cancelled" | Explains that the payment window expired and the items were released |

**Returning before the webhook arrives.** The shopper can reach the success page a moment before the webhook marks the order paid. The page must not claim "Payment received" from the redirect alone. Options: show "We are confirming your payment" while the order is still `pending` and the session is `complete`, then refresh. The safe default is to read the session status from Stripe on that page, and trust only the webhook to change the database.

### Cart timing

Today the cart is cleared right after the order is created. With payment, clear it only after the Stripe session is created successfully. If session creation fails, the order must not stay `pending` with stock held: cancel it and restock in the same step, show an error on the checkout page, and keep the cart.

### Demo and test-mode copy

The "Demo store — no payment is taken." notes (cart, checkout, order page) become untrue once Stripe exists. Replace them with a truthful line, for example "Test mode: use card 4242 4242 4242 4242. No real money is charged." The store must stay in test mode. Taking real payments needs a live Stripe account, business details, and legal pages (terms, refunds), none of which exist.

## Environment

| Variable | Where it comes from | Needed for |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Stripe dashboard, test mode, Developers → API keys (`sk_test_…`) | Creating sessions, reading sessions |
| `STRIPE_WEBHOOK_SECRET` | Locally: printed by `stripe listen`. Deployed: shown when the endpoint is created in the dashboard (`whsec_…`) | Verifying webhooks |

Not needed for hosted Checkout: the publishable key.

Add both to `.env.local` by hand. Never paste them into chat or commit them. [.env.example](../.env.example) lists them as commented placeholders. The "stop if invalid" rule in [AGENTS.md](../AGENTS.md) applies to the three database and auth variables. Once the code is built, a missing Stripe key should make checkout show a clear error, not crash the app at import.

### Local webhook testing

1. Install the Stripe CLI and sign in (`stripe login`).
2. Run `stripe listen --forward-to localhost:3000/api/stripe/webhook`. Copy the `whsec_…` it prints into `STRIPE_WEBHOOK_SECRET` and restart the dev server.
3. Pay with the test card 4242 4242 4242 4242, any future expiry, any CVC and ZIP.
4. To test expiry without waiting, trigger `checkout.session.expired` with the CLI or expire the session from the API.

### Deployed webhook

The deployed endpoint (`https://basehardware.store/api/stripe/webhook`) can only be registered after Milestone 1 (domain and Vercel project). It gets its own signing secret, set in the Vercel environment variables.

## Testing plan

| Layer | What | Needs keys |
| --- | --- | --- |
| Unit | Pure helpers in a `lib/` file: building line items from an order (cents, shipping and tax lines, sum equals total), the amount check, and the status transition rules (idempotency) | No |
| Unit | Webhook signature check with a locally generated test signature | No |
| E2E | Clicking "Continue to payment" creates a `pending` order and redirects to a Stripe domain | Yes |
| E2E | A signed `checkout.session.completed` posted to the webhook marks the order `paid`; the same event twice changes nothing; `expired` cancels and restocks once | Webhook secret only |
| Manual | Full payment with the test card, then the order page shows "Paid". Decline card (4000 0000 0000 0002) leaves the order pending | Yes |

The hosted Stripe page itself is not automated: it is Stripe's page, and driving it in CI is brittle.

Follow the project's method for every new test: undo the fix it protects, confirm the test fails for the right reason, restore (see [testing.md](testing.md)).

## Build order

1. Migration `0002` and schema: `stripe_session_id`, `paid_at`.
2. Pure helpers and their unit tests (line items, amount check, transitions).
3. `lib/stripe.ts` (server-only client, reads the secret key, clear error if missing).
4. Change `placeOrder` and the action: create the session after the commit, handle failure (cancel and restock), clear the cart on success.
5. Webhook route with signature check and idempotent handlers.
6. Order page: statuses, "Complete payment", confirming state. Update the copy.
7. Tests, docs, and the walkthrough and technical guide updates.
8. Manual test with real test keys, then add an e2e test that needs them.

## Risks and edge cases

- **Held stock.** Covered by the 30-minute expiry and restock. Until it exists, abandoned payments leak stock.
- **Webhook never arrives** (misconfigured secret, endpoint down). The order stays `pending`. The order page's session check is the fallback for the shopper, and a stuck-order query is the fallback for us.
- **Out of order or duplicate events.** Conditional updates handle both.
- **Price changes between order and payment.** The session uses the stored unit prices, not current prices, so the shopper pays what they saw.
- **Two tabs, two sessions.** One order has one session id. Resuming reuses the open session instead of creating another.
- **Admin deleting a product** that has orders is already blocked by the foreign key.
- **Refunds and cancellations after payment.** Not covered. No refund flow exists, and the "cancel within 1 hour" promise was dropped for that reason.

## Open questions

1. **Expiry and restock.** Is a 30-minute payment window with automatic cancel and restock acceptable? Asked 2026-11-21, not yet answered. Proposed: yes.
2. **Status wording** (research question 4). Proposed: "Awaiting payment" and "Paid".
3. **Keys.** The owner has an account but no keys copied yet.
4. **Button label.** "Continue to payment" instead of "Place order", because the order is not final until payment. Proposed: yes.

## Out of scope for this step

Refunds, receipts and the confirmation email (Milestone 4), Stripe Tax, shipping rates, saved cards, coupons, subscriptions, and live-mode payments.
