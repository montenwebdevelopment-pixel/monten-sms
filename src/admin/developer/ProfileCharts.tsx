import type { ReactNode } from "react";
import { fmtNaira } from "../adminApi";
import type { ApiDayPoint, DeveloperProfileResponse, SeriesPoint } from "./types";
import { Card, Empty, fmtCount } from "./parts";

type Charts = DeveloperProfileResponse["charts"];

function bucketLabel(date: string): string {
  if (date.length === 7) {
    const [y, m] = date.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-NG", { month: "short", year: "numeric" });
  }
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-NG", { day: "numeric", month: "short", timeZone: "UTC" });
}

function ChartCard({ title, subtitle, total, children }: { title: string; subtitle: string; total: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        </div>
        <p className="text-sm font-bold text-slate-900 whitespace-nowrap">{total}</p>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function BarSeries({ data, color, money = false }: { data: SeriesPoint[]; color: string; money?: boolean }) {
  if (data.length === 0 || data.every((d) => d.n === 0)) return <Empty text="No activity in this period" />;
  const max = Math.max(1, ...data.map((d) => d.n));
  const fmt = (n: number) => (money ? fmtNaira(n) : fmtCount(n));
  return (
    <div>
      <div className="flex h-36 items-end gap-[3px]">
        {data.map((d) => (
          <div key={d.date} className="flex-1 h-full flex items-end min-w-[3px]" title={`${bucketLabel(d.date)}: ${fmt(d.n)}`}>
            <div className={`w-full rounded-t ${color} transition-all duration-500`} style={{ height: `${Math.max((d.n / max) * 100, d.n > 0 ? 4 : 0)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-slate-400">
        <span>{bucketLabel(data[0].date)}</span>
        <span>{bucketLabel(data[data.length - 1].date)}</span>
      </div>
    </div>
  );
}

function RequestSeries({ data }: { data: ApiDayPoint[] }) {
  if (data.length === 0 || data.every((d) => d.requests === 0)) return <Empty text="No API requests in this period" />;
  const max = Math.max(1, ...data.map((d) => d.requests));
  return (
    <div>
      <div className="flex h-36 items-end gap-[3px]">
        {data.map((d) => (
          <div
            key={d.date}
            className="flex-1 h-full flex flex-col justify-end min-w-[3px]"
            title={`${bucketLabel(d.date)}: ${fmtCount(d.ok)} successful, ${fmtCount(d.failed)} failed`}
          >
            <div className="w-full rounded-t bg-red-400 transition-all duration-500" style={{ height: `${(d.failed / max) * 100}%` }} />
            <div className="w-full bg-emerald-500 transition-all duration-500" style={{ height: `${(d.ok / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-slate-400">
        <span>{bucketLabel(data[0].date)}</span>
        <span>{bucketLabel(data[data.length - 1].date)}</span>
      </div>
      <div className="mt-3 flex gap-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />Successful</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-red-400" />Failed</span>
      </div>
    </div>
  );
}

const sum = (points: SeriesPoint[]) => points.reduce((acc, p) => acc + p.n, 0);

export function ChartsSection({ charts }: { charts: Charts }) {
  const apiTotal = charts.apiDaily.reduce((acc, p) => acc + p.requests, 0);
  const apiFailed = charts.apiDaily.reduce((acc, p) => acc + p.failed, 0);
  return (
    <Card title="Performance charts" subtitle="Last 30 days of daily activity; weekly and monthly views cover the last 12 weeks and 12 months">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Number purchases per day" subtitle="Successful phone number orders" total={`${fmtCount(sum(charts.numbersDaily))} orders`}>
          <BarSeries data={charts.numbersDaily} color="bg-blue-500" />
        </ChartCard>
        <ChartCard title="Number purchases per week" subtitle="Successful phone number orders, weeks starting Monday" total={`${fmtCount(sum(charts.numbersWeekly))} orders`}>
          <BarSeries data={charts.numbersWeekly} color="bg-blue-400" />
        </ChartCard>
        <ChartCard title="Number purchases per month" subtitle="Successful phone number orders" total={`${fmtCount(sum(charts.numbersMonthly))} orders`}>
          <BarSeries data={charts.numbersMonthly} color="bg-blue-300" />
        </ChartCard>
        <ChartCard title="Spending per day" subtitle="Successful purchases only" total={fmtNaira(sum(charts.spendDaily))}>
          <BarSeries data={charts.spendDaily} color="bg-emerald-500" money />
        </ChartCard>
        <ChartCard title="API request activity" subtitle="Requests per day" total={`${fmtCount(apiTotal)} requests`}>
          <BarSeries data={charts.apiDaily.map((p) => ({ date: p.date, n: p.requests }))} color="bg-slate-700" />
        </ChartCard>
        <ChartCard title="Successful vs failed requests" subtitle="Daily split of API responses" total={`${fmtCount(apiTotal - apiFailed)} ok / ${fmtCount(apiFailed)} failed`}>
          <RequestSeries data={charts.apiDaily} />
        </ChartCard>
      </div>
    </Card>
  );
}
