"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BellRing, Check, Clock, Loader2, Star, XCircle } from "lucide-react";

import { PhonePanel } from "@/components/phone-panel";
import { Button } from "@/components/ui/button";
import { api, useRealtime } from "@/lib/client/live";
import { fmtTime } from "@/lib/clock";
import { SERVICE_BY_ID } from "@/lib/data/catalog";
import { etaRange } from "@/lib/engine/queue";
import type { Token } from "@/lib/types";
import { cn } from "@/lib/utils";

import { useChecklist } from "../../customer-app";

interface TrackerData {
  token: Token;
  counterNumber: number | null;
  feedbackGiven: boolean;
  ahead: number;
}

const STATUS_PILL: Record<string, string> = {
  BOOKED: "bg-brand-100 text-brand-800",
  WAITING: "bg-status-amber/15 text-status-amber",
  CALLED: "bg-status-green text-white",
  SERVING: "bg-brand-600 text-white",
  PARKED: "bg-slate-200 text-slate-700",
  COMPLETED: "bg-status-green/15 text-status-green",
  NO_SHOW: "bg-status-red/15 text-status-red",
  CANCELLED: "bg-slate-200 text-slate-600",
};

export function Tracker({ id }: { id: string }) {
  const [data, setData] = useState<TrackerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissedCall, setDismissedCall] = useState(false);
  const prevStatus = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<TrackerData>(`/api/token/${id}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);
  useRealtime(["tokens"], load, `id=eq.${id}`, 4000);

  const status = data?.token.status;
  useEffect(() => {
    if (status === "CALLED" && prevStatus.current !== "CALLED") {
      setDismissedCall(false);
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.([400, 200, 400, 200, 400]);
    }
    prevStatus.current = status ?? null;
  }, [status]);

  async function act(action: "late" | "cancel") {
    setBusy(true);
    try {
      await api(`/api/token/${id}`, { action });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return <div className="flex min-h-screen items-center justify-center">{error ? <p className="text-destructive">{error}</p> : <Loader2 className="h-6 w-6 animate-spin" />}</div>;
  }

  const t = data.token;
  const svc = SERVICE_BY_ID[t.service_id];
  const range = etaRange(t.eta_minutes);
  const active = ["BOOKED", "WAITING", "PARKED"].includes(t.status);

  return (
    <main className="mx-auto min-h-screen max-w-md bg-background pb-24">
      <header className="flex items-center gap-2 bg-brand-800 px-4 py-3 text-white">
        <Link href="/customer" className="text-brand-200">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <span className="text-sm font-semibold">Your token</span>
      </header>

      {t.status === "CALLED" && !dismissedCall && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-status-green p-6 text-center text-white">
          <BellRing className="h-16 w-16 animate-bounce" />
          <div className="mt-4 text-2xl">It&apos;s your turn!</div>
          <div className="mt-2 text-lg">Token {t.code}</div>
          <div className="mt-6 text-7xl font-black">Counter {data.counterNumber}</div>
          <p className="mt-4 opacity-90">Please go to Counter {data.counterNumber} now</p>
          <Button variant="secondary" className="mt-8" onClick={() => setDismissedCall(true)}>
            I&apos;m on my way
          </Button>
        </div>
      )}

      <section className="p-5 text-center">
        <div className="text-sm text-muted-foreground">{svc.name}</div>
        <div className="my-1 text-7xl font-black tracking-tight text-brand-900">
          {t.code}
          {t.priority_flag !== "NONE" && <Star className="ml-1 inline h-8 w-8 fill-status-amber text-status-amber" />}
        </div>
        <span className={cn("inline-block rounded-full px-3 py-1 text-xs font-semibold", STATUS_PILL[t.status])}>{t.status.replace("_", " ")}</span>

        {t.status === "WAITING" && (
          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-xl border bg-white p-4">
              <div className="text-xs text-muted-foreground">Estimated wait</div>
              <div className="text-2xl font-bold">{!range ? "—" : range.high <= 5 ? "< 5 min" : `~${range.low}–${range.high} min`}</div>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <div className="text-xs text-muted-foreground">Ahead of you</div>
              <div className="text-2xl font-bold">{data.ahead}</div>
            </div>
          </div>
        )}
        {t.status === "WAITING" && t.parked_until && new Date(t.parked_until) > new Date(0) && (
          <p className="mt-2 text-xs text-muted-foreground">Held for you until {fmtTime(t.parked_until)} — you won&apos;t lose your place.</p>
        )}
        {t.status === "BOOKED" && t.appointment_start && (
          <div className="mt-6 rounded-xl border bg-white p-4 text-sm">
            <Clock className="mx-auto mb-1 h-5 w-5 text-brand-600" />
            Appointment window <b>{fmtTime(t.appointment_start)}–{fmtTime(t.appointment_end)}</b>
            <p className="mt-1 text-muted-foreground">Check in at the kiosk with your mobile number when you arrive.</p>
          </div>
        )}
        {t.status === "SERVING" && <p className="mt-6 text-lg">Being served at Counter {data.counterNumber}</p>}
        {t.status === "CALLED" && dismissedCall && <p className="mt-6 text-lg font-semibold text-status-green">Go to Counter {data.counterNumber}</p>}

        {active && (
          <div className="mt-6 grid grid-cols-2 gap-2">
            <Button variant="outline" disabled={busy} onClick={() => act("late")}>
              <Clock /> I&apos;m running late (10 min)
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => act("cancel")}>
              <XCircle /> Cancel
            </Button>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </section>

      {t.status === "COMPLETED" && !data.feedbackGiven && <Feedback id={id} onDone={load} />}
      {t.status === "COMPLETED" && data.feedbackGiven && <p className="p-5 text-center text-status-green">Thanks for your feedback!</p>}

      {active && <Checklist serviceId={t.service_id} />}
      <PhonePanel tokenId={id} />
    </main>
  );
}

function Checklist({ serviceId }: { serviceId: string }) {
  const svc = SERVICE_BY_ID[serviceId];
  const { checked, toggle } = useChecklist(serviceId);
  return (
    <section className="mx-5 rounded-xl border bg-white p-4">
      <div className="mb-2 text-sm font-semibold">Documents to bring</div>
      <ul className="space-y-2">
        {svc.documents.map((d) => (
          <li key={d.id}>
            <button onClick={() => toggle(d.id)} className="flex items-start gap-3 text-left text-sm">
              <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border", checked.includes(d.id) && "border-status-green bg-status-green")}>
                {checked.includes(d.id) && <Check className="h-4 w-4 text-white" />}
              </span>
              {d.label}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Feedback({ id, onDone }: { id: string; onDone: () => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="mx-5 rounded-xl border bg-white p-5 text-center">
      <div className="font-semibold">How was your visit?</div>
      <div className="my-3 flex justify-center gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setRating(n)} aria-label={`${n} stars`}>
            <Star className={cn("h-9 w-9", n <= rating ? "fill-status-amber text-status-amber" : "text-slate-300")} />
          </button>
        ))}
      </div>
      <textarea className="h-20 w-full rounded-md border p-2 text-sm" placeholder="Anything we could do better? (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
      <Button
        className="mt-3 w-full"
        disabled={!rating || busy}
        onClick={async () => {
          setBusy(true);
          await api(`/api/token/${id}`, { action: "feedback", rating, comment }).catch(() => undefined);
          onDone();
        }}
      >
        {busy ? <Loader2 className="animate-spin" /> : null} Submit
      </Button>
    </section>
  );
}
