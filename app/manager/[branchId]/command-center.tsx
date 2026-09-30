"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Check,
  Info,
  Lightbulb,
  Loader2,
  MessageSquareText,
  Network,
  Sparkles,
  TrendingDown,
  X,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, minutesSince, useBranchState, useSimNow, type BranchState } from "@/lib/client/live";
import { fmtDate, fmtTime } from "@/lib/clock";
import { SERVICE_BY_ID } from "@/lib/data/catalog";
import type { Branch, Category, Recommendation } from "@/lib/types";
import { cn } from "@/lib/utils";

// Validated categorical slots (dataviz reference palette, light): blue, orange, aqua.
export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a"];
const CAT: Category[] = ["QUICK", "STANDARD", "COMPLEX"];
const CAT_NAME: Record<Category, string> = { QUICK: "Quick", STANDARD: "Standard", COMPLEX: "Complex" };
const TARGET: Record<Category, number> = { QUICK: 10, STANDARD: 15, COMPLEX: 20 };
const AXIS = { fontSize: 12, fill: "#52514e" };
const GRID = "#e7e6e1";

type Tab = "live" | "forecast" | "recs" | "insights";

export function CommandCenter({ branch }: { branch: Branch }) {
  const [tab, setTab] = useState<Tab>("live");
  const { data, error, refresh } = useBranchState(branch.id, 4000);
  const now = useSimNow(data?.sim);

  // keep the engine ticking while the manager is watching (alerts + recommendations)
  useEffect(() => {
    const tick = () => api("/api/engine", { branchId: branch.id }).catch(() => undefined);
    tick();
    const t = setInterval(tick, 8000);
    return () => clearInterval(t);
  }, [branch.id]);

  const openRecs = data?.recommendations.filter((r) => r.status === "OPEN").length ?? 0;
  const TABS: { id: Tab; label: string; icon: typeof Activity; badge?: number }[] = [
    { id: "live", label: "Live", icon: Activity, badge: data?.alerts.length },
    { id: "forecast", label: "Forecast", icon: BarChart3 },
    { id: "recs", label: "Recommendations", icon: Lightbulb, badge: openRecs },
    { id: "insights", label: "Insights", icon: MessageSquareText },
  ];

  return (
    <main className="min-h-screen bg-muted/40 pb-16">
      <header className="bg-brand-800 text-white">
        <div className="container flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-brand-200 hover:text-white">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <div className="text-lg font-semibold">Command center · {branch.name.replace("Sample Demo Bank — ", "")}</div>
              <div className="text-xs text-brand-200">
                {fmtTime(now)} {data?.sim.running ? `· simulator ${data.sim.speed}×` : ""}
              </div>
            </div>
          </div>
          <Link href="/manager/network" className="flex items-center gap-1 rounded-md border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10">
            <Network className="h-4 w-4" /> Network
          </Link>
        </div>
        <nav className="container flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn("flex items-center gap-2 rounded-t-md px-4 py-2 text-sm", tab === t.id ? "bg-muted/95 text-brand-900" : "text-brand-100 hover:bg-white/10")}
            >
              <t.icon className="h-4 w-4" /> {t.label}
              {!!t.badge && <span className="rounded-full bg-status-red px-1.5 text-xs text-white">{t.badge}</span>}
            </button>
          ))}
        </nav>
      </header>

      <div className="container mt-5">
        {!data ? (
          <div className="flex justify-center py-20 text-muted-foreground">{error ? `Error: ${error}` : <Loader2 className="h-6 w-6 animate-spin" />}</div>
        ) : tab === "live" ? (
          <LiveTab data={data} now={now} onGoRecs={() => setTab("recs")} />
        ) : tab === "forecast" ? (
          <ForecastTab branchId={branch.id} />
        ) : tab === "recs" ? (
          <RecsTab recs={data.recommendations} onChange={refresh} />
        ) : (
          <InsightsTab branchId={branch.id} />
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- Live

function LiveTab({ data, now, onGoRecs }: { data: BranchState; now: Date; onGoRecs: () => void }) {
  const kpi = useMemo(() => {
    const served = data.tokens.filter((t) => t.status === "COMPLETED" && t.called_at);
    const waits = served.map((t) => minutesSince(t.original_arrival_at, new Date(t.called_at!))).sort((a, b) => a - b);
    const sla = served.filter((t) => minutesSince(t.original_arrival_at, new Date(t.called_at!)) <= SERVICE_BY_ID[t.service_id].target_wait_min).length;
    const called = data.tokens.filter((t) => t.called_at || t.status === "NO_SHOW").length;
    const noShow = data.tokens.filter((t) => t.status === "NO_SHOW").length;
    const digital = served.filter((t) => t.could_be_digital).length;
    return {
      avg: waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0,
      p90: waits[Math.floor(waits.length * 0.9)] ?? 0,
      sla: served.length ? (100 * sla) / served.length : 100,
      served: served.length,
      noShowPct: called ? (100 * noShow) / called : 0,
      digital,
      waiting: data.tokens.filter((t) => t.status === "WAITING").length,
    };
  }, [data]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <Kpi label="Waiting now" value={kpi.waiting} />
        <Kpi label="Avg wait" value={`${kpi.avg.toFixed(1)}m`} />
        <Kpi label="P90 wait" value={`${kpi.p90.toFixed(0)}m`} />
        <Kpi label="SLA met" value={`${kpi.sla.toFixed(0)}%`} tone={kpi.sla < 70 ? "bad" : kpi.sla < 85 ? "warn" : "good"} />
        <Kpi label="Served" value={kpi.served} />
        <Kpi label="No-shows" value={`${kpi.noShowPct.toFixed(0)}%`} />
        <Kpi label="Could be digital" value={kpi.digital} hint="served today but doable online" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Queues vs target</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              {CAT.map((c) => {
                const w = data.waitByCategory[c] ?? 0;
                const n = data.tokens.filter((t) => t.status === "WAITING" && SERVICE_BY_ID[t.service_id].category === c).length;
                const ratio = w / TARGET[c];
                return (
                  <div key={c} className="rounded-lg border bg-white p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{CAT_NAME[c]}</span>
                      <span className="text-muted-foreground">{n} waiting</span>
                    </div>
                    <div className="mt-1 text-2xl font-bold">
                      {Math.round(w)} min <span className="text-sm font-normal text-muted-foreground">/ {TARGET[c]} target</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-muted">
                      <div
                        className={cn("h-2 rounded-full", ratio > 1.5 ? "bg-status-red" : ratio > 1 ? "bg-status-amber" : "bg-status-green")}
                        style={{ width: `${Math.min(100, ratio * 50)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Counters</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {data.counters.map((c) => {
                const staff = data.staff.find((s) => s.id === c.staff_id);
                const cur = data.tokens.find((t) => t.counter_id === c.id && (t.status === "CALLED" || t.status === "SERVING"));
                const el = cur?.serving_started_at ? minutesSince(cur.serving_started_at, now) : 0;
                const avg = cur ? (data.avgHandle[cur.service_id] ?? 5) : 0;
                return (
                  <div
                    key={c.id}
                    className={cn(
                      "rounded-lg border-l-4 bg-white p-3 text-sm shadow-sm",
                      c.status === "OFFLINE" ? "border-slate-300 opacity-60" : c.status === "ON_BREAK" ? "border-status-amber" : c.status === "SERVING" ? "border-brand-600" : "border-status-green"
                    )}
                  >
                    <div className="flex justify-between">
                      <b>Counter {c.number}</b>
                      <span className="text-xs text-muted-foreground">{c.status.replace("_", " ").toLowerCase()}</span>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {staff?.name ?? "—"} · {c.mode_skill?.toLowerCase() ?? "—"}
                    </div>
                    {cur ? (
                      <div className={cn("mt-1 font-mono", el > 2.5 * avg ? "text-status-red" : el > 1.5 * avg ? "text-status-amber" : "")}>
                        {cur.code} · {cur.status === "SERVING" ? `${el.toFixed(0)}/${avg.toFixed(0)}m` : "called"}
                      </div>
                    ) : c.status === "ON_BREAK" ? (
                      <div className="mt-1 text-xs">back {fmtTime(c.break_expected_end)}</div>
                    ) : (
                      <div className="mt-1 text-xs text-muted-foreground">idle</div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-status-amber" /> Open alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.alerts.length === 0 && <p className="text-sm text-muted-foreground">All clear — no bottlenecks detected.</p>}
            {data.alerts.map((a) => (
              <div key={a.id} className={cn("rounded-lg border p-3 text-sm", a.severity === "CRITICAL" ? "border-status-red/50 bg-status-red/5" : a.severity === "WARN" ? "border-status-amber/50 bg-status-amber/5" : "bg-white")}>
                <div className="flex items-center justify-between">
                  <b>{a.title}</b>
                  <Badge variant={a.severity === "CRITICAL" ? "red" : a.severity === "WARN" ? "amber" : "secondary"}>{a.severity.toLowerCase()}</Badge>
                </div>
                <p className="mt-1 text-muted-foreground">{a.why}</p>
                <div className="mt-1 text-[11px] text-muted-foreground">{fmtTime(a.at)}</div>
              </div>
            ))}
            {data.recommendations.some((r) => r.status === "OPEN") && (
              <Button variant="outline" className="w-full" onClick={onGoRecs}>
                <Lightbulb /> See recommended actions
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone, hint }: { label: string; value: string | number; tone?: "good" | "warn" | "bad"; hint?: string }) {
  return (
    <div className="rounded-lg border bg-white p-3" title={hint}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-2xl font-bold", tone === "bad" && "text-status-red", tone === "warn" && "text-status-amber", tone === "good" && "text-status-green")}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------- Forecast

interface ForecastCellUi {
  hour: number;
  category: Category;
  expected: number;
  actual?: number | null;
  explanation: { base: number; factors: { name: string; label: string; value: number }[]; booked: number; formula: string };
}
interface StaffRow {
  hour: number;
  category: Category;
  expected: number;
  needed: number;
  rostered: number;
}
interface ForecastData {
  today: string;
  tomorrow: string;
  nowHour: number;
  cells: ForecastCellUi[];
  tomorrowCells: ForecastCellUi[];
  staffingToday: StaffRow[];
  staffingTomorrow: StaffRow[];
  mape: { hourly: number; daily: number; days: number; series: { date: string; actual: number; forecast: number }[] };
}

function ForecastTab({ branchId }: { branchId: string }) {
  const [f, setF] = useState<ForecastData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cat, setCat] = useState<Category>("QUICK");
  const [day, setDay] = useState<"today" | "tomorrow">("today");
  const [explain, setExplain] = useState<number | null>(null);

  useEffect(() => {
    api<ForecastData>(`/api/forecast/${branchId}`).then(setF).catch((e) => setErr((e as Error).message));
  }, [branchId]);

  if (!f) return <div className="flex justify-center py-20">{err ? <p className="text-destructive">{err}</p> : <Loader2 className="h-6 w-6 animate-spin" />}</div>;

  const cells = (day === "today" ? f.cells : f.tomorrowCells).filter((c) => c.category === cat);
  const staffing = day === "today" ? f.staffingToday : f.staffingTomorrow;
  const hours = [...new Set(staffing.map((s) => s.hour))];
  const staffChart = hours.map((h) => {
    const rows = staffing.filter((s) => s.hour === h && s.category === cat);
    return { hour: `${h}:00`, needed: rows[0]?.needed ?? 0, rostered: rows[0]?.rostered ?? 0 };
  });
  const chart = cells.map((c) => ({ hour: `${c.hour}:00`, expected: c.expected, actual: c.actual ?? null }));
  const ex = explain != null ? (day === "today" ? f.cells : f.tomorrowCells).filter((c) => c.hour === explain) : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Seg value={day} onChange={setDay} options={[{ v: "today", l: `Today · ${fmtDate(f.today)}` }, { v: "tomorrow", l: `Next day · ${fmtDate(f.tomorrow)}` }]} />
        <Seg value={cat} onChange={setCat} options={CAT.map((c) => ({ v: c, l: CAT_NAME[c] }))} />
        <div className="ml-auto rounded-lg border bg-white px-4 py-2 text-sm">
          Forecast accuracy (backtest, last {f.mape.days} working days): <b>{f.mape.daily}% MAPE daily</b> · {f.mape.hourly}% hourly
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-base">{CAT_NAME[cat]} arrivals per hour</CardTitle>
            <CardDescription>Bars: forecast · line: actual so far. Click an hour below for the explanation.</CardDescription>
          </CardHeader>
          <CardContent className="h-72 pt-4">
            <ResponsiveContainer>
              <ComposedChart data={chart} margin={{ left: -10, right: 8 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="hour" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                <Legend />
                <Bar dataKey="expected" name="Forecast" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={36} />
                {day === "today" && <Line dataKey="actual" name="Actual" stroke={SERIES[1]} strokeWidth={2} dot={{ r: 4 }} connectNulls={false} />}
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-base">{CAT_NAME[cat]} counters: needed vs rostered</CardTitle>
            <CardDescription>Erlang C — minimum counters so 80% wait ≤ {TARGET[cat]} min</CardDescription>
          </CardHeader>
          <CardContent className="h-72 pt-4">
            <ResponsiveContainer>
              <BarChart data={staffChart} margin={{ left: -10, right: 8 }} barGap={2}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="hour" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                <Legend />
                <Bar dataKey="needed" name="Needed (Erlang C)" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="rostered" name="Rostered with skill" fill={SERIES[2]} radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="h-4 w-4" /> Explain an hour
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {hours.map((h) => (
              <button key={h} onClick={() => setExplain(explain === h ? null : h)} className={cn("rounded-md border px-3 py-1 text-sm", explain === h && "border-primary bg-secondary")}>
                {h}:00
              </button>
            ))}
          </div>
          {ex.length > 0 && (
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1">Category</th>
                  <th>Base (history, same weekday)</th>
                  <th>Factors</th>
                  <th>Booked</th>
                  <th className="text-right">Expected</th>
                </tr>
              </thead>
              <tbody>
                {ex.map((c) => (
                  <tr key={c.category} className="border-t">
                    <td className="py-1.5">{CAT_NAME[c.category]}</td>
                    <td>{c.explanation.base}</td>
                    <td>{c.explanation.factors.length ? c.explanation.factors.map((x) => `×${x.value} ${x.label}`).join(", ") : "none"}</td>
                    <td>{c.explanation.booked}</td>
                    <td className="text-right font-semibold">{c.expected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-base">Backtest: daily arrivals, forecast vs actual</CardTitle>
          <CardDescription>Trained only on days before the test window</CardDescription>
        </CardHeader>
        <CardContent className="h-60 pt-4">
          <ResponsiveContainer>
            <LineChart data={f.mape.series.map((s) => ({ ...s, day: fmtDate(s.date) }))} margin={{ left: -10, right: 8 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="day" tick={AXIS} axisLine={false} tickLine={false} />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} />
              <Tooltip />
              <Legend />
              <Line dataKey="forecast" name="Forecast" stroke={SERIES[0]} strokeWidth={2} dot={false} />
              <Line dataKey="actual" name="Actual" stroke={SERIES[1]} strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; l: string }[] }) {
  return (
    <div className="inline-flex rounded-lg border bg-white p-0.5">
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)} className={cn("rounded-md px-3 py-1.5 text-sm", value === o.v ? "bg-primary text-white" : "hover:bg-accent")}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Recommendations

function RecsTab({ recs, onChange }: { recs: Recommendation[]; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, string>>({});
  const gain = (r: Recommendation) => {
    const i = r.impact as { before?: number; after?: number };
    return i.before != null && i.after != null ? i.before - i.after : 0;
  };
  const open = recs.filter((r) => r.status === "OPEN").sort((a, b) => gain(b) - gain(a));
  const done = recs.filter((r) => r.status !== "OPEN" && !(r.impact as { expired?: boolean }).expired).slice(0, 10);

  async function decide(id: string, decision: "ACCEPT" | "DISMISS") {
    setBusy(id);
    try {
      const r = await api<{ result?: string }>(`/api/recommendations/${id}`, { decision });
      if (r.result) setResult((x) => ({ ...x, [id]: r.result! }));
      onChange();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        {open.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">No actions needed right now. Recommendations appear when a queue is projected over target.</CardContent>
          </Card>
        )}
        {open.map((r) => (
          <RecCard key={r.id} r={r} busy={busy === r.id} onAccept={() => decide(r.id, "ACCEPT")} onDismiss={() => decide(r.id, "DISMISS")} />
        ))}
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Decision log</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {done.length === 0 && <p className="text-muted-foreground">Nothing yet.</p>}
          {done.map((r) => (
            <div key={r.id} className="border-b pb-2 last:border-0">
              <div className="flex items-center gap-2">
                {r.status === "ACCEPTED" ? <Check className="h-4 w-4 text-status-green" /> : <X className="h-4 w-4 text-muted-foreground" />}
                <span className={cn(r.status !== "ACCEPTED" && "text-muted-foreground")}>{r.title}</span>
              </div>
              {(result[r.id] || (r.impact as { result?: string }).result) && (
                <div className="pl-6 text-xs text-status-green">{result[r.id] ?? (r.impact as { result?: string }).result}</div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export function RecCard({ r, busy, onAccept, onDismiss }: { r: Recommendation; busy: boolean; onAccept: () => void; onDismiss: () => void }) {
  const impact = r.impact as { before?: number; after?: number; metric?: string; note?: string; affected?: number; category?: Category };
  const raw = (r.action as { why_raw?: string }).why_raw;
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Badge variant="secondary" className="mb-1">
              {r.type.replaceAll("_", " ").toLowerCase()}
            </Badge>
            <div className="text-lg font-semibold">{r.title}</div>
          </div>
          {impact.before != null && impact.after != null && (
            <div className="flex items-center gap-2 rounded-lg bg-status-green/10 px-3 py-2 text-status-green">
              <TrendingDown className="h-5 w-5" />
              <span className="text-xl font-bold">
                {impact.before} → {impact.after} min
              </span>
            </div>
          )}
        </div>
        <p className="mt-2 text-sm">{r.explanation}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {impact.metric && `Impact: ${impact.category ? CAT_NAME[impact.category] + " " : ""}${impact.metric}`}
          {impact.affected ? ` · ${impact.affected} customers` : ""}
          {impact.note ? ` · ${impact.note}` : ""}
        </p>
        <details className="mt-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Why?</summary>
          {raw ?? r.explanation} Impact is computed by re-running the queue projection with this action applied — the AI only rephrases the text.
        </details>
        <div className="mt-4 flex gap-2">
          <Button onClick={onAccept} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Check />} Accept
          </Button>
          <Button variant="outline" onClick={onDismiss} disabled={busy}>
            Dismiss
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- Insights

interface InsightsData {
  csatTrend: { date: string; csat: number; n: number }[];
  waitTrend: { date: string; avgWait: number; sla: number; visits: number }[];
  topics: { topic: string; pos: number; neu: number; neg: number }[];
  deflection: { name: string; visits: number; couldBeDigital: number; pct: number }[];
  misrouting: { from: string; n: number; mostlyTo: string }[];
  staff: { name: string; served: number; avgHandle: number }[];
  branchAvgHandle: number;
  comments: { rating: number; comment: string; sentiment: string; topics: string[]; at: string }[];
  digitalDeflectionsTracked: number;
}

function InsightsTab({ branchId }: { branchId: string }) {
  const [d, setD] = useState<InsightsData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<InsightsData>(`/api/insights/${branchId}`).then(setD).catch((e) => setErr((e as Error).message));
  }, [branchId]);
  if (!d) return <div className="flex justify-center py-20">{err ? <p className="text-destructive">{err}</p> : <Loader2 className="h-6 w-6 animate-spin" />}</div>;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-base">CSAT trend (avg rating, 1–5)</CardTitle>
        </CardHeader>
        <CardContent className="h-60 pt-4">
          <ResponsiveContainer>
            <LineChart data={d.csatTrend.map((x) => ({ ...x, day: fmtDate(x.date) }))} margin={{ left: -20, right: 8 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="day" tick={AXIS} axisLine={false} tickLine={false} minTickGap={24} />
              <YAxis domain={[1, 5]} tick={AXIS} axisLine={false} tickLine={false} />
              <Tooltip />
              <Line dataKey="csat" name="CSAT" stroke={SERIES[0]} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-base">Average wait per day (min)</CardTitle>
        </CardHeader>
        <CardContent className="h-60 pt-4">
          <ResponsiveContainer>
            <LineChart data={d.waitTrend.map((x) => ({ ...x, day: fmtDate(x.date) }))} margin={{ left: -20, right: 8 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="day" tick={AXIS} axisLine={false} tickLine={false} minTickGap={24} />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} />
              <Tooltip />
              <Line dataKey="avgWait" name="Avg wait (min)" stroke={SERIES[1]} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-base">Feedback topics by sentiment</CardTitle>
          <CardDescription>AI-tagged (keyword fallback)</CardDescription>
        </CardHeader>
        <CardContent className="h-64 pt-4">
          <ResponsiveContainer>
            <BarChart data={d.topics.map((x) => ({ ...x, topic: x.topic.replace("_", " ") }))} layout="vertical" margin={{ left: 40, right: 8 }}>
              <CartesianGrid stroke={GRID} horizontal={false} />
              <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="topic" tick={AXIS} axisLine={false} tickLine={false} width={110} />
              <Tooltip />
              <Legend />
              <Bar dataKey="pos" name="Positive" stackId="s" fill={SERIES[0]} stroke="#fff" strokeWidth={2} />
              <Bar dataKey="neu" name="Neutral" stackId="s" fill={SERIES[2]} stroke="#fff" strokeWidth={2} />
              <Bar dataKey="neg" name="Negative" stackId="s" fill={SERIES[1]} stroke="#fff" strokeWidth={2} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-status-green" /> Deflection opportunity
          </CardTitle>
          <CardDescription>Visits that staff marked as doable online · {d.digitalDeflectionsTracked} &quot;do it online&quot; clicks tracked</CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <tbody>
              {d.deflection.map((x) => (
                <tr key={x.name} className="border-t first:border-0">
                  <td className="py-1.5">{x.name}</td>
                  <td className="text-right text-muted-foreground">{x.couldBeDigital} of {x.visits}</td>
                  <td className="w-32 pl-3">
                    <div className="h-2 rounded-full bg-muted">
                      <div className="h-2 rounded-full" style={{ width: `${x.pct}%`, background: SERIES[0] }} />
                    </div>
                  </td>
                  <td className="w-12 text-right font-medium">{x.pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Most-transferred services (misrouting signal)</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <tbody>
              {d.misrouting.map((x) => (
                <tr key={x.from} className="border-t first:border-0">
                  <td className="py-1.5">{x.from}</td>
                  <td className="text-muted-foreground">→ mostly {x.mostlyTo}</td>
                  <td className="text-right font-medium">{x.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">Fix: add a follow-up question in the AI intake or give the first counter both skills.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Staff handle time vs branch avg ({d.branchAvgHandle} min)</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th>Staff</th>
                <th className="text-right">Served (90d)</th>
                <th className="text-right">Avg handle</th>
              </tr>
            </thead>
            <tbody>
              {d.staff.map((s) => (
                <tr key={s.name} className="border-t">
                  <td className="py-1.5">{s.name}</td>
                  <td className="text-right">{s.served}</td>
                  <td className="text-right font-medium">{s.avgHandle.toFixed(1)} min</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">Mix of services differs by staff — compare within the same skill.</p>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Latest comments</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-2">
          {d.comments.map((c, i) => (
            <div key={i} className="rounded-md border bg-white p-3 text-sm">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{"★".repeat(c.rating)}{"☆".repeat(5 - c.rating)}</span>
                <span>{c.topics.join(", ").replaceAll("_", " ")}</span>
              </div>
              <p className="mt-1">{c.comment}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
