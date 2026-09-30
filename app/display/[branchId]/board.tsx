"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { QrCode, Star, Volume2, VolumeX } from "lucide-react";

import { useBranchState, useSimNow } from "@/lib/client/live";
import { fmtTime } from "@/lib/clock";
import { SERVICES, SERVICE_BY_ID } from "@/lib/data/catalog";
import { etaRange } from "@/lib/engine/queue";
import type { Branch, Token } from "@/lib/types";
import { cn } from "@/lib/utils";

const TIPS = SERVICES.filter((s) => s.digital_level === "FULL").map(
  (s) => `${s.name}? About ${s.digital_minutes} min on the app via ${s.digital_channel} — scan the QR, no queue needed.`
);

function chime(ctx: AudioContext) {
  const tones = [880, 660];
  tones.forEach((f, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = f;
    o.type = "sine";
    g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.35);
    g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + i * 0.35 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.35 + 0.6);
    o.connect(g).connect(ctx.destination);
    o.start(ctx.currentTime + i * 0.35);
    o.stop(ctx.currentTime + i * 0.35 + 0.65);
  });
}

function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.9;
  window.speechSynthesis.speak(u);
}

export function Board({ branch }: { branch: Branch }) {
  const { data, error } = useBranchState(branch.id, 3000);
  const now = useSimNow(data?.sim);
  const [sound, setSound] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const announced = useRef<Set<string> | null>(null);
  const [tip, setTip] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setTip((x) => (x + 1) % TIPS.length), 7000);
    return () => clearInterval(t);
  }, []);

  const counterNo = useMemo(() => new Map((data?.counters ?? []).map((c) => [c.id, c.number])), [data]);
  const serving = useMemo(
    () =>
      (data?.tokens ?? [])
        .filter((t) => (t.status === "CALLED" || t.status === "SERVING") && t.counter_id)
        .sort((a, b) => new Date(b.called_at ?? 0).getTime() - new Date(a.called_at ?? 0).getTime()),
    [data]
  );
  const next = useMemo(
    () =>
      (data?.tokens ?? [])
        .filter((t) => t.status === "WAITING" && t.position != null)
        .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
        .slice(0, 6),
    [data]
  );

  // announce newly CALLED tokens (twice)
  useEffect(() => {
    if (!data) return;
    const called = data.tokens.filter((t) => t.status === "CALLED");
    if (announced.current === null) {
      announced.current = new Set(called.map((t) => `${t.id}:${t.recall_count}`));
      return;
    }
    for (const t of called) {
      const k = `${t.id}:${t.recall_count}`;
      if (announced.current.has(k)) continue;
      announced.current.add(k);
      setFlash(t.id);
      setTimeout(() => setFlash(null), 6000);
      if (sound && audio.current) {
        const n = counterNo.get(t.counter_id ?? "");
        const line = `Token ${t.code.split("").join(" ")}, please go to counter ${n}.`;
        chime(audio.current);
        setTimeout(() => speak(line), 800);
        setTimeout(() => {
          if (audio.current) chime(audio.current);
          setTimeout(() => speak(line), 800);
        }, 4500);
      }
    }
  }, [data, sound, counterNo]);

  const waits = data?.waitByCategory ?? {};

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-[#07142b] text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-10 py-5">
        <div>
          <div className="text-3xl font-bold tracking-tight">Sample Demo Bank</div>
          <div className="text-lg text-brand-200">{branch.name.replace("Sample Demo Bank — ", "")} branch</div>
        </div>
        <div className="flex items-center gap-6">
          <button
            onClick={() => {
              audio.current ??= new AudioContext();
              audio.current.resume();
              setSound(!sound);
            }}
            className={cn("flex items-center gap-2 rounded-lg px-4 py-2 text-lg", sound ? "bg-white/10" : "bg-status-amber text-black")}
          >
            {sound ? <Volume2 /> : <VolumeX />} {sound ? "Sound on" : "Tap to enable sound"}
          </button>
          <div className="text-right">
            <div className="text-5xl font-bold tabular-nums">{fmtTime(now)}</div>
            {error && <div className="text-sm text-status-red">reconnecting…</div>}
          </div>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-[1.35fr_1fr] gap-8 px-10 py-8">
        <section>
          <h2 className="mb-4 text-2xl font-semibold uppercase tracking-widest text-brand-200">Now serving</h2>
          <div className="grid grid-cols-[1fr_auto] gap-x-8 text-2xl text-brand-300">
            <span>Token</span>
            <span>Counter</span>
          </div>
          <div className="mt-2 space-y-3">
            {serving.slice(0, 6).map((t, i) => (
              <ServingRow key={t.id} t={t} counter={counterNo.get(t.counter_id!)} highlight={i === 0 || flash === t.id} />
            ))}
            {serving.length === 0 && <div className="py-10 text-3xl text-brand-300">Counters opening shortly</div>}
          </div>
        </section>

        <section className="flex flex-col gap-8">
          <div>
            <h2 className="mb-4 text-2xl font-semibold uppercase tracking-widest text-brand-200">Next up</h2>
            <div className="grid grid-cols-3 gap-3">
              {next.map((t) => (
                <div key={t.id} className="rounded-xl bg-white/5 py-4 text-center text-4xl font-bold tabular-nums">
                  {t.code}
                  {t.priority_flag !== "NONE" && <Star className="ml-1 inline h-6 w-6 fill-status-amber text-status-amber" />}
                </div>
              ))}
              {next.length === 0 && <div className="col-span-3 text-2xl text-brand-300">No one waiting</div>}
            </div>
          </div>
          <div>
            <h2 className="mb-4 text-2xl font-semibold uppercase tracking-widest text-brand-200">Estimated wait</h2>
            <div className="grid grid-cols-3 gap-3">
              {(["QUICK", "STANDARD", "COMPLEX"] as const).map((c) => {
                const w = waits[c] ?? 0;
                const r = etaRange(w)!;
                return (
                  <div key={c} className="rounded-xl bg-white/5 p-4 text-center">
                    <div className="text-lg text-brand-200">{c === "QUICK" ? "Quick" : c === "STANDARD" ? "Standard" : "Accounts & loans"}</div>
                    <div className={cn("text-4xl font-bold", w > 30 ? "text-status-red" : w > 15 ? "text-status-amber" : "text-emerald-400")}>
                      {r.high <= 5 ? "< 5" : `${r.low}–${r.high}`}
                      <span className="text-xl"> min</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      <footer className="flex items-center gap-4 bg-brand-700 px-10 py-4 text-2xl">
        <QrCode className="h-10 w-10 shrink-0" />
        <span className="truncate">{TIPS[tip]}</span>
      </footer>
    </main>
  );
}

function ServingRow({ t, counter, highlight }: { t: Token; counter?: number; highlight: boolean }) {
  return (
    <div
      className={cn(
        "grid grid-cols-[1fr_auto] items-center gap-x-8 rounded-2xl px-6 py-4 transition-all",
        highlight ? "animate-pulse bg-emerald-500 text-black" : "bg-white/5"
      )}
    >
      <span className="text-6xl font-black tabular-nums">
        {t.code}
        {t.priority_flag !== "NONE" && <Star className="ml-2 inline h-8 w-8 fill-current" />}
        <span className="ml-4 align-middle text-xl font-medium opacity-70">{SERVICE_BY_ID[t.service_id].name}</span>
      </span>
      <span className="text-6xl font-black tabular-nums">{counter}</span>
    </div>
  );
}
