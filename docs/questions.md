# Base Hardware — Questions

A running log of things that weren't clear, and what turned out to be the answer. Add a new entry whenever something clicks.

Format:

```text
## Q: <the thing you didn't understand>
**Confused by:** <what made it confusing>
**Answer:** <what you figured out>
**Where to look:** <file or section that shows it>
```

---

## Q: Why does `resolveCartId` take a `create` flag?

**Confused by:** Why not always create a cart if one doesn't exist?

**Answer:** Creating a cart may set a cookie (for guest carts). Setting cookies during a server render is forbidden by Next.js — it throws. The `create` flag is only passed `true` inside Server Actions and Route Handlers, never during a render. Passing `false` during reads means "find the cart if it exists, return null if not — don't create anything."

**Where to look:** [lib/cart.ts](lib/cart.ts) `resolveCartId`

---

## Q: Why does the checkout `UPDATE` use `WHERE stock >= qty` instead of checking stock first?

**Confused by:** There's no `SELECT stock FROM products WHERE id = ?` before decrementing. How does it know there's enough stock?

**Answer:** The check and the decrement are the same operation. `UPDATE products SET stock = stock - qty WHERE id = ? AND stock >= qty` — if stock is insufficient, zero rows are updated. The `.returning()` result is empty, which signals the shortage. This is atomic: two concurrent checkouts for the last unit both run this `UPDATE`, but Postgres row-level locking ensures only one succeeds. A separate `SELECT` then `UPDATE` would have a race window between the two.

**Where to look:** [lib/orders.ts](lib/orders.ts) `placeOrder`

---

## Q: Why do `lib/*` functions return `{ ok: false, reason }` instead of throwing?

**Confused by:** Most server code just throws on failure. Why does `placeOrder`, `upsertReview`, `deleteProduct`, and `registerUser` all return an object?

**Answer:** Throws are for bugs; result objects are for expected business failures. "Out of stock" and "not a purchaser" are things the UI needs to respond to with a specific message — throwing loses the structured reason. The Server Action receives the typed result and maps it to a user-facing string. See the `{ ok, reason }` section in [concepts.md](concepts.md).

**Where to look:** [lib/orders.ts](lib/orders.ts), [lib/reviews.ts](lib/reviews.ts), [app/actions/reviews.ts](app/actions/reviews.ts)

---

## Q: Why doesn't `lib/products.ts` have `import "server-only"` when all other `lib/*` files do?

**Confused by:** Everything under `lib/` is described as server-only domain logic, but `products.ts` has no `server-only` guard.

**Answer:** `generateStaticParams` in `/store/[category]/page.tsx` and `/product/[slug]/page.tsx` calls `getProducts` and `getCategories` at build time. Next.js runs `generateStaticParams` in a context that can't import `server-only` modules. Since `products.ts` needs to be reachable from there, the guard is deliberately omitted. It's still server-side code in practice — it uses Drizzle and the DB connection — but the build-time boundary prevents the marker. All other `lib/*` modules are never needed from a `generateStaticParams` context.

**Where to look:** [lib/products.ts](lib/products.ts), [app/store/[category]/page.tsx](app/store/%5Bcategory%5D/page.tsx) `generateStaticParams`, technical_guide.md §14 pattern 2

---

## Q: Why is `mergeGuestCartAction` called from `AuthForm` instead of inside an Auth.js callback?

**Confused by:** Auth.js has `signIn` and `jwt` callbacks. Merging the guest cart feels like something that should happen automatically on login, not something the client has to call manually.

**Answer:** Auth.js callbacks run inside the auth layer, which has no access to the guest `cart_token` cookie at the time the JWT is created — that cookie is a separate httpOnly cookie read by `lib/cart.ts`. There's no clean hook to run arbitrary server logic from inside `authorize`. Calling `mergeGuestCartAction()` explicitly from `AuthForm` right after `signIn` resolves is the simplest correct place. The downside is that any future login path (e.g. OAuth) must also call the merge manually — which is documented as a gotcha in technical_guide.md §15.

**Where to look:** [components/auth/AuthForm.tsx](components/auth/AuthForm.tsx), [lib/cart.ts](lib/cart.ts) `mergeGuestCartIntoUser`

---

## Q: Why are `price`, `total`, and `unit_price` returned as strings instead of numbers?

**Confused by:** The DB columns are `numeric(10,2)`. JavaScript numbers should be fine for currency — why does Drizzle give back `"12.99"` instead of `12.99`?

**Answer:** JavaScript's `number` type is IEEE 754 floating point. Operations on it can introduce small rounding errors: `0.1 + 0.2 === 0.30000000000000004`. For currency that's unacceptable. The `postgres-js` driver returns `numeric` columns as strings so the caller can decide how to handle precision — convert with `Number()` for arithmetic, keep as string for storage, use a decimal library if full precision is required. The convention in this project is `Number(row.price)` on read and `.toFixed(2)` before writing back.

**Where to look:** [db/schema.ts](db/schema.ts) numeric columns, technical_guide.md §14 pattern 5

---

## Q: Why are the checkout address fields separate columns on `orders` instead of one JSON field?

**Confused by:** A JSON column would let us add address fields later without a migration, and it keeps the table narrower. It was not obvious which is better.

**Answer:** Separate columns, with a `shipping_` prefix. The database can enforce the shape, queries by city or state stay simple, Drizzle gives a typed result, and the address has a small, well-known shape. JSON cannot require fields inside it, makes filtering awkward, and lets old orders end up with different shapes. The migration cost of a later field is small: an optional column is a one-line, safe migration that leaves old orders alone, and the real work of a new field (form, validation, display) is the same either way. We settled the full field list now (name, two street lines, city, state, ZIP, country, optional phone) to avoid most later changes. The columns are nullable because orders placed before the checkout page have no address; the form requires them for new orders. A billing address will not need its own columns, because Stripe collects it, and saved addresses (open question 5 in the research report) would be a separate table, since the order keeps a frozen copy.

**Where to look:** [db/schema.ts](db/schema.ts) `orders`, [technical_guide.md §5.6](technical_guide.md), [audits/redesign_research.md](audits/redesign_research.md) (step 5 decisions)

---
