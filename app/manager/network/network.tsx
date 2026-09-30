"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/client/live";
import { fmtTime } from "@/lib/clock";
import type { Recommendation } from "@/lib/types";
import { cn } from "@/lib/utils";

import { RecCard } from "../[branchId]/command-center";

interface BranchRow {
  id: string;
  name: string;
  area_type: string;
  lat: number;
  lng: number;
  waitMin: number;
  live: boolean;
  waiting: number;
  peakHour: number | null;
  peakExpected: number;
  staffGap: number;
  rostered: number;
  csat: number | null;
}

export function NetworkView() {
  const [data, setData] = useState<{ branches: BranchRow[]; lending: Recommendation[]; now: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => api<{ branches: BranchRow[]; lending: Recommendation[]; now: string }>("/api/network").then(setData).catch((e) => setErr((e as Error).message)), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  async function decide(id: string, decision: "ACCEPT" | "DISMISS") {
    setBusy(id);
    await api(`/api/recommendations/${id}`, { decision }).catch((e) => setErr((e as Error).message));
    setBusy(null);
    load();
  }

  const b = data?.branches ?? [];
  const lat = b.map((x) => x.lat);
  const lng = b.map((x) => x.lng);
  const pad = 0.02;
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lat) - pad, Math.max(...lat) + pad, Math.min(...lng) - pad, Math.max(...lng) + pad];
  const X = (v: number) => ((v - minLng) / (maxLng - minLng)) * 460 + 20;
  const Y = (v: number) => (1 - (v - minLat) / (maxLat - minLat)) * 300 + 20;

  return (
    <main className="min-h-screen bg-muted/40 pb-16">
      <header className="bg-brand-800 text-white">
        <div className="container flex items-center gap-3 py-3">
          <Link href="/" className="text-brand-200 hover:text-white">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="text-lg font-semibold">Network view · all branches</div>
            <div className="text-xs text-brand-200">{data ? fmtTime(data.now) : ""}</div>
          </div>
        </div>
      </header>
      <div className="container mt-5 space-y-5">
        {!data ? (
          <div className="flex justify-center py-20">{err ? <p className="text-destructive">{err}</p> : <Loader2 className="h-6 w-6 animate-spin" />}</div>
        ) : (
          <>
            <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Branches</CardTitle>
                  <CardDescription>Live wait where the branch is running in the simulator; otherwise estimated from forecast + roster (Erlang C)</CardDescription>
                </CardHeader>
                <CardContent>
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="py-1">Branch</th>
                        <th className="text-right">Wait now</th>
                        <th className="text-right">Forecast peak</th>
                        <th className="text-right">Staff gap at peak</th>
                        <th className="text-right">CSAT (14d)</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {b.map((x) => (
                        <tr key={x.id} className="border-t">
                          <td className="py-2">
                            <div className="font-medium">{x.name.replace("Sample Demo Bank — ", "")}</div>
                            <div className="text-xs text-muted-foreground">{x.area_type.replace("_", " ").toLowerCase()}</div>
                          </td>
                          <td className={cn("text-right font-semibold", x.waitMin > 25 ? "text-status-red" : x.waitMin > 12 ? "text-status-amber" : "text-status-green")}>
                            {x.waitMin} min
                            <div className="text-[10px] font-normal text-muted-foreground">{x.live ? `${x.waiting} waiting · live` : "estimated"}</div>
                          </td>
                          <td className="text-right">
                            {x.peakHour}:00 <span className="text-xs text-muted-foreground">(~{x.peakExpected}/h)</span>
                          </td>
                          <td className={cn("text-right", x.staffGap > 0 ? "text-status-red" : "text-status-green")}>
                            {x.staffGap > 0 ? `+${x.staffGap} needed` : x.staffGap < 0 ? `${-x.staffGap} spare` : "balanced"}
                          </td>
                          <td className="text-right">{x.csat?.toFixed(2) ?? "—"}</td>
                          <td className="pl-3 text-right">
                            <Link className="text-xs text-primary underline" href={`/manager/${x.id}`}>
                              open
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Map</CardTitle>
                </CardHeader>
                <CardContent>
                  <svg viewBox="0 0 500 340" className="w-full rounded-lg bg-brand-50">
                    {b.map((x) => (
                      <g key={x.id}>
                        <circle cx={X(x.lng)} cy={Y(x.lat)} r={10 + Math.min(20, x.waitMin / 2)} fill={x.waitMin > 25 ? "hsl(0 72% 45%)" : x.waitMin > 12 ? "hsl(36 92% 44%)" : "hsl(145 63% 32%)"} fillOpacity={0.25} stroke="white" strokeWidth={2} />
                        <circle cx={X(x.lng)} cy={Y(x.lat)} r={5} fill="#112d57" />
                        <text x={X(x.lng) + 12} y={Y(x.lat) + 4} fontSize={12} fill="#0b1f3d">
                          {x.name.replace("Sample Demo Bank — ", "")} · {x.waitMin}m
                        </text>
                      </g>
                    ))}
                  </svg>
                  <p className="mt-2 text-xs text-muted-foreground">Circle size = current wait. Positions are real Bengaluru-area coordinates (demo branches).</p>
                </CardContent>
              </Card>
            </div>

            <div>
              <h2 className="mb-3 text-lg font-semibold">Staff lending suggestions</h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {data.lending.filter((r) => r.status === "OPEN").length === 0 && <p className="text-sm text-muted-foreground">No lending needed — every branch can cover its forecast peak.</p>}
                {data.lending
                  .filter((r) => r.status === "OPEN")
                  .map((r) => (
                    <RecCard key={r.id} r={r} busy={busy === r.id} onAccept={() => decide(r.id, "ACCEPT")} onDismiss={() => decide(r.id, "DISMISS")} />
                  ))}
                {data.lending
                  .filter((r) => r.status === "ACCEPTED")
                  .map((r) => (
                    <p key={r.id} className="text-sm text-status-green">
                      ✓ {r.title} — {(r.impact as { result?: string }).result}
                    </p>
                  ))}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
