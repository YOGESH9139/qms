"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertOctagon,
  ArrowLeft,
  ArrowRightLeft,
  Bell,
  Bot,
  CalendarPlus,
  Check,
  Clock,
  Coffee,
  FileText,
  Loader2,
  Megaphone,
  PauseCircle,
  PhoneCall,
  Play,
  Plus,
  Power,
  Star,
  StickyNote,
  UserX,
} from "lucide-react";

import { PhonePanel } from "@/components/phone-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { api, minutesSince, useBranchState, useSimNow } from "@/lib/client/live";
import { fmtTime } from "@/lib/clock";
import { SERVICES, SERVICE_BY_ID } from "@/lib/data/catalog";
import { scoreFor, type QueueContext } from "@/lib/engine/queue";
import type { Counter, Skill, Token, TokenOutcome } from "@/lib/types";
import { cn } from "@/lib/utils";

type Dialog = null | "complete" | "transfer" | "park" | "add" | "followup" | "escalate" | "note" | "break";

const STATUS_STYLE: Record<string, string> = {
  AVAILABLE: "bg-status-green text-white",
  SERVING: "bg-brand-600 text-white",
  ON_BREAK: "bg-status-amber text-white",
  OFFLINE: "bg-slate-400 text-white",
};

interface TokenEventRow {
  type: string;
  note: string | null;
  at: string;
  meta: Record<string, unknown> | null;
}

export function StaffConsole({ counterId, branchId }: { counterId: string; branchId: string }) {
  const { data, error, refresh } = useBranchState(branchId, 3000);
  const now = useSimNow(data?.sim);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [why, setWhy] = useState<string[] | null>(null);
  const [events, setEvents] = useState<TokenEventRow[]>([]);

  const counter = data?.counters.find((c) => c.id === counterId) as (Counter & { human_control?: boolean }) | undefined;
  const staff = data?.staff.find((s) => s.id === counter?.staff_id);
  const skills = (staff?.skills ?? []) as Skill[];
  const current = data?.tokens.find((t) => t.counter_id === counterId && (t.status === "CALLED" || t.status === "SERVING"));
  const ctx: QueueContext | null = data ? { now, services: SERVICE_BY_ID, avgHandle: data.avgHandle } : null;

  // "Why this customer" also survives a page refresh: recompute the score at call time (pure engine).
  useEffect(() => {
    if (!current || !counter || !ctx || !current.called_at) {
      setWhy(null);
      return;
    }
    setWhy((w) => w ?? scoreFor(current, counter, ctx, new Date(current.called_at!)).reasons);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  useEffect(() => {
    if (!current) return setEvents([]);
    api<{ events: TokenEventRow[] }>(`/api/token/${current.id}`)
      .then((r) => setEvents(r.events))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, current?.status]);

  const myQueue = useMemo(() => {
    if (!data || !counter || !ctx) return [];
    return data.tokens
      .filter((t) => t.status === "WAITING" && skills.includes(SERVICE_BY_ID[t.service_id].skill))
      .map((t) => ({ t, s: scoreFor(t, counter, ctx) }))
      .sort((a, b) => b.s.score - a.s.score)
      .slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, counter, skills.join(","), Math.floor(now.getTime() / 30000)]);

  const today = useMemo(() => {
    const done = (data?.tokens ?? []).filter((t) => t.status === "COMPLETED" && t.counter_id === counterId && t.serving_started_at && t.completed_at);
    const mins = done.map((t) => (new Date(t.completed_at!).getTime() - new Date(t.serving_started_at!).getTime()) / 60000);
    const all = (data?.tokens ?? []).filter((t) => t.status === "COMPLETED" && t.serving_started_at && t.completed_at);
    const allMins = all.map((t) => (new Date(t.completed_at!).getTime() - new Date(t.serving_started_at!).getTime()) / 60000);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    return { served: done.length, mine: avg(mins), branch: avg(allMins) };
  }, [data, counterId]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    setMsg(null);
    try {
      const r = await api<{ empty?: boolean; reasons?: string[]; token?: Token; status?: string }>(`/api/counter/${counterId}`, { action, ...extra });
      if (action === "call") {
        if (r.empty) setMsg("No eligible customers right now.");
        else setWhy(r.reasons ?? null);
      }
      if (action === "skip" && r.status === "NO_SHOW") setMsg("Marked as no-show (2nd miss).");
      setDialog(null);
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!data || !counter) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        {error ? `Error: ${error}` : <Loader2 className="h-6 w-6 animate-spin" />}
      </div>
    );
  }

  const svc = current ? SERVICE_BY_ID[current.service_id] : null;
  const avgHandle = current ? (data.avgHandle[current.service_id] ?? svc!.avg_handle_min) : 0;
  const elapsed = current?.serving_started_at ? minutesSince(current.serving_started_at, now) : 0;
  const timerTone = elapsed > 1.5 * avgHandle ? "text-status-amber" : "text-foreground";
  const waitingByCat = (["QUICK", "STANDARD", "COMPLEX"] as const).map((c) => ({
    c,
    n: data.tokens.filter((t) => t.status === "WAITING" && SERVICE_BY_ID[t.service_id].category === c).length,
    w: data.waitByCategory[c] ?? 0,
  }));
  const botControlled = data.sim.running && !counter.human_control;

  return (
    <main className="min-h-screen bg-muted/40 pb-20">
      <header className="bg-brand-800 text-white">
        <div className="container flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-brand-200 hover:text-white">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <div className="text-lg font-semibold">
                Counter {counter.number} · {staff?.name ?? "Unassigned"}
              </div>
              <div className="text-xs text-brand-200">
                Skills: {skills.join(", ").toLowerCase()} · Focus: {counter.mode_skill?.toLowerCase() ?? "—"} · {fmtTime(now)}
              </div>
            </div>
            <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", STATUS_STYLE[counter.status])}>{counter.status.replace("_", " ")}</span>
          </div>
          <div className="flex items-center gap-6 text-sm">
            <div>
              <div className="text-brand-200">Served today</div>
              <div className="text-xl font-bold">{today.served}</div>
            </div>
            <div>
              <div className="text-brand-200">My avg handle</div>
              <div className="text-xl font-bold">
                {today.mine ? `${today.mine.toFixed(1)}m` : "—"}
                <span className="ml-1 text-xs font-normal text-brand-200">branch {today.branch ? `${today.branch.toFixed(1)}m` : "—"}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {botControlled && (
        <div className="flex items-center justify-between gap-3 bg-status-amber/15 px-6 py-2 text-sm">
          <span className="flex items-center gap-2">
            <Bot className="h-4 w-4" /> The simulator&apos;s bot is operating this counter.
          </span>
          <Button size="sm" onClick={() => act("human", { on: true })}>
            Take control
          </Button>
        </div>
      )}

      <div className="container mt-5 grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {/* counter status */}
          <Card>
            <CardContent className="flex flex-wrap items-center gap-2 p-4">
              {counter.status === "OFFLINE" ? (
                <Button onClick={() => act("online")} disabled={!!busy}>
                  <Power /> Go online
                </Button>
              ) : (
                <Button variant="outline" onClick={() => act("offline")} disabled={!!busy || !!current}>
                  <Power /> Go offline
                </Button>
              )}
              {counter.status === "ON_BREAK" ? (
                <Button onClick={() => act("back")} disabled={!!busy}>
                  <Play /> Back from break
                  {counter.break_expected_end && <span className="text-xs opacity-80">(due {fmtTime(counter.break_expected_end)})</span>}
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setDialog("break")} disabled={!!busy || !!current || counter.status === "OFFLINE"}>
                  <Coffee /> Take break
                </Button>
              )}
              <div className="ml-auto flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Focus</span>
                {skills.map((s) => (
                  <button
                    key={s}
                    onClick={() => act("mode", { skill: s })}
                    className={cn("rounded-full border px-3 py-1 text-xs", counter.mode_skill === s ? "border-primary bg-primary text-white" : "hover:bg-accent")}
                  >
                    {s.toLowerCase()}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* current customer */}
          <Card className={cn(current?.status === "CALLED" && "ring-2 ring-status-green")}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span>Current customer</span>
                {current && (
                  <span className={cn("flex items-center gap-1 font-mono text-2xl", timerTone)}>
                    <Clock className="h-5 w-5" />
                    {current.status === "SERVING" ? `${Math.floor(elapsed)}:${String(Math.floor((elapsed % 1) * 60)).padStart(2, "0")}` : "called"}
                    <span className="text-xs text-muted-foreground">/ avg {avgHandle.toFixed(0)}m</span>
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!current ? (
                <div className="flex flex-col items-center gap-3 py-8">
                  <Button
                    size="lg"
                    className="h-16 px-10 text-xl"
                    onClick={() => act("call")}
                    disabled={!!busy || counter.status === "OFFLINE" || counter.status === "ON_BREAK"}
                  >
                    {busy === "call" ? <Loader2 className="animate-spin" /> : <PhoneCall />} Call next
                  </Button>
                  <p className="text-sm text-muted-foreground">{myQueue.length} eligible customers waiting</p>
                </div>
              ) : (
                <div className="grid gap-5 md:grid-cols-[1fr_1fr]">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="text-5xl font-black text-brand-900">{current.code}</span>
                      {current.priority_flag !== "NONE" && (
                        <Badge variant="amber" className="gap-1">
                          <Star className="h-3 w-3" /> {current.priority_flag.toLowerCase()}
                        </Badge>
                      )}
                      <Badge variant="secondary">{current.status}</Badge>
                    </div>
                    <div className="mt-1 text-lg font-medium">{svc!.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {current.customer_name ?? "Walk-in customer"} · {current.mobile_masked ?? "no mobile"} · via {current.source.toLowerCase().replace("_", " ")}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      Arrived {fmtTime(current.original_arrival_at)} · waited {Math.round(minutesSince(current.original_arrival_at, new Date(current.called_at ?? now)))} min
                      {current.appointment_start && ` · appointment ${fmtTime(current.appointment_start)}`}
                    </div>

                    {why && (
                      <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm">
                        <div className="mb-1 font-semibold text-brand-800">Why this customer</div>
                        <ul className="list-disc pl-5 text-brand-900">
                          {why.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="mt-3 rounded-lg border bg-white p-3 text-sm">
                      <div className="mb-1 flex items-center gap-1 font-semibold">
                        <FileText className="h-4 w-4" /> AI summary
                      </div>
                      <p>{current.ai_summary?.summary ?? "No app intake — walk-in via kiosk."}</p>
                      {current.ai_summary?.extra_notes && <p className="mt-1 text-muted-foreground">{current.ai_summary.extra_notes}</p>}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-semibold">Documents</div>
                    <ul className="mt-1 space-y-1 text-sm">
                      {svc!.documents.map((d) => {
                        const ticked = current.ai_summary?.documents_checked?.includes(d.id);
                        return (
                          <li key={d.id} className="flex gap-2">
                            <span className={cn("mt-0.5 h-4 w-4 shrink-0 rounded border", ticked ? "border-status-green bg-status-green" : "")}>
                              {ticked && <Check className="h-3.5 w-3.5 text-white" />}
                            </span>
                            <span className={cn(!d.required && "text-muted-foreground")}>{d.label}</span>
                          </li>
                        );
                      })}
                    </ul>
                    {current.ai_summary?.documents_checked && <p className="mt-1 text-xs text-muted-foreground">Ticked = customer confirmed in the app</p>}
                    {events.filter((e) => ["TRANSFER", "NOTE", "PARK", "SKIP", "LATE_CONVERTED", "RUNNING_LATE", "ESCALATE"].includes(e.type)).length > 0 && (
                      <div className="mt-3">
                        <div className="text-sm font-semibold">History</div>
                        <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                          {events
                            .filter((e) => ["TRANSFER", "NOTE", "PARK", "SKIP", "LATE_CONVERTED", "RUNNING_LATE", "ESCALATE"].includes(e.type))
                            .map((e, i) => (
                              <li key={i}>
                                {fmtTime(e.at)} · {e.type.toLowerCase().replace("_", " ")}
                                {e.note ? ` — ${e.note}` : ""}
                              </li>
                            ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {current && (
            <Card>
              <CardContent className="flex flex-wrap gap-2 p-4">
                {current.status === "CALLED" && (
                  <>
                    <Button onClick={() => act("start")} disabled={!!busy}>
                      <Play /> Customer arrived / Start
                    </Button>
                    <Button variant="outline" onClick={() => act("recall")} disabled={!!busy || current.recall_count >= 1}>
                      <Megaphone /> Recall{current.recall_count >= 1 ? " (used)" : ""}
                    </Button>
                    <Button variant="outline" onClick={() => act("skip")} disabled={!!busy}>
                      <UserX /> Not here / Skip
                    </Button>
                  </>
                )}
                {current.status === "SERVING" && (
                  <Button onClick={() => setDialog("complete")} disabled={!!busy}>
                    <Check /> Complete
                  </Button>
                )}
                <Button variant="outline" onClick={() => setDialog("transfer")} disabled={!!busy}>
                  <ArrowRightLeft /> Transfer
                </Button>
                <Button variant="outline" onClick={() => setDialog("park")} disabled={!!busy}>
                  <PauseCircle /> Park
                </Button>
                <Button variant="outline" onClick={() => setDialog("add")} disabled={!!busy}>
                  <Plus /> Add service
                </Button>
                <Button variant="outline" onClick={() => setDialog("followup")} disabled={!!busy}>
                  <CalendarPlus /> Book follow-up
                </Button>
                <Button variant="outline" onClick={() => setDialog("note")} disabled={!!busy}>
                  <StickyNote /> Note
                </Button>
                <Button variant="destructive" onClick={() => setDialog("escalate")} disabled={!!busy}>
                  <AlertOctagon /> Escalate
                </Button>
              </CardContent>
            </Card>
          )}
          {msg && <p className="rounded-md bg-status-amber/15 px-4 py-2 text-sm">{msg}</p>}
        </div>

        {/* side panel */}
        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">My queue (next 5)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {myQueue.length === 0 && <p className="text-sm text-muted-foreground">Nobody eligible is waiting.</p>}
              {myQueue.map(({ t, s }, i) => (
                <div key={t.id} className="flex items-start justify-between rounded-md border bg-white p-2 text-sm">
                  <div>
                    <div className="font-semibold">
                      {i + 1}. {t.code} {t.priority_flag !== "NONE" && <Star className="inline h-3 w-3 fill-status-amber text-status-amber" />}
                    </div>
                    <div className="text-xs text-muted-foreground">{SERVICE_BY_ID[t.service_id].name}</div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">{s.reasons.slice(0, 2).join(" · ")}</div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Branch queue</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {waitingByCat.map(({ c, n, w }) => (
                <div key={c} className="flex justify-between">
                  <span>{c.toLowerCase()}</span>
                  <span>
                    {n} waiting · <b className={cn(w > 20 ? "text-status-red" : w > 10 ? "text-status-amber" : "text-status-green")}>{Math.round(w)} min</b>
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-start gap-2 p-4 text-xs text-muted-foreground">
              <Bell className="h-4 w-4 shrink-0" /> Pull-based routing: you always get the fairest eligible customer. Counter numbers are only shown to customers when called.
            </CardContent>
          </Card>
        </div>
      </div>

      {dialog === "complete" && <CompleteDialog onClose={() => setDialog(null)} onSubmit={(o, d) => act("complete", { outcome: o, couldBeDigital: d })} digital={svc?.digital_possible ?? false} />}
      {dialog === "transfer" && (
        <ServiceDialog title="Transfer to another service" cta="Transfer" withNote exclude={current?.service_id} onClose={() => setDialog(null)} onSubmit={(serviceId, note) => act("transfer", { serviceId, note })} />
      )}
      {dialog === "add" && <ServiceDialog title="Add another service for this customer" cta="Create linked token" onClose={() => setDialog(null)} onSubmit={(serviceId) => act("addService", { serviceId })} />}
      {dialog === "park" && (
        <ChoiceDialog title="Park — customer steps away" options={[10, 15, 20, 30].map((m) => ({ label: `${m} min`, value: m }))} withNote onClose={() => setDialog(null)} onSubmit={(minutes, note) => act("park", { minutes, note })} />
      )}
      {dialog === "break" && (
        <ChoiceDialog
          title="Take a break"
          options={[
            { label: "Short · 10 min", value: 10, extra: "short" },
            { label: "Lunch · 30 min", value: 30, extra: "lunch" },
            { label: "Meeting · 20 min", value: 20, extra: "meeting" },
          ]}
          onClose={() => setDialog(null)}
          onSubmit={(minutes, _n, reason) => act("break", { minutes, reason })}
        />
      )}
      {dialog === "followup" && (
        <ChoiceDialog
          title="Book follow-up (next working day)"
          options={[
            { label: "10:30", value: 630 },
            { label: "11:30", value: 690 },
            { label: "14:00", value: 840 },
            { label: "15:00", value: 900 },
          ]}
          onClose={() => setDialog(null)}
          onSubmit={(startMin) => act("followUp", { startMin })}
        />
      )}
      {dialog === "note" && <TextDialog title="Private note" cta="Save note" onClose={() => setDialog(null)} onSubmit={(text) => act("note", { text })} />}
      {dialog === "escalate" && <TextDialog title="Escalate to manager" cta="Send alert" onClose={() => setDialog(null)} onSubmit={(note) => act("escalate", { note })} />}
      <PhonePanel />
    </main>
  );
}

function CompleteDialog({ onClose, onSubmit, digital }: { onClose: () => void; onSubmit: (o: TokenOutcome, d: boolean) => void; digital: boolean }) {
  const [outcome, setOutcome] = useState<TokenOutcome>("RESOLVED");
  const [dig, setDig] = useState(false);
  return (
    <Modal title="Complete" onClose={onClose}>
      <div className="space-y-2">
        {(["RESOLVED", "PARTIALLY_RESOLVED", "NEEDS_FOLLOW_UP"] as TokenOutcome[]).map((o) => (
          <label key={o} className="flex items-center gap-2 rounded-md border p-2">
            <input type="radio" checked={outcome === o} onChange={() => setOutcome(o)} /> {o.replace("_", " ").toLowerCase()}
          </label>
        ))}
        <label className="flex items-center gap-2 p-2 text-sm">
          <input type="checkbox" checked={dig} onChange={(e) => setDig(e.target.checked)} /> Could have been done digitally {digital ? "(service is available online)" : ""}
        </label>
      </div>
      <Button className="mt-4 w-full" onClick={() => onSubmit(outcome, dig)}>
        Complete
      </Button>
    </Modal>
  );
}

function ServiceDialog({ title, cta, exclude, withNote, onClose, onSubmit }: { title: string; cta: string; exclude?: string; withNote?: boolean; onClose: () => void; onSubmit: (id: string, note: string) => void }) {
  const [id, setId] = useState("");
  const [note, setNote] = useState("");
  return (
    <Modal title={title} onClose={onClose}>
      <select className="h-10 w-full rounded-md border px-2" value={id} onChange={(e) => setId(e.target.value)}>
        <option value="">Choose service…</option>
        {SERVICES.filter((s) => s.id !== exclude).map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.skill.toLowerCase()})
          </option>
        ))}
      </select>
      {withNote && <Input className="mt-3" placeholder="Note for the next counter" value={note} onChange={(e) => setNote(e.target.value)} />}
      <p className="mt-2 text-xs text-muted-foreground">The customer keeps their original arrival time and gets a +20 boost.</p>
      <Button className="mt-4 w-full" disabled={!id} onClick={() => onSubmit(id, note)}>
        {cta}
      </Button>
    </Modal>
  );
}

function ChoiceDialog({ title, options, withNote, onClose, onSubmit }: { title: string; options: { label: string; value: number; extra?: string }[]; withNote?: boolean; onClose: () => void; onSubmit: (v: number, note: string, extra?: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <Modal title={title} onClose={onClose}>
      {withNote && <Input className="mb-3" placeholder="e.g. getting a photocopy of PAN" value={note} onChange={(e) => setNote(e.target.value)} />}
      <div className="grid grid-cols-2 gap-2">
        {options.map((o) => (
          <Button key={o.label} variant="outline" onClick={() => onSubmit(o.value, note, o.extra)}>
            {o.label}
          </Button>
        ))}
      </div>
    </Modal>
  );
}

function TextDialog({ title, cta, onClose, onSubmit }: { title: string; cta: string; onClose: () => void; onSubmit: (t: string) => void }) {
  const [text, setText] = useState("");
  return (
    <Modal title={title} onClose={onClose}>
      <textarea className="h-24 w-full rounded-md border p-2 text-sm" value={text} onChange={(e) => setText(e.target.value)} />
      <Button className="mt-3 w-full" onClick={() => onSubmit(text)}>
        {cta}
      </Button>
    </Modal>
  );
}
