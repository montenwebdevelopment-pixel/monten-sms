import type { ReactNode } from "react";
import { fmtNaira, StatCard } from "../adminApi";
import type { DeveloperProfileResponse, OrderRow, LedgerRow } from "./types";
import { Card, StatGrid, Empty, TableWrap, Th, Td, Pill, fmtCount, fmtDay, fmtDayTime } from "./parts";

type Profile = DeveloperProfileResponse;

const ORDER_STATUS_TONE: Record<string, "green" | "amber" | "red" | "slate" | "blue"> = {
  completed: "green",
  pending: "amber",
  waiting: "blue",
  failed: "red",
  cancelled: "slate",
};

const ORDER_STATUS_LABEL: Record<string, string> = {
  completed: "Successful",
  pending: "Pending",
  waiting: "Pending",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function StatusPill({ status }: { status: string }) {
  return <Pill tone={ORDER_STATUS_TONE[status] ?? "slate"}>{ORDER_STATUS_LABEL[status] ?? status}</Pill>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mt-0.5 text-sm text-slate-800 break-words">{children}</div>
    </div>
  );
}

export function InfoSection({ developer, summary }: { developer: Profile["developer"]; summary: Profile["summary"] }) {
  return (
    <Card title="Developer information" subtitle="Account details and recent activity">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
        <Field label="Full name">{developer.full_name || "Not set"}</Field>
        <Field label="Email">{developer.email || "Not set"}</Field>
        <Field label="Developer account ID">
          <span className="font-mono text-xs">{developer.user_id}</span>
        </Field>
        <Field label="Username">{developer.username ? `@${developer.username}` : "Not set"}</Field>
        <Field label="Registered">{fmtDay(developer.registered_at)}</Field>
        <Field label="Account status">
          <Pill tone={developer.account_status === "active" ? "green" : "red"}>
            {developer.account_status === "active" ? "Active" : "Suspended"}
          </Pill>
          {developer.account_status === "suspended" && developer.status_reason && (
            <span className="block text-xs text-slate-500 mt-1">Reason: {developer.status_reason}</span>
          )}
        </Field>
        <Field label="Last login">{fmtDayTime(developer.last_login_at ?? developer.last_sign_in_at)}</Field>
        <Field label="Last API activity">{fmtDayTime(developer.last_api_at)}</Field>
        <Field label="API keys">
          {fmtCount(summary.keys_active)} active of {fmtCount(summary.keys_total)}
        </Field>
        <Field label="Webhooks">{fmtCount(summary.webhooks_active)} active</Field>
      </div>
    </Card>
  );
}

function RankedList({ items, empty, strip }: { items: { name: string; count: number }[]; empty: string; strip?: string }) {
  if (items.length === 0) return <Empty text={empty} />;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((i) => (
        <span key={i.name} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700">
          <span className="font-medium">{strip ? i.name.replace(strip, "") : i.name}</span>
          <span className="text-slate-400">{fmtCount(i.count)}</span>
        </span>
      ))}
    </div>
  );
}

function OrdersTable({ rows, emptyText, kind }: { rows: OrderRow[]; emptyText: string; kind: "phone" | "email" }) {
  if (rows.length === 0) return <Empty text={emptyText} />;
  return (
    <TableWrap minWidth={kind === "phone" ? 860 : 760}>
      <thead>
        <tr>
          <Th>Date</Th>
          <Th>Order ref</Th>
          <Th>Service</Th>
          <Th>{kind === "phone" ? "Country" : "Address"}</Th>
          {kind === "phone" && <Th>Number</Th>}
          <Th>Amount</Th>
          <Th>Status</Th>
          <Th>Note</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((o) => (
          <tr key={o.id} className="border-t border-slate-100">
            <Td className="whitespace-nowrap">{fmtDayTime(o.created_at)}</Td>
            <Td className="font-mono text-xs">{o.order_ref}</Td>
            <Td>{o.service}</Td>
            <Td>{kind === "phone" ? o.country ?? "-" : o.address ?? "-"}</Td>
            {kind === "phone" && <Td className="font-mono text-xs">{o.phone ?? "-"}</Td>}
            <Td className="whitespace-nowrap font-medium">{fmtNaira(o.amount)}</Td>
            <Td>
              <StatusPill status={o.status} />
            </Td>
            <Td className="text-xs text-slate-500 max-w-[220px]">{o.error ?? "-"}</Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

export function PhoneSection({ phone }: { phone: Profile["phone"] }) {
  const s = phone.stats;
  return (
    <Card title="Phone number purchases" subtitle="Successful means a paid order that delivered a number">
      <StatGrid>
        <StatCard label="Total purchases" value={fmtCount(s.total)} />
        <StatCard label="Successful" value={fmtCount(s.success)} tone="success" />
        <StatCard label="Pending" value={fmtCount(s.pending)} tone="info" />
        <StatCard label="Failed" value={fmtCount(s.failed)} tone="danger" />
        <StatCard label="Cancelled" value={fmtCount(s.cancelled)} />
        <StatCard label="Money spent" value={fmtNaira(s.spent_success)} sub="Successful orders only" tone="success" />
        <StatCard label="Held (pending)" value={fmtNaira(s.spent_pending)} sub="Not yet final" />
      </StatGrid>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Countries</p>
          <RankedList items={phone.countries} empty="No country activity yet" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Services</p>
          <RankedList items={phone.services} empty="No service activity yet" strip="Phone: " />
        </div>
      </div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mt-6 mb-2">Purchase history</p>
      <OrdersTable rows={phone.history} emptyText="This developer has not bought any phone numbers through the API." kind="phone" />
    </Card>
  );
}

export function EmailSection({ email }: { email: Profile["email"] }) {
  const s = email.stats;
  return (
    <Card title="Email OTP purchases" subtitle="Email OTP orders placed through the API">
      <StatGrid>
        <StatCard label="Total purchases" value={fmtCount(s.total)} />
        <StatCard label="Successful" value={fmtCount(s.success)} tone="success" />
        <StatCard label="Pending" value={fmtCount(s.pending)} tone="info" />
        <StatCard label="Failed" value={fmtCount(s.failed)} tone="danger" />
        <StatCard label="Cancelled" value={fmtCount(s.cancelled)} />
      </StatGrid>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mt-6 mb-2">Purchase history</p>
      <OrdersTable rows={email.history} emptyText="This developer has not bought any email OTPs through the API." kind="email" />
    </Card>
  );
}

const LEDGER_TONE: Record<string, "green" | "amber" | "red" | "slate"> = {
  completed: "green",
  pending: "amber",
  failed: "red",
  cancelled: "slate",
};

export function FinanceSection({ finance }: { finance: Profile["finance"] }) {
  const o = finance.orders;
  return (
    <Card title="Financial breakdown" subtitle="Wallet activity linked to this developer">
      <StatGrid>
        <StatCard label="Wallet balance" value={fmtNaira(finance.wallet_balance)} tone="info" />
        <StatCard label="Deposited" value={fmtNaira(finance.deposits.completed_amount)} sub={`${fmtCount(finance.deposits.completed_count)} completed deposits`} tone="success" />
        <StatCard label="API purchases" value={fmtNaira(o.completed_amount)} sub={`${fmtCount(o.completed_count)} successful orders`} />
        <StatCard label="Refunded to wallet" value={fmtNaira(finance.api_refunded.amount)} sub={`${fmtCount(finance.api_refunded.count)} refunds`} />
        <StatCard label="Pending holds" value={fmtNaira(o.pending_amount)} sub={`${fmtCount(o.pending_count)} pending orders`} tone="warning" />
        <StatCard label="Successful transactions" value={fmtCount(o.completed_count)} tone="success" />
        <StatCard label="Pending transactions" value={fmtCount(o.pending_count)} tone="warning" />
        <StatCard label="Failed transactions" value={fmtCount(o.failed_count)} tone="danger" sub={`${fmtCount(o.cancelled_count)} cancelled`} />
      </StatGrid>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mt-6 mb-2">Wallet ledger</p>
      {finance.ledger.length === 0 ? (
        <Empty text="No wallet transactions linked to this developer yet." />
      ) : (
        <TableWrap minWidth={680}>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Type</Th>
              <Th>Reference</Th>
              <Th>Description</Th>
              <Th>Amount</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {finance.ledger.map((l: LedgerRow) => (
              <tr key={l.id} className="border-t border-slate-100">
                <Td className="whitespace-nowrap">{fmtDayTime(l.created_at)}</Td>
                <Td className="capitalize">{l.type}</Td>
                <Td className="font-mono text-xs">{l.reference ?? "-"}</Td>
                <Td className="text-xs text-slate-500">{l.description ?? "-"}</Td>
                <Td className="whitespace-nowrap font-medium">{fmtNaira(l.amount)}</Td>
                <Td>
                  <Pill tone={LEDGER_TONE[l.status] ?? "slate"}>{l.status}</Pill>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </Card>
  );
}
