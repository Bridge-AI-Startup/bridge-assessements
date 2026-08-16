/**
 * Demo-grade assessments for live demos — three assessments that each resist
 * AI one-shotting in a different way and test a different hiring-relevant skill:
 *
 *   1. Webhook Ledger (75 min)  — backend correctness: idempotency, out-of-order
 *      event replay, derived anomalies, restart persistence.
 *   2. Flaky Checkout (60 min)  — debugging: a working service with four planted
 *      support tickets; fixes must not break existing behavior.
 *   3. Standup Board (90 min)   — full-stack product build: server-enforced WIP
 *      limit, blocked-task rule, owner filter, persistence, real UI checks.
 *
 * Every check that can be settled deterministically has a spec (http /
 * http_sequence / restart_persistence / ui) with {{nonce}} values, so a
 * hardcoded response cannot pass. One check per assessment is left to the
 * agent judge on purpose, to demo both verification paths.
 *
 * Usage (from server/):
 *   npx tsx --env-file=config.env src/scripts/seedDemoAssessments.ts
 *
 * Owners (override with OWNER_EMAILS=comma,separated):
 *   saaz.m@icloud.com, demo@bridgeai-demo.com
 */
import "../config/loadEnv.js";
import crypto from "crypto";
import mongoose from "mongoose";
import connectMongoose from "../db/mongooseConnection.js";
import UserModel from "../models/user.js";
import AssessmentModel from "../models/assessment.js";
import SubmissionModel from "../models/submission.js";
import { getShareLinkBaseUrl } from "../utils/shareLink.js";
import { parseBehavioralCheckSpecs } from "../services/behavioralGrading/checkSpecs.js";

const OWNER_EMAILS = (
  process.env.OWNER_EMAILS || "saaz.m@icloud.com,demo@bridgeai-demo.com"
)
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

type StarterFile = { path: string; content: string };

type AssessmentDef = {
  title: string;
  timeLimit: number;
  description: string;
  behavioralChecks: string[];
  behavioralCheckSpecs: unknown[];
  evaluationCriteria: string[];
  starterCodeFiles: StarterFile[];
  candidateEmail: string;
  candidateName: string;
};

/* ------------------------------------------------------------------ */
/* 1. Webhook Ledger — idempotent payment event processing             */
/* ------------------------------------------------------------------ */

const LEDGER_README = `# Webhook Ledger

You are building the ingestion service behind a payments dashboard. The payment
provider delivers webhook events **at least once** (duplicates happen) and **in
no particular order** (a refund can arrive before its capture). Your job is to
keep the ledger correct anyway.

## How to run

- Install: \`npm install\`
- Start: \`npm start\`
- Port: \`3000\` (or \`PORT\`)
- Health: \`GET /health\` → 200 \`{ "ok": true }\`

## The event feed

\`POST /webhooks/payments\` receives one JSON event per request:

\`\`\`json
{
  "eventId": "evt_123",
  "paymentId": "pay_9",
  "type": "payment.captured",
  "amountCents": 5000,
  "sequence": 1
}
\`\`\`

- \`type\` is \`payment.captured\` or \`payment.refunded\`.
- \`eventId\` is globally unique per logical event. The provider may deliver the
  same event many times — respond 2xx every time, but apply it **exactly once**.
- \`sequence\` is the provider's per-payment ordering (1, 2, 3, …). Events may
  arrive in any order; the ledger's answers must be as if they were applied in
  sequence order.
- Malformed events (missing/invalid fields) → 400. Never crash.

## Deriving payment state

For each payment, replay its stored events **in sequence order**:

- A capture adds to \`capturedCents\`.
- A refund adds to \`refundedCents\` — **unless** at its position in the replay
  it would exceed what has been captured so far. Such a refund is an
  **anomaly**: it is excluded from all totals and reported at \`GET /anomalies\`.
- Anomaly status is **re-derived** as events arrive. Example: a refund of 1500
  at sequence 2 arrives first (captured-so-far is 0 → anomaly). Then the
  capture of 5000 at sequence 1 arrives. On replay the refund is now valid:
  it leaves the anomaly list and counts in the totals.

## Endpoints

- \`GET /payments/:paymentId\` → 200
  \`{ "paymentId", "capturedCents", "refundedCents", "netCents" }\`
  (netCents = capturedCents − refundedCents). Unknown payment → 404.
- \`GET /anomalies\` → 200 \`{ "anomalies": [{ "eventId", "paymentId", "reason" }] }\`
- \`GET /reconciliation\` → 200
  \`{ "totalCapturedCents", "totalRefundedCents", "netCents", "eventCount", "duplicateDeliveryCount" }\`
  — totals across all payments, consistent with every accepted (non-anomalous)
  event; \`eventCount\` counts unique stored events; \`duplicateDeliveryCount\`
  counts redundant deliveries you deduplicated.
- \`GET /health\` → 200 \`{ "ok": true }\`

## Persistence

Ledger state must survive a server restart. Files on disk are fine (a \`data/\`
directory is gitignored for you). No external database.
`;

const LEDGER_SERVER_JS = `const express = require("express");

const PORT = Number(process.env.PORT) || 3000;
const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

// See README.md for the full contract. Events arrive at-least-once and out of
// order; answers must be as if applied in sequence order, and state must
// survive a restart.

app.post("/webhooks/payments", (_req, res) => {
  res.status(501).json({ error: "not_implemented" });
});

app.get("/payments/:paymentId", (_req, res) => {
  res.status(501).json({ error: "not_implemented" });
});

app.get("/anomalies", (_req, res) => {
  res.status(501).json({ error: "not_implemented" });
});

app.get("/reconciliation", (_req, res) => {
  res.status(501).json({ error: "not_implemented" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(\`webhook-ledger listening on http://0.0.0.0:\${PORT}\`);
});
`;

const LEDGER_PACKAGE_JSON = `{
  "name": "webhook-ledger",
  "private": true,
  "version": "1.0.0",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.19.2"
  }
}
`;

const LEDGER_CHECKS = [
  "GET /health returns 200 with { ok: true }.",
  "Delivering the same webhook event twice counts it exactly once in the payment's totals.",
  "Events apply in sequence order even when they arrive out of order: a refund delivered before its capture still nets out correctly.",
  "A refund larger than the amount captured so far is excluded from totals and reported in GET /anomalies.",
  "Ledger state survives a server restart: a captured payment is still readable after the app restarts.",
  "GET /reconciliation reports ledger-wide totals consistent with every accepted event.",
];

const LEDGER_SPECS = [
  {
    id: "ledger-health",
    text: LEDGER_CHECKS[0],
    kind: "http",
    acceptance: {
      request: { method: "GET", path: "/health" },
      expect: { status: [200], bodyContains: ['"ok":true'] },
    },
  },
  {
    id: "ledger-idempotency",
    text: LEDGER_CHECKS[1],
    kind: "http_sequence",
    acceptance: {
      steps: [
        {
          label: "deliver capture",
          request: {
            method: "POST",
            path: "/webhooks/payments",
            json: {
              eventId: "evt-a1-{{nonce}}",
              paymentId: "pay-a-{{nonce}}",
              type: "payment.captured",
              amountCents: 5000,
              sequence: 1,
            },
          },
          expect: { status: [200, 201, 202] },
        },
        {
          label: "deliver the same event again",
          request: {
            method: "POST",
            path: "/webhooks/payments",
            json: {
              eventId: "evt-a1-{{nonce}}",
              paymentId: "pay-a-{{nonce}}",
              type: "payment.captured",
              amountCents: 5000,
              sequence: 1,
            },
          },
          expect: { status: [200, 201, 202] },
        },
        {
          label: "totals count it once",
          request: { method: "GET", path: "/payments/pay-a-{{nonce}}" },
          expect: {
            status: [200],
            json: [
              { path: "capturedCents", equals: 5000 },
              { path: "netCents", equals: 5000 },
            ],
          },
        },
      ],
    },
  },
  {
    id: "ledger-out-of-order",
    text: LEDGER_CHECKS[2],
    kind: "http_sequence",
    acceptance: {
      steps: [
        {
          label: "refund arrives first (sequence 2)",
          request: {
            method: "POST",
            path: "/webhooks/payments",
            json: {
              eventId: "evt-b2-{{nonce}}",
              paymentId: "pay-b-{{nonce}}",
              type: "payment.refunded",
              amountCents: 1500,
              sequence: 2,
            },
          },
          expect: { status: [200, 201, 202] },
        },
        {
          label: "capture arrives second (sequence 1)",
          request: {
            method: "POST",
            path: "/webhooks/payments",
            json: {
              eventId: "evt-b1-{{nonce}}",
              paymentId: "pay-b-{{nonce}}",
              type: "payment.captured",
              amountCents: 5000,
              sequence: 1,
            },
          },
          expect: { status: [200, 201, 202] },
        },
        {
          label: "replay by sequence nets out",
          request: { method: "GET", path: "/payments/pay-b-{{nonce}}" },
          expect: {
            status: [200],
            json: [
              { path: "capturedCents", equals: 5000 },
              { path: "refundedCents", equals: 1500 },
              { path: "netCents", equals: 3500 },
            ],
          },
        },
      ],
    },
  },
  {
    id: "ledger-anomaly",
    text: LEDGER_CHECKS[3],
    kind: "http_sequence",
    acceptance: {
      steps: [
        {
          label: "capture 2000",
          request: {
            method: "POST",
            path: "/webhooks/payments",
            json: {
              eventId: "evt-c1-{{nonce}}",
              paymentId: "pay-c-{{nonce}}",
              type: "payment.captured",
              amountCents: 2000,
              sequence: 1,
            },
          },
          expect: { status: [200, 201, 202] },
        },
        {
          label: "refund 5000 (over-refund)",
          request: {
            method: "POST",
            path: "/webhooks/payments",
            json: {
              eventId: "evt-c2-{{nonce}}",
              paymentId: "pay-c-{{nonce}}",
              type: "payment.refunded",
              amountCents: 5000,
              sequence: 2,
            },
          },
          expect: { status: [200, 201, 202] },
        },
        {
          label: "excluded from totals",
          request: { method: "GET", path: "/payments/pay-c-{{nonce}}" },
          expect: {
            status: [200],
            json: [
              { path: "refundedCents", equals: 0 },
              { path: "netCents", equals: 2000 },
            ],
          },
        },
        {
          label: "reported as anomaly",
          request: { method: "GET", path: "/anomalies" },
          expect: { status: [200], bodyContains: ["evt-c2-{{nonce}}"] },
        },
      ],
    },
  },
  {
    id: "ledger-persistence",
    text: LEDGER_CHECKS[4],
    kind: "restart_persistence",
    acceptance: {
      write: {
        label: "capture before restart",
        request: {
          method: "POST",
          path: "/webhooks/payments",
          json: {
            eventId: "evt-d1-{{nonce}}",
            paymentId: "pay-d-{{nonce}}",
            type: "payment.captured",
            amountCents: 7500,
            sequence: 1,
          },
        },
        expect: { status: [200, 201, 202] },
      },
      read: {
        label: "still there after restart",
        request: { method: "GET", path: "/payments/pay-d-{{nonce}}" },
        expect: {
          status: [200],
          json: [{ path: "capturedCents", equals: 7500 }],
        },
      },
    },
  },
  { id: "ledger-reconciliation", text: LEDGER_CHECKS[5], kind: "agent" },
];

const LEDGER_DEF: AssessmentDef = {
  title: "Webhook Ledger — Idempotent Payment Events",
  timeLimit: 75,
  candidateEmail: "demo.ledger@example.com",
  candidateName: "Ledger Demo Candidate",
  description: `Build the ingestion service behind a payments dashboard. The payment provider delivers webhook events **at least once** (duplicates happen) and **in no particular order** (a refund can arrive before its capture). Your service must keep the ledger correct anyway.

## The event feed

\`POST /webhooks/payments\` receives one JSON event per request: \`{ eventId, paymentId, type, amountCents, sequence }\`, where \`type\` is \`payment.captured\` or \`payment.refunded\`.

- \`eventId\` is globally unique. The same event may be delivered many times — respond 2xx every time, but apply it **exactly once**.
- \`sequence\` is the provider's per-payment ordering. Events arrive in any order; your answers must be as if they were applied in sequence order.
- Malformed events → 400. Never crash.

## Deriving payment state

Replay each payment's stored events in sequence order. A capture adds to \`capturedCents\`. A refund adds to \`refundedCents\` — unless at its position in the replay it would exceed what has been captured so far. Such a refund is an **anomaly**: excluded from all totals and reported at \`GET /anomalies\`. Anomaly status is re-derived as events arrive — a refund that arrived before its capture becomes valid once the capture shows up.

## Endpoints

- \`GET /payments/:paymentId\` → \`{ paymentId, capturedCents, refundedCents, netCents }\` (404 if unknown)
- \`GET /anomalies\` → \`{ anomalies: [{ eventId, paymentId, reason }] }\`
- \`GET /reconciliation\` → \`{ totalCapturedCents, totalRefundedCents, netCents, eventCount, duplicateDeliveryCount }\`
- \`GET /health\` → 200 \`{ ok: true }\`

## Constraints

State must survive a server restart — files on disk are fine, no external database. Money is integer cents everywhere.

## How to run

Install: \`npm install\` · Start: \`npm start\` · Port: \`3000\` (or \`PORT\`) · Health: \`/health\``,
  behavioralChecks: LEDGER_CHECKS,
  behavioralCheckSpecs: LEDGER_SPECS,
  evaluationCriteria: [
    "Inspects the starter files and README before the first edit",
    "Exercises duplicate and out-of-order deliveries against the running app rather than only the happy path",
    "Works in small verified steps — runs the app after a change instead of batching many changes untested",
    "Edits or rewrites agent-written code rather than leaving it untouched",
  ],
  starterCodeFiles: [
    { path: "README.md", content: LEDGER_README },
    { path: "package.json", content: LEDGER_PACKAGE_JSON },
    { path: "server.js", content: LEDGER_SERVER_JS },
    { path: ".gitignore", content: "node_modules/\ndata/\n" },
    { path: "data/.gitkeep", content: "" },
  ],
};

/* ------------------------------------------------------------------ */
/* 2. Flaky Checkout — debug a working order service                   */
/* ------------------------------------------------------------------ */

const CHECKOUT_README = `# Flaky Checkout

This order service is **live and mostly working** — but support has four open
tickets. Your job is to find and fix the causes **without breaking anything
that already works**. Prefer targeted fixes over rewrites.

## How to run

- Install: \`npm install\`
- Start: \`npm start\`
- Port: \`3000\` (or \`PORT\`)
- Health: \`GET /health\` → 200 \`{ "ok": true }\`

## Support tickets

1. **Totals are off by a cent.** Some carts total a cent or two less than the
   catalog prices say they should.
2. **Discount code rejected in lowercase.** A customer typed \`save10\` and got
   no discount; \`SAVE10\` works. Codes are supposed to be case-insensitive.
3. **We oversold the mug.** A cart that listed the same product on two separate
   lines got past the stock check, and stock went negative.
4. **Canceled orders don't restore stock.** After a cancellation, most of the
   reserved stock never came back.

## The rules (authoritative)

- All money in API responses is **integer cents**. The canonical unit price of
  a product is exactly the \`priceCents\` that \`GET /api/products/:id\` returns.
- Order pricing: \`subtotalCents\` = sum of \`priceCents × quantity\` per line;
  \`discountCents\` = the discount percentage applied to the subtotal, **rounded
  down to the whole cent**; \`totalCents\` = subtotal − discount.
- Discount codes are case-insensitive. \`SAVE10\` = 10%.
- An order is atomic: if the cart as a whole exceeds available stock (summing
  duplicate lines of the same product), respond 409 \`{ "error":
  "insufficient_stock" }\` and change **nothing**.
- Cancelling an order restores exactly the quantities that were reserved.

## API

- \`GET /api/products\` and \`GET /api/products/:id\` →
  \`{ id, name, priceCents, stock }\`
- \`POST /api/orders\` with \`{ ref, items: [{ productId, quantity }], discountCode? }\`
  → 201 \`{ ref, subtotalCents, discountCents, totalCents, items }\`.
  \`ref\` is a client-supplied unique reference.
- \`DELETE /api/orders/:ref\` → cancel the order, restore stock, 200.
- \`GET /api/orders\` → \`{ orders: [...] }\`

State is in-memory — restarts reset the catalog. That is expected here.
`;

const CHECKOUT_PACKAGE_JSON = `{
  "name": "flaky-checkout",
  "private": true,
  "version": "1.3.7",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.19.2"
  }
}
`;

const CHECKOUT_SERVER_JS = `const express = require("express");
const { router: ordersRouter } = require("./src/orders");
const { listProducts, findProduct, toPublicProduct } = require("./src/catalog");

const PORT = Number(process.env.PORT) || 3000;
const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/api/products", (_req, res) => {
  res.status(200).json({ products: listProducts().map(toPublicProduct) });
});

app.get("/api/products/:id", (req, res) => {
  const product = findProduct(req.params.id);
  if (!product) return res.status(404).json({ error: "unknown_product" });
  res.status(200).json(toPublicProduct(product));
});

app.use("/api/orders", ordersRouter);

app.listen(PORT, "0.0.0.0", () => {
  console.log(\`flaky-checkout listening on http://0.0.0.0:\${PORT}\`);
});
`;

const CHECKOUT_CATALOG_JS = `// Product catalog. Prices are stored in dollars as they come out of the
// merchant import; the API layer exposes integer cents.
const products = [
  { id: "tee", name: "Logo Tee", price: 19.99, stock: 500 },
  { id: "mug", name: "Camp Mug", price: 8.5, stock: 100 },
  { id: "cap", name: "Field Cap", price: 12.0, stock: 40 },
];

function listProducts() {
  return products;
}

function findProduct(id) {
  return products.find((p) => p.id === id) || null;
}

function toPublicProduct(product) {
  return {
    id: product.id,
    name: product.name,
    priceCents: Math.round(product.price * 100),
    stock: product.stock,
  };
}

module.exports = { listProducts, findProduct, toPublicProduct };
`;

const CHECKOUT_PRICING_JS = `// Order pricing. All API money is integer cents.
const DISCOUNT_CODES = { SAVE10: 10 };

function priceOrder(lines, discountCode) {
  let subtotalCents = 0;
  for (const line of lines) {
    subtotalCents += Math.floor(line.product.price * line.quantity * 100);
  }

  let discountCents = 0;
  if (discountCode && DISCOUNT_CODES[discountCode]) {
    const pct = DISCOUNT_CODES[discountCode];
    discountCents = Math.floor((subtotalCents * pct) / 100);
  }

  return {
    subtotalCents,
    discountCents,
    totalCents: subtotalCents - discountCents,
  };
}

module.exports = { priceOrder, DISCOUNT_CODES };
`;

const CHECKOUT_ORDERS_JS = `const express = require("express");
const { findProduct } = require("./catalog");
const { priceOrder } = require("./pricing");

const router = express.Router();
const orders = new Map();

router.get("/", (_req, res) => {
  res.status(200).json({ orders: Array.from(orders.values()) });
});

router.post("/", (req, res) => {
  const { ref, items, discountCode } = req.body || {};
  if (!ref || typeof ref !== "string") {
    return res.status(400).json({ error: "ref_required" });
  }
  if (orders.has(ref)) {
    return res.status(409).json({ error: "duplicate_ref" });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items_required" });
  }

  const lines = [];
  for (const item of items) {
    const product = findProduct(item && item.productId);
    if (!product) {
      return res.status(400).json({ error: "unknown_product" });
    }
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).json({ error: "invalid_quantity" });
    }
    if (quantity > product.stock) {
      return res.status(409).json({ error: "insufficient_stock" });
    }
    lines.push({ product, quantity });
  }

  for (const line of lines) {
    line.product.stock -= line.quantity;
  }

  const pricing = priceOrder(lines, discountCode);
  const order = {
    ref,
    items: lines.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
    ...pricing,
    createdAt: new Date().toISOString(),
    status: "placed",
  };
  orders.set(ref, order);
  res.status(201).json(order);
});

router.delete("/:ref", (req, res) => {
  const order = orders.get(req.params.ref);
  if (!order) {
    return res.status(404).json({ error: "unknown_order" });
  }
  if (order.status === "cancelled") {
    return res.status(409).json({ error: "already_cancelled" });
  }

  for (const item of order.items) {
    const product = findProduct(item.productId);
    if (product) {
      product.stock += 1;
    }
  }

  order.status = "cancelled";
  res.status(200).json(order);
});

module.exports = { router };
`;

const CHECKOUT_CHECKS = [
  "GET /health returns 200 with { ok: true }.",
  "An order of 4 'tee' items with discount code 'save10' totals exactly 7197 cents (subtotal 7996, discount 799).",
  "A cart that lists the same product on two lines exceeding stock is rejected with 409 and stock is unchanged.",
  "Cancelling an order restores exactly the quantities that were reserved.",
];

const CHECKOUT_SPECS = [
  {
    id: "checkout-health",
    text: CHECKOUT_CHECKS[0],
    kind: "http",
    acceptance: {
      request: { method: "GET", path: "/health" },
      expect: { status: [200], bodyContains: ['"ok":true'] },
    },
  },
  {
    id: "checkout-pricing",
    text: CHECKOUT_CHECKS[1],
    kind: "http",
    acceptance: {
      request: {
        method: "POST",
        path: "/api/orders",
        json: {
          ref: "ord-price-{{nonce}}",
          items: [{ productId: "tee", quantity: 4 }],
          discountCode: "save10",
        },
      },
      expect: {
        status: [201],
        json: [
          { path: "subtotalCents", equals: 7996 },
          { path: "discountCents", equals: 799 },
          { path: "totalCents", equals: 7197 },
        ],
      },
    },
  },
  {
    id: "checkout-oversell",
    text: CHECKOUT_CHECKS[2],
    kind: "http_sequence",
    acceptance: {
      steps: [
        {
          label: "duplicate-line cart over stock",
          request: {
            method: "POST",
            path: "/api/orders",
            json: {
              ref: "ord-over-{{nonce}}",
              items: [
                { productId: "mug", quantity: 60 },
                { productId: "mug", quantity: 60 },
              ],
            },
          },
          expect: { status: [409], bodyContains: ["insufficient_stock"] },
        },
        {
          label: "stock untouched",
          request: { method: "GET", path: "/api/products/mug" },
          expect: { status: [200], json: [{ path: "stock", equals: 100 }] },
        },
      ],
    },
  },
  {
    id: "checkout-cancel-restore",
    text: CHECKOUT_CHECKS[3],
    kind: "http_sequence",
    acceptance: {
      steps: [
        {
          label: "reserve 5 caps",
          request: {
            method: "POST",
            path: "/api/orders",
            json: {
              ref: "ord-cancel-{{nonce}}",
              items: [{ productId: "cap", quantity: 5 }],
            },
          },
          expect: { status: [201] },
        },
        {
          label: "stock reserved",
          request: { method: "GET", path: "/api/products/cap" },
          expect: { status: [200], json: [{ path: "stock", equals: 35 }] },
        },
        {
          label: "cancel",
          request: { method: "DELETE", path: "/api/orders/ord-cancel-{{nonce}}" },
          expect: { status: [200, 204] },
        },
        {
          label: "stock fully restored",
          request: { method: "GET", path: "/api/products/cap" },
          expect: { status: [200], json: [{ path: "stock", equals: 40 }] },
        },
      ],
    },
  },
];

const CHECKOUT_DEF: AssessmentDef = {
  title: "Flaky Checkout — Debug a Live Order Service",
  timeLimit: 60,
  candidateEmail: "demo.checkout@example.com",
  candidateName: "Checkout Demo Candidate",
  description: `This order service is **live and mostly working** — but support has four open tickets. Find and fix the causes **without breaking anything that already works**. Prefer targeted fixes over rewrites; the codebase is small but the bugs are subtle.

## Support tickets

1. **Totals are off by a cent.** Some carts total a cent or two less than the catalog prices say they should.
2. **Discount code rejected in lowercase.** A customer typed \`save10\` and got no discount; \`SAVE10\` works. Codes are supposed to be case-insensitive.
3. **We oversold the mug.** A cart that listed the same product on two separate lines got past the stock check, and stock went negative.
4. **Canceled orders don't restore stock.** After a cancellation, most of the reserved stock never came back.

## The rules (authoritative)

- All API money is **integer cents**. The canonical unit price of a product is exactly the \`priceCents\` that \`GET /api/products/:id\` returns.
- \`subtotalCents\` = sum of \`priceCents × quantity\` per line; \`discountCents\` = the discount percentage applied to the subtotal, **rounded down to the whole cent**; \`totalCents\` = subtotal − discount.
- Discount codes are case-insensitive. \`SAVE10\` = 10%.
- An order is atomic: if the cart as a whole exceeds available stock (summing duplicate lines of the same product), respond 409 \`{ "error": "insufficient_stock" }\` and change **nothing**.
- Cancelling an order (\`DELETE /api/orders/:ref\`) restores exactly the quantities that were reserved.

The full API contract is in the starter README. State is in-memory — restarts reset the catalog, which is expected here.

## How to run

Install: \`npm install\` · Start: \`npm start\` · Port: \`3000\` (or \`PORT\`) · Health: \`/health\``,
  behavioralChecks: CHECKOUT_CHECKS,
  behavioralCheckSpecs: CHECKOUT_SPECS,
  evaluationCriteria: [
    "Reproduces a reported bug against the running app before changing code",
    "Reads the existing code paths involved in a ticket before editing them",
    "Makes targeted fixes rather than wholesale rewrites of the starter",
    "Re-runs the failing scenario after each fix to confirm it",
  ],
  starterCodeFiles: [
    { path: "README.md", content: CHECKOUT_README },
    { path: "package.json", content: CHECKOUT_PACKAGE_JSON },
    { path: "server.js", content: CHECKOUT_SERVER_JS },
    { path: "src/catalog.js", content: CHECKOUT_CATALOG_JS },
    { path: "src/pricing.js", content: CHECKOUT_PRICING_JS },
    { path: "src/orders.js", content: CHECKOUT_ORDERS_JS },
    { path: ".gitignore", content: "node_modules/\n" },
  ],
};

/* ------------------------------------------------------------------ */
/* 3. Standup Board — full-stack build with enforced rules             */
/* ------------------------------------------------------------------ */

const BOARD_README = `# Standup Board

Build a small team task board: three columns, real rules, one Express process
serving both the page and the API. State must survive a restart (files on disk
are fine; a \`data/\` directory is gitignored for you). No external database.

## How to run

- Install: \`npm install\`
- Start: \`npm start\`
- Port: \`3000\` (or \`PORT\`)
- Health: \`GET /health\` → 200 \`{ "ok": true }\`

## Product rules (all enforced by the server, not just the UI)

- A task has a \`title\` (required), an optional \`owner\`, a \`status\` of
  \`todo\` → \`doing\` → \`done\`, and a \`blocked\` flag with an optional
  \`blockedReason\`.
- **WIP limit:** the Doing column holds at most **3** tasks. Moving a fourth
  task to \`doing\` → 409 \`{ "error": "doing_full" }\`, and the page shows the
  message **Doing is full** (exactly that text).
- **Blocked rule:** a blocked task cannot move to \`done\` → 409
  \`{ "error": "blocked" }\`. Unblock it first.
- **Owner filter:** \`GET /api/tasks?owner=<owner>\` returns only that owner's
  tasks (exact match).

## API

- \`POST /api/tasks\` with \`{ title, owner?, ref? }\` → 201 with the task.
  \`ref\` is an optional client-supplied unique reference; generate one when
  absent. New tasks start in \`todo\`, unblocked.
- \`GET /api/tasks\` → \`{ "tasks": [...] }\` (optionally filtered by \`?owner=\`)
- \`PATCH /api/tasks/ref/:ref\` with any of \`{ status, blocked, blockedReason,
  owner }\` → 200 with the updated task (or 409 per the rules above).
- \`GET /health\` → 200 \`{ "ok": true }\`

## UI contract (our automated review drives your page — keep these exact)

- Serve the board at \`/\`.
- A text input with placeholder exactly \`Task title\`, a second input with
  placeholder exactly \`Owner\`, and a button named \`Add task\`.
- Render each task as a **list item** (\`<li>\`) showing its title and owner.
- Each Todo task's row has a button named \`Start\` (moves it to Doing). Each
  Doing task's row has a button named \`Finish\` (moves it to Done).
- When the server refuses a move because Doing is full, show the message
  **Doing is full** somewhere on the page.
- Adding or moving a task updates the board without a manual page refresh.

Beyond the contract, layout and styling are yours.
`;

const BOARD_PACKAGE_JSON = `{
  "name": "standup-board",
  "private": true,
  "version": "1.0.0",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.19.2"
  }
}
`;

const BOARD_SERVER_JS = `const path = require("path");
const express = require("express");

const PORT = Number(process.env.PORT) || 3000;
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

// See README.md for the full contract: WIP limit of 3 on Doing, blocked tasks
// cannot move to done, owner filter, and state must survive a restart.

app.post("/api/tasks", (_req, res) => {
  res.status(501).json({ error: "not_implemented" });
});

app.get("/api/tasks", (_req, res) => {
  res.status(501).json({ error: "not_implemented" });
});

app.patch("/api/tasks/ref/:ref", (_req, res) => {
  res.status(501).json({ error: "not_implemented" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(\`standup-board listening on http://0.0.0.0:\${PORT}\`);
});
`;

const BOARD_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Standup Board</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; color: #21201c; }
      main { display: flex; gap: 1.5rem; align-items: flex-start; }
      section { flex: 1; background: #faf9f2; border-radius: 8px; padding: 1rem; }
      ul { list-style: none; padding: 0; }
      li { background: #fff; border-radius: 6px; padding: 0.5rem; margin-bottom: 0.5rem; }
      #message { min-height: 1.5rem; color: #a33; }
    </style>
  </head>
  <body>
    <h1>Standup Board</h1>
    <form id="add-form">
      <input type="text" placeholder="Task title" />
      <input type="text" placeholder="Owner" />
      <button type="submit">Add task</button>
    </form>
    <div id="message"></div>
    <main>
      <section><h2>Todo</h2><ul id="todo"></ul></section>
      <section><h2>Doing</h2><ul id="doing"></ul></section>
      <section><h2>Done</h2><ul id="done"></ul></section>
    </main>
    <script src="/app.js"></script>
  </body>
</html>
`;

const BOARD_APP_JS = `// Wire the board to the API. The markup in index.html already matches the
// UI contract in README.md — keep the placeholders, button names, and <li>
// task rows if you restructure it.

async function loadTasks() {
  // TODO: GET /api/tasks and render each task as an <li> in its column,
  // with a Start button on todo rows and a Finish button on doing rows.
}

document.getElementById("add-form").addEventListener("submit", (event) => {
  event.preventDefault();
  // TODO: POST /api/tasks, then reload the board without a page refresh.
});

loadTasks();
`;

const BOARD_CHECKS = [
  "GET /health returns 200 with { ok: true }.",
  "Adding a task through the page shows it on the board with its owner, without a manual refresh.",
  "GET /api/tasks?owner= returns only that owner's tasks.",
  "A blocked task cannot be moved to done until it is unblocked.",
  "The Doing column refuses a fourth task and the page shows 'Doing is full'.",
  "Tasks survive a server restart.",
];

const BOARD_SPECS = [
  {
    id: "board-health",
    text: BOARD_CHECKS[0],
    kind: "http",
    acceptance: {
      request: { method: "GET", path: "/health" },
      expect: { status: [200], bodyContains: ['"ok":true'] },
    },
  },
  {
    id: "board-create-ui",
    text: BOARD_CHECKS[1],
    kind: "ui",
    acceptance: {
      steps: [
        { action: "goto", path: "/" },
        { action: "fill_placeholder", placeholder: "Task title", value: "mk-{{nonce}}" },
        { action: "fill_placeholder", placeholder: "Owner", value: "casey-{{nonce}}" },
        { action: "click_role", role: "button", name: "Add task", exact: true },
        { action: "expect_text", text: "mk-{{nonce}}" },
        { action: "expect_in_row", hasText: "mk-{{nonce}}", text: "casey-{{nonce}}" },
      ],
    },
  },
  {
    id: "board-owner-filter",
    text: BOARD_CHECKS[2],
    kind: "http_sequence",
    acceptance: {
      steps: [
        {
          label: "task for owner A",
          request: {
            method: "POST",
            path: "/api/tasks",
            json: { title: "fa-{{nonce}}", owner: "oa-{{nonce}}", ref: "fa-{{nonce}}" },
          },
          expect: { status: [200, 201] },
        },
        {
          label: "task for owner B",
          request: {
            method: "POST",
            path: "/api/tasks",
            json: { title: "fb-{{nonce}}", owner: "ob-{{nonce}}", ref: "fb-{{nonce}}" },
          },
          expect: { status: [200, 201] },
        },
        {
          label: "filter returns only owner A",
          request: { method: "GET", path: "/api/tasks?owner=oa-{{nonce}}" },
          expect: {
            status: [200],
            bodyContains: ["fa-{{nonce}}"],
            bodyNotContains: ["fb-{{nonce}}"],
          },
        },
      ],
    },
  },
  {
    id: "board-blocked-rule",
    text: BOARD_CHECKS[3],
    kind: "http_sequence",
    acceptance: {
      steps: [
        {
          label: "create",
          request: {
            method: "POST",
            path: "/api/tasks",
            json: { title: "bl-{{nonce}}", ref: "bl-{{nonce}}" },
          },
          expect: { status: [200, 201] },
        },
        {
          label: "move to doing",
          request: {
            method: "PATCH",
            path: "/api/tasks/ref/bl-{{nonce}}",
            json: { status: "doing" },
          },
          expect: { status: [200] },
        },
        {
          label: "block it",
          request: {
            method: "PATCH",
            path: "/api/tasks/ref/bl-{{nonce}}",
            json: { blocked: true, blockedReason: "waiting on API keys" },
          },
          expect: { status: [200] },
        },
        {
          label: "refuse done while blocked",
          request: {
            method: "PATCH",
            path: "/api/tasks/ref/bl-{{nonce}}",
            json: { status: "done" },
          },
          expect: { status: [409], bodyContains: ["blocked"] },
        },
        {
          label: "unblock",
          request: {
            method: "PATCH",
            path: "/api/tasks/ref/bl-{{nonce}}",
            json: { blocked: false },
          },
          expect: { status: [200] },
        },
        {
          label: "now done succeeds",
          request: {
            method: "PATCH",
            path: "/api/tasks/ref/bl-{{nonce}}",
            json: { status: "done" },
          },
          expect: { status: [200], json: [{ path: "status", equals: "done" }] },
        },
      ],
    },
  },
  {
    id: "board-wip-limit-ui",
    text: BOARD_CHECKS[4],
    kind: "ui",
    acceptance: {
      steps: [
        { action: "goto", path: "/" },
        { action: "fill_placeholder", placeholder: "Task title", value: "w1-{{nonce}}" },
        { action: "click_role", role: "button", name: "Add task", exact: true },
        { action: "fill_placeholder", placeholder: "Task title", value: "w2-{{nonce}}" },
        { action: "click_role", role: "button", name: "Add task", exact: true },
        { action: "fill_placeholder", placeholder: "Task title", value: "w3-{{nonce}}" },
        { action: "click_role", role: "button", name: "Add task", exact: true },
        { action: "fill_placeholder", placeholder: "Task title", value: "w4-{{nonce}}" },
        { action: "click_role", role: "button", name: "Add task", exact: true },
        { action: "click_in_row", hasText: "w1-{{nonce}}", role: "button", name: "Start" },
        { action: "click_in_row", hasText: "w2-{{nonce}}", role: "button", name: "Start" },
        { action: "click_in_row", hasText: "w3-{{nonce}}", role: "button", name: "Start" },
        { action: "click_in_row", hasText: "w4-{{nonce}}", role: "button", name: "Start" },
        { action: "expect_text", text: "Doing is full" },
      ],
    },
  },
  {
    id: "board-persistence",
    text: BOARD_CHECKS[5],
    kind: "restart_persistence",
    acceptance: {
      write: {
        label: "create before restart",
        request: {
          method: "POST",
          path: "/api/tasks",
          json: { title: "keep-{{nonce}}", ref: "keep-{{nonce}}" },
        },
        expect: { status: [200, 201] },
      },
      read: {
        label: "still there after restart",
        request: { method: "GET", path: "/api/tasks" },
        expect: { status: [200], bodyContains: ["keep-{{nonce}}"] },
      },
    },
  },
];

const BOARD_DEF: AssessmentDef = {
  title: "Standup Board — Team Task Tracker",
  timeLimit: 90,
  candidateEmail: "demo.board@example.com",
  candidateName: "Board Demo Candidate",
  description: `Build a small team task board: three columns (Todo / Doing / Done), real rules, one Express process serving both the page and the API. The rules are **enforced by the server**, not just the UI, and they interact — read them all before you start.

## Product rules

- A task has a \`title\` (required), an optional \`owner\`, a \`status\` of \`todo\` → \`doing\` → \`done\`, and a \`blocked\` flag with an optional \`blockedReason\`.
- **WIP limit:** the Doing column holds at most **3** tasks. Moving a fourth task to \`doing\` → 409 \`{ "error": "doing_full" }\`, and the page shows the message **Doing is full** (exactly that text).
- **Blocked rule:** a blocked task cannot move to \`done\` → 409 \`{ "error": "blocked" }\`. Unblock it first.
- **Owner filter:** \`GET /api/tasks?owner=<owner>\` returns only that owner's tasks (exact match).
- Tasks survive a server restart — files on disk are fine, no external database.

## API

- \`POST /api/tasks\` with \`{ title, owner?, ref? }\` → 201 with the task (\`ref\` is an optional client-supplied unique reference; generate one when absent)
- \`GET /api/tasks\` → \`{ tasks: [...] }\`, optionally filtered by \`?owner=\`
- \`PATCH /api/tasks/ref/:ref\` with any of \`{ status, blocked, blockedReason, owner }\` → 200 with the updated task, or 409 per the rules
- \`GET /health\` → 200 \`{ ok: true }\`

## UI contract (our automated review drives your page — keep these exact)

A text input with placeholder \`Task title\`, an input with placeholder \`Owner\`, a button named \`Add task\`. Each task renders as a list item (\`<li>\`) showing its title and owner, with a \`Start\` button on Todo rows and a \`Finish\` button on Doing rows. A refused move shows **Doing is full** on the page. Adding or moving a task updates the board without a manual refresh. Beyond that, layout and styling are yours.

## How to run

Install: \`npm install\` · Start: \`npm start\` · Port: \`3000\` (or \`PORT\`) · Health: \`/health\``,
  behavioralChecks: BOARD_CHECKS,
  behavioralCheckSpecs: BOARD_SPECS,
  evaluationCriteria: [
    "Inspects the starter files and README before the first edit",
    "Builds and verifies one rule at a time rather than generating the whole app in one prompt",
    "Exercises the UI or API after wiring each rule",
    "Edits or rewrites agent-written code rather than leaving it untouched",
  ],
  starterCodeFiles: [
    { path: "README.md", content: BOARD_README },
    { path: "package.json", content: BOARD_PACKAGE_JSON },
    { path: "server.js", content: BOARD_SERVER_JS },
    { path: "public/index.html", content: BOARD_INDEX_HTML },
    { path: "public/app.js", content: BOARD_APP_JS },
    { path: ".gitignore", content: "node_modules/\ndata/\n" },
    { path: "data/.gitkeep", content: "" },
  ],
};

/* ------------------------------------------------------------------ */
/* Seeding                                                             */
/* ------------------------------------------------------------------ */

const ASSESSMENTS: AssessmentDef[] = [LEDGER_DEF, CHECKOUT_DEF, BOARD_DEF];

function validateSpecs(def: AssessmentDef) {
  const { specs, rejected } = parseBehavioralCheckSpecs(def.behavioralCheckSpecs);
  if (rejected.length) {
    throw new Error(
      `Invalid check specs on "${def.title}": ${rejected
        .map((r) => `#${r.index} ${r.reason}`)
        .join(" | ")}`
    );
  }
  for (const spec of specs) {
    if (!def.behavioralChecks.includes(spec.text)) {
      throw new Error(
        `Spec "${spec.id}" on "${def.title}" has text that matches no behavioral check`
      );
    }
  }
}

async function upsertForUser(user: { _id: unknown; email?: string }, def: AssessmentDef) {
  let assessment = await AssessmentModel.findOne({ userId: user._id, title: def.title });

  const payload = {
    userId: user._id,
    title: def.title,
    description: def.description,
    timeLimit: def.timeLimit,
    evidenceMode: "both",
    starterCodeFiles: def.starterCodeFiles,
    behavioralChecks: def.behavioralChecks,
    behavioralCheckSpecs: def.behavioralCheckSpecs,
    evaluationCriteria: def.evaluationCriteria,
  };

  if (assessment) {
    await AssessmentModel.updateOne({ _id: assessment._id }, { $set: payload });
    assessment = await AssessmentModel.findById(assessment._id);
    console.log(`Updated "${def.title}" for ${user.email}`);
  } else {
    assessment = await AssessmentModel.create(payload);
    console.log(`Created "${def.title}" for ${user.email}`);
  }
  if (!assessment) {
    throw new Error(`Failed to load assessment after upsert for ${user.email}`);
  }

  let submission = await SubmissionModel.findOne({
    assessmentId: assessment._id,
    candidateEmail: def.candidateEmail,
    status: { $in: ["pending", "in-progress"] },
  });

  if (!submission) {
    submission = await SubmissionModel.create({
      token: crypto.randomBytes(32).toString("hex"),
      assessmentId: assessment._id,
      candidateName: def.candidateName,
      candidateEmail: def.candidateEmail,
      status: "pending",
    });
    console.log("  created fresh candidate link");
  } else {
    console.log("  reusing pending/in-progress candidate link");
  }

  return {
    email: user.email,
    title: def.title,
    assessmentId: String(assessment._id),
    shareLink: `${getShareLinkBaseUrl()}/CandidateAssessment?token=${submission.token}`,
    dashboard: `${getShareLinkBaseUrl()}/SubmissionsDashboard?assessmentId=${assessment._id}`,
  };
}

async function main() {
  for (const def of ASSESSMENTS) validateSpecs(def);
  console.log("All check specs validate.\n");

  await connectMongoose();
  const results: Awaited<ReturnType<typeof upsertForUser>>[] = [];

  for (const email of OWNER_EMAILS) {
    const user = await UserModel.findOne({ email });
    if (!user) {
      console.warn("Skipping missing recruiter:", email);
      continue;
    }
    for (const def of ASSESSMENTS) {
      results.push(await upsertForUser(user, def));
    }
  }

  if (!results.length) {
    throw new Error(
      `No recruiters found. Tried: ${OWNER_EMAILS.join(", ")}. Sign in once, or set OWNER_EMAILS.`
    );
  }

  for (const row of results) {
    console.log(`\n${row.title}`);
    console.log("  account   :", row.email);
    console.log("  dashboard :", row.dashboard);
    console.log("  candidate :", row.shareLink);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
