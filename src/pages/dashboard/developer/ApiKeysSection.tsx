import { useEffect, useState } from "react";
import { KeyRound, Plus, Trash2, RotateCcw, Copy, Check, Loader2, ToggleLeft, ToggleRight, ShieldCheck } from "lucide-react";
import { devFetch, copyText } from "./devFetch";
import type { DevKey } from "./keys";

export function ApiKeysSection({ changed }: { changed: number }) {
  const [keys, setKeys] = useState<DevKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [env, setEnv] = useState<"test" | "production">("test");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    try {
      const body = await devFetch<{ keys: DevKey[] }>("keys");
      setKeys(body.keys ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load keys");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [changed]);

  const create = async () => {
    setCreating(true);
    setError("");
    try {
      const body = await devFetch<{ secret: string; key: DevKey }>("keys", { json: { name: name.trim() || undefined, environment: env } });
      setKeys((prev) => [body.key as unknown as DevKey, ...prev]);
      setNewSecret(body.secret);
      setName("");
      setShowCreate(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setCreating(false);
    }
  };

  const toggle = async (k: DevKey) => {
    setBusyId(k.id);
    try {
      await devFetch(`keys/${k.id}`, { method: "PUT", json: { active: !k.active } });
      setKeys((prev) => prev.map((x) => (x.id === k.id ? { ...x, active: !k.active, revoked_at: !k.active ? null : x.revoked_at } : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update key");
    } finally {
      setBusyId(null);
    }
  };

  const regenerate = async (k: DevKey) => {
    setBusyId(k.id);
    try {
      const body = await devFetch<{ secret: string }>(`keys/${k.id}`, { method: "DELETE", json: { regenerate: true } });
      setNewSecret(body.secret);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate key");
    } finally {
      setBusyId(null);
    }
  };

  const revoke = async (k: DevKey) => {
    setBusyId(k.id);
    try {
      await devFetch(`keys/${k.id}`, { method: "DELETE", json: {} });
      setKeys((prev) => prev.map((x) => (x.id === k.id ? { ...x, active: false, revoked_at: new Date().toISOString() } : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke key");
    } finally {
      setBusyId(null);
    }
  };

  const copySecret = async () => {
    if (newSecret && (await copyText(newSecret))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  return (
    <div>
      {newSecret && (
        <div className="mb-5 bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-emerald-800 font-semibold text-sm mb-2">
            <ShieldCheck className="w-4 h-4" /> Save your key now — it will never be shown again
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white border border-emerald-200 rounded-lg px-3 py-2 text-xs sm:text-sm font-mono break-all text-navy-900">{newSecret}</code>
            <button onClick={copySecret} className="flex-shrink-0 p-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-base" aria-label="Copy key">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-emerald-700 mt-2">Store it in a safe place. If you lose it, you can regenerate the key from the list below.</p>
          <button onClick={() => setNewSecret(null)} className="text-xs font-medium text-emerald-700 hover:text-emerald-900 mt-2 underline">I've saved it</button>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-error-600 bg-error-50 border border-error-200 rounded-lg px-3 py-2">{error}</p>}

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500">{keys.length} of 5 keys used</p>
        <button
          onClick={() => setShowCreate(!showCreate)}
          disabled={keys.filter((k) => k.active).length >= 5}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-royal-600 hover:bg-royal-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-sm font-semibold transition-base"
        >
          <Plus className="w-4 h-4" /> Create API Key
        </button>
      </div>

      {showCreate && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5">
          <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">Key name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. My app backend"
            maxLength={50}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-royal-500"
          />
          <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">Environment</label>
          <div className="grid grid-cols-2 gap-2 mb-4">
            <button onClick={() => setEnv("test")} className={`px-4 py-2.5 rounded-lg text-sm font-medium border transition-base ${env === "test" ? "border-royal-600 bg-royal-50 text-royal-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
              Test — safe, same data
            </button>
            <button onClick={() => setEnv("production")} className={`px-4 py-2.5 rounded-lg text-sm font-medium border transition-base ${env === "production" ? "border-navy-900 bg-navy-900 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
              Production — live purchases
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={create} disabled={creating} className="px-4 py-2 rounded-lg bg-royal-600 hover:bg-royal-700 disabled:opacity-60 text-white text-sm font-semibold transition-base inline-flex items-center gap-2">
              {creating && <Loader2 className="w-4 h-4 animate-spin" />} Generate Key
            </button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-base">Cancel</button>
          </div>
        </div>
      )}

      {keys.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
          <KeyRound className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No API keys yet. Create your first key to start calling the Monten SMS API.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map((k) => (
            <div key={k.id} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-navy-900 text-sm">{k.name}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${k.environment === "production" ? "bg-navy-900 text-white" : "bg-amber-100 text-amber-700"}`}>{k.environment}</span>
                  {!k.active && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-red-100 text-red-600">revoked</span>}
                </div>
                <code className="text-xs text-slate-400 font-mono block mt-1">{k.key_prefix}••••••••••••••••</code>
                <p className="text-[11px] text-slate-400 mt-1">
                  Created {new Date(k.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
                  {k.last_used_at ? ` · Last used ${new Date(k.last_used_at).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : " · Never used"}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button onClick={() => toggle(k)} disabled={busyId === k.id} aria-label={k.active ? "Deactivate key" : "Re-activate key"} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-base">
                  {k.active ? <ToggleRight className="w-5 h-5 text-emerald-600" /> : <ToggleLeft className="w-5 h-5" />}
                </button>
                <button onClick={() => regenerate(k)} disabled={busyId === k.id || !k.active} aria-label="Regenerate key" title="Regenerate (shows a new secret once)" className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 disabled:opacity-40 transition-base">
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button onClick={() => revoke(k)} disabled={busyId === k.id || !k.active} aria-label="Revoke key" title="Revoke permanently" className="p-2 rounded-lg hover:bg-red-50 text-red-500 disabled:opacity-40 transition-base">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
