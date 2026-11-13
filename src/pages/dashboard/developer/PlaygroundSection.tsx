import { useState } from "react";
import { FlaskConical, Loader2, Send, ChevronDown, ChevronRight, Info } from "lucide-react";
import { devFetch } from "./devFetch";

interface PlayResult {
  status: number;
  response_ms: number;
  body: unknown;
}

interface Endpoints {
  name: string;
  method: "GET" | "POST";
  path: string;
  desc: string;
  sample: string;
}

const ENDPOINTS: Endpoints[] = [
  { name: "List countries", method: "GET", path: "phone/countries", desc: "All countries with numbers in stock.", sample: "" },
  { name: "List services", method: "GET", path: "phone/services/usa", desc: "Services available in a country (try: usa, england, russia).", sample: "" },
  { name: "Check inventory & price", method: "GET", path: "phone/inventory/usa/telegram", desc: "Available numbers and price in naira.", sample: "" },
  { name: "Wallet balance", method: "GET", path: "wallet", desc: "Your wallet balance.", sample: "" },
  { name: "My phone orders", method: "GET", path: "phone/orders", desc: "Your last 100 phone orders.", sample: "" },
  { name: "Email services", method: "GET", path: "email/services", desc: "Email OTP services with price.", sample: "" },
  {
    name: "Buy phone number (REAL PURCHASE)",
    method: "POST",
    path: "phone/purchase",
    desc: "Debits your wallet and buys a real number from the provider.",
    sample: JSON.stringify({ country: "usa", service: "telegram", order_ref: "demo_ref_0001" }, null, 2),
  },
  {
    name: "Buy email address (REAL PURCHASE)",
    method: "POST",
    path: "email/purchase",
    desc: "Debits your wallet and rents a real email address.",
    sample: JSON.stringify({ service: "instagram", order_ref: "demo_email_01" }, null, 2),
  },
];

export function PlaygroundSection() {
  const [selected, setSelected] = useState<number>(0);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [payload, setPayload] = useState("{}");
  const [result, setResult] = useState<PlayResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [confirmStep, setConfirmStep] = useState(false);

  const ep = ENDPOINTS[selected];

  const pick = (i: number) => {
    setSelected(i);
    setPayload(ENDPOINTS[i].method === "POST" ? ENDPOINTS[i].sample : "{}");
    setResult(null);
    setError("");
    setConfirmStep(false);
  };

  const run = async (confirm: boolean) => {
    setRunning(true);
    setError("");
    setResult(null);
    try {
      let parsed: unknown = {};
      if (ep.method === "POST") {
        try {
          parsed = JSON.parse(payload);
        } catch {
          setError("Request body is not valid JSON.");
          setRunning(false);
          return;
        }
      }
      const body = await devFetch<PlayResult>("playground", {
        json: { endpoint: ep.path, method: ep.method, payload: parsed, confirm },
      });
      setResult(body);
      setConfirmStep(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Playground call failed");
    } finally {
      setRunning(false);
    }
  };

  const isPurchase = ep.method === "POST";

  return (
    <div className="space-y-5">
      <div className="bg-royal-50 border border-royal-100 rounded-xl p-4 flex items-start gap-3">
        <Info className="w-4 h-4 text-royal-600 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-navy-800">
          The playground runs real calls against the live API using a temporary single-use key — your saved keys are never exposed. GET endpoints are free to try; purchase endpoints spend real wallet money and require an extra confirmation.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {ENDPOINTS.map((e, i) => (
          <div key={e.path + i}>
            <button onClick={() => (expanded.has(i) ? setExpanded((s) => new Set([...s].filter((x) => x !== i))) : setExpanded((s) => new Set(s).add(i)))} className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50 transition-base">
              {expanded.has(i) ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${e.method === "GET" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"}`}>{e.method}</span>
              <span className="text-sm font-medium text-navy-900">{e.name}</span>
              {selected === i && <span className="ml-auto text-[11px] font-semibold text-royal-600">selected</span>}
            </button>
            {expanded.has(i) && (
              <div className="px-4 pb-3 text-xs text-slate-500">
                <p className="font-mono text-slate-600 mb-1">/{e.path}</p>
                <p>{e.desc}</p>
                <button onClick={() => pick(i)} className="mt-2 text-[11px] font-semibold text-royal-600 hover:text-royal-700 underline">Load in playground</button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <FlaskConical className="w-4 h-4 text-royal-600" />
          <span className="text-sm font-semibold text-navy-900">Request</span>
        </div>
        <p className="text-xs text-slate-500 mb-2 font-mono">{ep.method} /{ep.path}</p>
        {ep.method === "POST" ? (
          <textarea
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            rows={6}
            spellCheck={false}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-royal-500"
          />
        ) : (
          <p className="text-xs text-slate-400">No request body needed for GET requests.</p>
        )}
        <div className="mt-3">
          {isPurchase && !confirmStep ? (
            <button onClick={() => setConfirmStep(true)} disabled={running} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition-base">
              <Send className="w-4 h-4" /> Run (purchase — needs confirmation)
            </button>
          ) : isPurchase ? (
            <div className="flex items-center gap-2">
              <button onClick={() => run(true)} disabled={running} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-base">
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Yes, charge my wallet and run
              </button>
              <button onClick={() => setConfirmStep(false)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-50">Cancel</button>
            </div>
          ) : (
            <button onClick={() => run(false)} disabled={running} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-royal-600 hover:bg-royal-700 text-white text-sm font-semibold transition-base">
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Run request
            </button>
          )}
        </div>
        {isPurchase && <p className="text-[11px] text-orange-600 mt-2 font-medium">This makes a real provider purchase and debits your wallet. Use a unique order_ref or you'll get the earlier order back (idempotency).</p>}
      </div>

      {error && <p className="text-sm text-error-600 bg-error-50 border border-error-200 rounded-lg px-3 py-2">{error}</p>}

      {result && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center gap-3 text-xs">
            <span className="font-semibold text-slate-600">Response</span>
            <span className={`px-2 py-0.5 rounded font-bold ${result.status < 400 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>{result.status}</span>
            <span className="text-slate-400">{result.response_ms} ms</span>
          </div>
          <pre className="p-4 text-xs font-mono overflow-x-auto max-h-96 text-navy-900 whitespace-pre-wrap">{JSON.stringify(result.body, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
