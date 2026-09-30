"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bot, Coffee, ExternalLink, Gauge, Loader2, Pause, Play, RotateCcw, ServerCrash, Users, Wallet } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, useBranchState, useSimNow } from "@/lib/client/live";
import { fmtTime } from "@/lib/clock";
import { BRANCHES } from "@/lib/data/branches";
import { SERVICE_BY_ID } from "@/lib/data/catalog";
import type { Counter } from "@/lib/types";
import { cn } from "@/lib/utils";

const SERIES = ["#2a78d6", "#eb6834"];
const SPEEDS = [1, 10, 30, 60];

interface Kpis {
  label: string;
  arrivals: number;
  served: number;
  avgWait: number;
  p90Wait: number;
  slaPct: number;
  leftPct: number;
  deflected: number;
  byHour: { hour: number; avgWait: number }[];
}
interface Comparison {
  before: Kpis;
  after: Kpis;
  assumptions: string[];
  salaryDay: boolean;
}

export function Simulator() {
  const [branchId, setBranchId] = useState("BR01");
  const { data, refresh } = useBranchState(branchId, 2500);
  const now = useSimNow(data?.sim);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [cmp, setCmp] = useState<Comparison | null>(null);
  const [salary, setSalary] = useState(false);
  const ticking = useRef(false);

  const sim = data?.sim;
  const simBranch = sim?.branch_id ?? "BR01";

  useEffect(() => {
    if (sim?.branch_id && sim.branch_id !== branchId) setBranchId(sim.branch_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim?.branch_id]);

  // drive the simulation while this page is open
  useEffect(() => {
    if (!sim?.running) return;
    const t = setInterval(async () => {
      if (ticking.current) return;
      ticking.current = true;
      try {
        await api("/api/sim/tick", {});
      } catch (e) {
        setLog((l) => [`⚠ ${(e as Error).message}`, ...l].slice(0, 12));
      } finally {
        ticking.current = false;
      }
    }, 1000);
    return () => clearInterval(t);
  }, [sim?.running]);

  async function post(key: string, body: Record<string, unknown>, note?: string) {
    setBusy(key);
    try {
      const r = await api<{ message?: string }>("/api/sim", body);
      const line = r.message ?? note;
      if (line) setLog((l) => [`${fmtTime(now)} · ${line}`, ...l].slice(0, 12));
      await refresh();
    } catch (e) {
      setLog((l) => [`⚠ ${(e as Error).message}`, ...l].slice(0, 12));
    } finally {
      setBusy(null);
    }
  }

  async function compare() {
    setBusy("compare");
    try {
      setCmp(await api<Comparison>(`/api/sim/compare?branch=${simBranch}${salary ? "&salary=1" : ""}`));
    } finally {
      setBusy(null);
    }
  }

  const waiting = data?.tokens.filter((t) => t.status === "WAITING").length ?? 0;

  return (
    <main className="min-h-screen bg-muted/40 pb-16">
      <header className="bg-brand-800 text-white">
        <div className="container flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-brand-200 hover:text-white">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <Gauge className="h-5 w-5" />
            <div className="text-lg font-semibold">Live simulator</div>
          </div>
          <div className="font-mono text-3xl font-bold tabular-nums">{fmtTime(now)}</div>
        </div>
      </header>

      <div className="container mt-5 grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <select
                className="h-10 rounded-md border px-2 text-sm"
                value={branchId}
                onChange={(e) => {
                  setBranchId(e.target.value);
                  post("reset", { action: "reset", branchId: e.target.value }, `Switched to ${e.target.value} and reset the day`);
                }}
              >
                {BRANCHES.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.id} · {b.name.replace("Sample Demo Bank — ", "")}
                  </option>
                ))}
              </select>
              <div className="inline-flex rounded-lg border bg-white p-0.5">
                <button onClick={() => post("speed", { action: "speed", speed: 0 })} className={cn("rounded-md px-3 py-1.5", !sim?.running && "bg-primary text-white")} aria-label="Pause">
                  <Pause className="h-4 w-4" />
                </button>
                {SPEEDS.map((s) => (
                  <button key={s} onClick={() => post("speed", { action: "speed", speed: s })} className={cn("rounded-md px-3 py-1.5 text-sm", sim?.running && sim.speed === s && "bg-primary text-white")}>
                    {s === 1 ? <Play className="inline h-4 w-4" /> : null} {s}×
                  </button>
                ))}
              </div>
              <Button variant="outline" onClick={() => post("reset", { action: "reset", branchId }, "Day reset: 10:00, fresh queue, today's appointments booked")} disabled={busy === "reset"}>
                {busy === "reset" ? <Loader2 className="animate-spin" /> : <RotateCcw />} Reset day
              </Button>
              <span className="text-sm text-muted-foreground">
                {sim?.running ? `Running at ${sim.speed}× · keep this tab open` : "Paused"}
              </span>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Scenarios</CardTitle>
              <CardDescription>Each one hits the same live engine that every screen is watching</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Scenario icon={Wallet} label="Salary-day rush" busy={busy === "salary_rush"} onClick={() => post("salary_rush", { action: "scenario", name: "salary_rush" })} />
              <Scenario icon={Coffee} label="Staff unplanned break" busy={busy === "unplanned_break"} onClick={() => post("unplanned_break", { action: "scenario", name: "unplanned_break" })} />
              <Scenario icon={ServerCrash} label="Counter system outage" busy={busy === "outage"} onClick={() => post("outage", { action: "scenario", name: "outage" })} />
              <Scenario icon={Users} label="Senior citizen group" busy={busy === "senior_group"} onClick={() => post("senior_group", { action: "scenario", name: "senior_group" })} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Counters · {simBranch}</CardTitle>
              <CardDescription>Bots serve with realistic handle times. Hand any counter to a teammate for live control.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              {data?.counters.map((c) => {
                const cc = c as Counter & { human_control?: boolean };
                const staff = data.staff.find((s) => s.id === c.staff_id);
                const cur = data.tokens.find((t) => t.counter_id === c.id && (t.status === "CALLED" || t.status === "SERVING"));
                return (
                  <div key={c.id} className="flex items-center justify-between rounded-md border bg-white p-2 text-sm">
                    <div>
                      <b>C{c.number}</b> {staff?.name ?? "—"}
                      <div className="text-xs text-muted-foreground">
                        {c.status.replace("_", " ").toLowerCase()}
                        {cur ? ` · ${cur.code} ${SERVICE_BY_ID[cur.service_id].name}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {c.staff_id && (
                        <button
                          onClick={() => post(`h-${c.id}`, { action: "human", counterId: c.id, on: !cc.human_control })}
                          className={cn("rounded-full px-2 py-0.5 text-xs", cc.human_control ? "bg-brand-600 text-white" : "bg-muted")}
                        >
                          {cc.human_control ? "human" : <><Bot className="inline h-3 w-3" /> bot</>}
                        </button>
                      )}
                      <Link href={`/staff/${c.id}`} target="_blank" className="text-muted-foreground hover:text-foreground" aria-label="Open console">
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Before vs after BranchFlow</CardTitle>
              <CardDescription>Replays the same synthetic day twice: identical arrivals and staff</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={compare} disabled={busy === "compare"}>
                  {busy === "compare" ? <Loader2 className="animate-spin" /> : null} Run comparison
                </Button>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={salary} onChange={(e) => setSalary(e.target.checked)} /> Salary-day volume (×1.4)
                </label>
              </div>
              {cmp && (
                <div className="mt-4 space-y-4">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="py-1">KPI</th>
                        <th className="text-right">Before (FIFO)</th>
                        <th className="text-right">With BranchFlow</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        [
                          ["Average wait", "avgWait", "min", true],
                          ["P90 wait", "p90Wait", "min", true],
                          ["Served within target (SLA)", "slaPct", "%", false],
                          ["Left without service", "leftPct", "%", true],
                          ["Finished online instead (digital nudge)", "deflected", "", false],
                          ["Served at the branch", "served", "", null],
                        ] as const
                      ).map(([label, k, unit, lowerIsBetter]) => {
                        const b = cmp.before[k];
                        const a = cmp.after[k];
                        const better = lowerIsBetter === null ? null : lowerIsBetter ? a < b : a > b;
                        return (
                          <tr key={k} className="border-t">
                            <td className="py-1.5">{label}</td>
                            <td className="text-right">{b}{unit}</td>
                            <td className={cn("text-right font-semibold", better === true && "text-status-green", better === false && "text-status-red")}>
                              {a}{unit}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="h-60">
                    <ResponsiveContainer>
                      <LineChart
                        data={cmp.before.byHour.map((h) => ({ hour: `${h.hour}:00`, before: h.avgWait, after: cmp.after.byHour.find((x) => x.hour === h.hour)?.avgWait ?? null }))}
                        margin={{ left: -10, right: 8 }}
                      >
                        <CartesianGrid stroke="#e7e6e1" vertical={false} />
                        <XAxis dataKey="hour" tick={{ fontSize: 12, fill: "#52514e" }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 12, fill: "#52514e" }} axisLine={false} tickLine={false} unit="m" />
                        <Tooltip />
                        <Legend />
                        <Line dataKey="before" name="Before (FIFO)" stroke={SERIES[1]} strokeWidth={2} dot={{ r: 4 }} />
                        <Line dataKey="after" name="With BranchFlow" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                    {cmp.assumptions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Right now</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Waiting</span>
                <b>{waiting}</b>
              </div>
              {(["QUICK", "STANDARD", "COMPLEX"] as const).map((c) => (
                <div key={c} className="flex justify-between">
                  <span>{c.toLowerCase()} projected wait</span>
                  <b>{Math.round(data?.waitByCategory[c] ?? 0)} min</b>
                </div>
              ))}
              <div className="flex justify-between">
                <span>Open alerts</span>
                <Badge variant={data?.alerts.length ? "red" : "green"}>{data?.alerts.length ?? 0}</Badge>
              </div>
              <div className="flex justify-between">
                <span>Recommendations</span>
                <Badge variant="secondary">{data?.recommendations.filter((r) => r.status === "OPEN").length ?? 0}</Badge>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Open the demo screens</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {[
                [`/display/${simBranch}`, "Display board (TV)"],
                [`/kiosk/${simBranch}`, "Kiosk"],
                [`/manager/${simBranch}`, "Manager command center"],
                ["/customer", "Customer app"],
                ["/manager/network", "Network view"],
              ].map(([href, label]) => (
                <Link key={href} href={href} target="_blank" className="flex items-center justify-between rounded-md border bg-white px-3 py-2 hover:bg-accent">
                  {label} <ExternalLink className="h-4 w-4 text-muted-foreground" />
                </Link>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Event log</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs text-muted-foreground">
              {log.length === 0 && <p>Reset the day, press play, then trigger a scenario.</p>}
              {log.map((l, i) => (
                <p key={i}>{l}</p>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}

function Scenario({ icon: Icon, label, busy, onClick }: { icon: typeof Wallet; label: string; busy: boolean; onClick: () => void }) {
  return (
    <Button variant="outline" className="h-auto flex-col gap-1 py-4" onClick={onClick} disabled={busy}>
      {busy ? <Loader2 className="animate-spin" /> : <Icon className="!h-6 !w-6" />}
      <span className="text-sm">{label}</span>
    </Button>
  );
}
