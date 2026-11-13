import { useState } from "react";
import { adminFetch, StatCard } from "../adminApi";
import type { ApiKeyRow, DeveloperProfileResponse, TicketRow } from "./types";
import { ConfirmModal } from "./ConfirmModal";
import { Card, StatGrid, Empty, TableWrap, Th, Td, Pill, fmtCount, fmtDay, fmtDayTime } from "./parts";

type Profile = DeveloperProfileResponse;

function keyStatus(k: ApiKeyRow): { label: string; tone: "green" | "amber" | "red" } {
  if (k.revoked_at) return { label: "Revoked", tone: "red" };
  if (!k.active) return { label: "Paused", tone: "amber" };
  return { label: "Active", tone: "green" };
}

export function ApiSection({ api, onChanged }: { api: Profile["api"]; onChanged: () => void }) {
  const t = api.totals;
  const hooks = api.webhooks.counts;
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const revoke = async () => {
    if (!revokeTarget) return;
    setBusy(true);
    setError("");
    try {
      await adminFetch(`developer-keys/${revokeTarget.id}`, { json: { active: false } });
      setRevokeTarget(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke this key.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card title="API performance" subtitle="Requests made with this developer's API keys">
        <StatGrid>
          <StatCard label="Total requests" value={fmtCount(t.requests)} />
          <StatCard label="Successful" value={fmtCount(t.ok)} tone="success" />
          <StatCard label="Failed" value={fmtCount(t.failed)} tone="danger" />
          <StatCard label="Last request" value={fmtDayTime(t.last_at)} />
        </StatGrid>

        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mt-6 mb-2">Most used endpoints</p>
        {api.endpoints.length === 0 ? (
          <Empty text="No API requests recorded yet." />
        ) : (
          <TableWrap minWidth={620}>
            <thead>
              <tr>
                <Th>Method</Th>
                <Th>Endpoint</Th>
                <Th>Requests</Th>
                <Th>Failed</Th>
                <Th>Last used</Th>
              </tr>
            </thead>
            <tbody>
              {api.endpoints.map((e) => (
                <tr key={`${e.method} ${e.endpoint}`} className="border-t border-slate-100">
                  <Td className="font-mono text-xs">{e.method}</Td>
                  <Td className="font-mono text-xs break-all">{e.endpoint}</Td>
                  <Td>{fmtCount(e.requests)}</Td>
                  <Td className={e.failed > 0 ? "text-red-600 font-medium" : ""}>{fmtCount(e.failed)}</Td>
                  <Td className="whitespace-nowrap">{fmtDayTime(e.last_at)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}

        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mt-6 mb-2">Webhook deliveries</p>
        <StatGrid>
          <StatCard label="Deliveries" value={fmtCount(hooks.total)} />
          <StatCard label="Delivered" value={fmtCount(hooks.delivered)} tone="success" />
          <StatCard label="Pending" value={fmtCount(hooks.pending)} tone="info" />
          <StatCard label="Failed" value={fmtCount(hooks.failed)} tone="danger" />
        </StatGrid>
        {api.webhooks.endpoints.length > 0 && (
          <ul className="mt-3 space-y-2">
            {api.webhooks.endpoints.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                <span className="font-mono text-xs text-slate-700 break-all">{w.url}</span>
                <Pill tone={w.active ? "green" : "slate"}>{w.active ? "Active" : "Inactive"}</Pill>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mt-6 mb-2">API keys</p>
        {api.keys.length === 0 ? (
          <Empty text="This developer has not created any API keys." />
        ) : (
          <TableWrap minWidth={760}>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Key prefix</Th>
                <Th>Environment</Th>
                <Th>Status</Th>
                <Th>Created</Th>
                <Th>Last used</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {api.keys.map((k) => {
                const st = keyStatus(k);
                return (
                  <tr key={k.id} className="border-t border-slate-100">
                    <Td>{k.name}</Td>
                    <Td className="font-mono text-xs">{k.key_prefix}...</Td>
                    <Td className="capitalize">{k.environment}</Td>
                    <Td>
                      <Pill tone={st.tone}>{st.label}</Pill>
                    </Td>
                    <Td className="whitespace-nowrap">{fmtDay(k.created_at)}</Td>
                    <Td className="whitespace-nowrap">{fmtDayTime(k.last_used_at)}</Td>
                    <Td>
                      {!k.revoked_at && (
                        <button
                          type="button"
                          onClick={() => {
                            setError("");
                            setRevokeTarget(k);
                          }}
                          className="text-xs font-semibold text-red-600 hover:text-red-700"
                        >
                          Revoke key
                        </button>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <ConfirmModal
        open={revokeTarget !== null}
        title="Revoke this API key?"
        description={
          <>
            <span className="font-mono text-xs">{revokeTarget?.key_prefix}...</span> will stop working immediately. The developer will need a new key to continue. This action is recorded in the audit log.
          </>
        }
        confirmLabel="Revoke key"
        tone="danger"
        busy={busy}
        error={error}
        onConfirm={revoke}
        onClose={() => setRevokeTarget(null)}
      />
    </>
  );
}

export function SupportSection({ tickets }: { tickets: TicketRow[] }) {
  return (
    <Card title="Support history" subtitle="Support tickets opened from this developer's account">
      {tickets.length === 0 ? (
        <Empty text="No support tickets from this developer." />
      ) : (
        <TableWrap minWidth={760}>
          <thead>
            <tr>
              <Th>Case</Th>
              <Th>Subject</Th>
              <Th>Category</Th>
              <Th>Priority</Th>
              <Th>Status</Th>
              <Th>Opened</Th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.id} className="border-t border-slate-100">
                <Td className="font-mono text-xs">{t.case_ref ?? "-"}</Td>
                <Td>
                  {t.subject}
                  {t.escalated && <span className="ml-2"><Pill tone="red">Escalated</Pill></span>}
                </Td>
                <Td className="capitalize">{t.category ?? "-"}</Td>
                <Td className="capitalize">{t.priority ?? "-"}</Td>
                <Td className="capitalize">{t.status.replace(/_/g, " ")}</Td>
                <Td className="whitespace-nowrap">{fmtDayTime(t.created_at)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </Card>
  );
}
