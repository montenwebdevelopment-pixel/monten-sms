import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { copyText } from "./devFetch";

export interface DocEndpoint {
  method: "GET" | "POST";
  path: string;
  title: string;
  desc: string;
  params?: [string, string][];
  response: string;
}

export const PHONE_DOCS: DocEndpoint[] = [
  {
    method: "GET", path: "phone/countries", title: "List countries",
    desc: "Countries with phone numbers currently available.",
    response: `{ "countries": [ { "code": "usa", "name": "United States" }, ... ] }`,
  },
  {
    method: "GET", path: "phone/services/{country}", title: "List services in a country",
    desc: "All services (Telegram, WhatsApp, Instagram...) available for a country.",
    params: [["country", "Country code from phone/countries, e.g. usa"]],
    response: `{ "services": [ { "code": "telegram", "name": "Telegram" }, ... ] }`,
  },
  {
    method: "GET", path: "phone/inventory/{country}/{service}", title: "Check stock and price",
    desc: "How many numbers are available and the price in naira.",
    response: `{ "country": "usa", "service": "telegram", "available_numbers": 412, "price_naira": 1850, "currency": "NGN" }`,
  },
  {
    method: "POST", path: "phone/purchase", title: "Buy a phone number",
    desc: "Purchases a number and debits your wallet. Idempotent: repeat the same order_ref and you get the same order back, never a double charge.",
    params: [
      ["country", "Country code, e.g. usa"],
      ["service", "Service code, e.g. telegram"],
      ["order_ref", "Your unique reference (8–64 chars). Generate one per order."],
    ],
    response: `{ "order_ref": "order_abc123", "order_id": "1234567", "phone": "+1...", "status": "waiting", "amount": 1850 }`,
  },
  {
    method: "GET", path: "phone/orders/{order_ref}", title: "Get order / OTP code",
    desc: "Poll an order until status becomes completed and otp is returned. Pro tip: subscribe to the otp.received webhook instead of polling.",
    response: `{ "order_ref": "order_abc123", "status": "completed", "otp": "418293", ... }`,
  },
  {
    method: "POST", path: "phone/cancel/{order_ref}", title: "Cancel a waiting order",
    desc: "Cancels an order that is still waiting for an SMS. The wallet charge is refunded. Orders that already received an OTP cannot be cancelled.",
    response: `{ "order_ref": "order_abc123", "status": "cancelled", "refunded": 1850 }`,
  },
];

export const EMAIL_DOCS: DocEndpoint[] = [
  {
    method: "GET", path: "email/services", title: "List email services",
    desc: "Services that support email-address OTP, with the fixed price per order.",
    response: `{ "services": [ { "code": "instagram", "name": "Instagram", "category": "social" } ], "price_per_order_naira": 238 }`,
  },
  {
    method: "POST", path: "email/purchase", title: "Rent an email address",
    desc: "Rents a real email address for receiving an OTP, debits your wallet, idempotent by order_ref.",
    params: [
      ["service", "Service code from email/services"],
      ["order_ref", "Your unique reference (8–64 chars)"],
    ],
    response: `{ "order_ref": "email_001", "email": "user7x2@...", "status": "waiting", "amount": 238 }`,
  },
  {
    method: "GET", path: "email/orders/{order_ref}", title: "Get email order / code",
    desc: "Poll until status is completed and the otp field contains the code.",
    response: `{ "order_ref": "email_001", "status": "completed", "email": "user7x2@...", "otp": "826193" }`,
  },
];

export const COMMON_DOCS: DocEndpoint[] = [
  {
    method: "GET", path: "wallet", title: "Wallet balance",
    desc: "Your developer wallet balance in naira. Fund it from the normal Fund Wallet page — the same wallet powers both the website and the API.",
    response: `{ "wallet_balance": 12500, "currency": "NGN" }`,
  },
  {
    method: "GET", path: "health", title: "Health check",
    desc: "No API key required. Use it in monitoring scripts.",
    response: `{ "ok": true, "service": "montensms-developer-api", "version": "1.0" }`,
  },
];

const BASE_NOTE = `Base URL: https://montensms.com/api/v1  (proxied to Monten's API gateway)
Auth header on every call: Authorization: Bearer YOUR_API_KEY`;

function CodeBlock({ title, code, lang }: { title: string; code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyText(code)) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">{title} · {lang}</span>
        <button onClick={copy} className="inline-flex items-center gap-1 text-xs font-semibold text-royal-600 hover:text-royal-700">
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="p-4 text-xs font-mono overflow-x-auto text-navy-900 whitespace-pre">{code}</pre>
    </div>
  );
}

function EndpointDoc({ ep }: { ep: DocEndpoint }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${ep.method === "GET" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"}`}>{ep.method}</span>
        <code className="text-sm font-mono text-navy-900">/{ep.path}</code>
      </div>
      <p className="text-sm text-slate-600 mb-2">{ep.desc}</p>
      {ep.params && (
        <div className="mb-2">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1">Body parameters</p>
          <ul className="text-xs text-slate-600 space-y-0.5">
            {ep.params.map(([name, d]) => (
              <li key={name}><code className="font-mono text-navy-800">{name}</code> — {d}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mb-3">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1">Example response</p>
        <pre className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-[11px] font-mono overflow-x-auto text-navy-800 whitespace-pre">{ep.response}</pre>
      </div>
    </div>
  );
}

const JS_EXAMPLE = `${BASE_NOTE}

const res = await fetch("https://montensms.com/api/v1/phone/purchase", {
  method: "POST",
  headers: {
    "Authorization": "Bearer mk_live_YOUR_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    country: "usa",
    service: "telegram",
    order_ref: "order_" + crypto.randomUUID(), // unique per order
  }),
});
const order = await res.json();

// Poll (or wait for the otp.received webhook) until completed:
const status = await fetch(
  \`https://montensms.com/api/v1/phone/orders/\${order.order_ref}\`,
  { headers: { "Authorization": "Bearer mk_live_YOUR_KEY" } }
);
const { otp } = await status.json();`;

const PHP_EXAMPLE = `<?php
// Base URL: https://montensms.com/api/v1
$ch = curl_init("https://montensms.com/api/v1/phone/purchase");
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => [
    "Authorization: Bearer mk_live_YOUR_KEY",
    "Content-Type: application/json",
  ],
  CURLOPT_POSTFIELDS => json_encode([
    "country" => "usa",
    "service" => "telegram",
    "order_ref" => "order_" . uniqid(), // unique per order
  ]),
]);
$order = json_decode(curl_exec($ch), true);

// Poll until completed (or use the otp.received webhook):
$check = file_get_contents(
  "https://montensms.com/api/v1/phone/orders/" . $order["order_ref"],
  false,
  stream_context_create(["http" => [
    "header" => "Authorization: Bearer mk_live_YOUR_KEY",
  ]])
);
$data = json_decode($check, true);
echo $data["otp"];`;

const PY_EXAMPLE = `# Base URL: https://montensms.com/api/v1
import requests, uuid

API = "https://montensms.com/api/v1"
HEADERS = {"Authorization": "Bearer mk_live_YOUR_KEY"}

r = requests.post(f"{API}/phone/purchase", headers=HEADERS, json={
    "country": "usa",
    "service": "telegram",
    "order_ref": f"order_{uuid.uuid4().hex[:12]}",  # unique per order
})
order = r.json()

# Poll (or wait for the otp.received webhook) until completed:
status = requests.get(
    f"{API}/phone/orders/{order['order_ref']}", headers=HEADERS
).json()
print(status["otp"])`;

const WEBHOOK_VERIFY_EXAMPLE = `// Node.js example — verifying a Monten webhook
import crypto from "crypto";

app.post("/monten-webhook", express.raw({ type: "*/*" }), (req, res) => {
  const signature = req.get("X-Monten-Signature") || "";
  const expected = crypto
    .createHmac("sha256", WEBHOOK_SECRET) // your webhook signing secret
    .update(req.body)                    // raw request body
    .digest("hex");
  if (signature !== expected) return res.sendStatus(401);

  const event = JSON.parse(req.body); // order.created | otp.received |
                                      // order.cancelled | order.failed
  res.sendStatus(200);
});`;

export function DocsSection({ subset }: { subset?: "phone" | "email" }) {
  const sections: { title: string; docs: DocEndpoint[] }[] = [
    ...(subset !== "email" ? [{ title: "Phone Number OTP API", docs: PHONE_DOCS }] : []),
    ...(subset !== "phone" ? [{ title: "Email OTP API", docs: EMAIL_DOCS }] : []),
    { title: "Common", docs: COMMON_DOCS },
  ];
  return (
    <div className="space-y-6">
      <div className="bg-navy-900 rounded-xl p-5 text-white">
        <h3 className="font-bold mb-2">Getting started</h3>
        <ol className="text-sm text-slate-300 space-y-1.5 list-decimal list-inside">
          <li>Create an API key in the API Keys tab. Test keys behave exactly like production keys; use them while integrating.</li>
          <li>Send the key on every request: <code className="font-mono text-royal-200">Authorization: Bearer mk_...</code></li>
          <li>Fund your Monten wallet — API purchases spend the same wallet balance as the website.</li>
          <li>Send a unique <code className="font-mono text-royal-200">order_ref</code> with every purchase. Repeating it never double-charges.</li>
          <li>Handle rate limits: too many requests per minute returns HTTP 429.</li>
        </ol>
      </div>

      {sections.map((s) => (
        <section key={s.title}>
          <h3 className="font-bold text-navy-900 mb-3">{s.title}</h3>
          <div className="space-y-3">{s.docs.map((ep) => <EndpointDoc key={ep.path} ep={ep} />)}</div>
        </section>
      ))}

      <section>
        <h3 className="font-bold text-navy-900 mb-3">Code examples</h3>
        <div className="space-y-3">
          <CodeBlock title="Full flow" lang="JavaScript" code={JS_EXAMPLE} />
          <CodeBlock title="Full flow" lang="PHP" code={PHP_EXAMPLE} />
          <CodeBlock title="Full flow" lang="Python" code={PY_EXAMPLE} />
        </div>
      </section>

      <section>
        <h3 className="font-bold text-navy-900 mb-3">Webhooks</h3>
        <p className="text-sm text-slate-600 mb-3">
          Add a webhook endpoint in the Webhooks tab. Monten POSTs a JSON body for every event with an
          <code className="font-mono text-xs bg-slate-100 px-1 rounded mx-1">X-Monten-Signature</code>
          header = HMAC-SHA256 of the raw body using your signing secret. Failed deliveries retry after 1, 5 and 30 minutes.
          Events: <code className="font-mono text-xs">order.created</code>, <code className="font-mono text-xs">otp.received</code>,
          <code className="font-mono text-xs">order.cancelled</code>, <code className="font-mono text-xs">order.failed</code>.
        </p>
        <CodeBlock title="Verify signatures" lang="Node.js" code={WEBHOOK_VERIFY_EXAMPLE} />
      </section>

      <section>
        <h3 className="font-bold text-navy-900 mb-3">Error codes</h3>
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 text-sm">
          {[
            ["401 UNAUTHORIZED", "Missing or invalid API key."],
            ["402 INSUFFICIENT_FUNDS", "Wallet balance too low — no charge was made."],
            ["404 NOT_FOUND / OUT_OF_STOCK", "Unknown order_ref, or no numbers in stock."],
            ["429 RATE_LIMITED", "Too many requests — slow down and retry with backoff."],
            ["502 PURCHASE_FAILED / UPSTREAM_ERROR", "Provider problem. Wallet purchases are auto-refunded."],
            ["503 API_DISABLED", "The Developer API is temporarily disabled by Monten."],
          ].map(([code, desc]) => (
            <div key={code} className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center gap-1">
              <code className="font-mono text-xs font-bold text-navy-900 sm:w-64 flex-shrink-0">{code}</code>
              <span className="text-xs text-slate-600">{desc}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
