"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  Info,
  Languages,
  Loader2,
  MapPin,
  Send,
  ShieldAlert,
  Smartphone,
  Sparkles,
  Star,
  Ticket,
} from "lucide-react";

import { PhonePanel } from "@/components/phone-panel";
import { ServiceIcon } from "@/components/service-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client/live";
import { fmtDate } from "@/lib/clock";
import { BRANCHES, getBranch } from "@/lib/data/branches";
import { SERVICE_BY_ID, TOP_SERVICE_IDS } from "@/lib/data/catalog";
import { t, type Lang } from "@/lib/i18n";
import type { IntakeResult, IntakeTurn } from "@/lib/intake-rules";
import { maskSensitive } from "@/lib/sensitive";
import type { Service, Token } from "@/lib/types";
import { cn, maskMobile } from "@/lib/utils";

type Step = "profile" | "chat" | "plan" | "book" | "booked";

interface Profile {
  name: string;
  mobile: string;
  lang: Lang;
}

interface ChatMsg {
  role: "user" | "assistant";
  text: string;
  options?: string[];
  why?: string;
}

const HOME_BRANCH = "BR01"; // the customer's "usual" branch in the demo

export function CustomerApp() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("profile");
  const [profile, setProfile] = useState<Profile>({ name: "", mobile: "", lang: "en" });
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [otherOpen, setOtherOpen] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lang = profile.lang;
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("bf.customer");
      if (saved) setProfile(JSON.parse(saved));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, thinking]);

  function startChat() {
    try {
      localStorage.setItem("bf.customer", JSON.stringify(profile));
    } catch {
      /* ignore */
    }
    setChat([
      { role: "assistant", text: `${t("hello", lang)} ${t("whatHelp", lang)}`, options: [...TOP_SERVICE_IDS.map((id) => (lang === "hi" ? SERVICE_BY_ID[id].name_hi : SERVICE_BY_ID[id].name)), t("somethingElse", lang)] },
    ]);
    setStep("chat");
  }

  async function send(text: string) {
    if (!text.trim()) return;
    if (text === t("somethingElse", lang)) {
      setOtherOpen(true);
      return;
    }
    const m = maskSensitive(text);
    setWarning(
      m.found.length
        ? `For your safety we hid what looked like a ${m.found.join(" / ")}. Never share account, Aadhaar, PAN or card numbers — we don't need them here.`
        : null
    );
    const next: ChatMsg[] = [...chat.map((c) => ({ ...c, options: undefined })), { role: "user", text: m.text }];
    setChat(next);
    setInput("");
    setOtherOpen(false);
    setThinking(true);
    try {
      const history: IntakeTurn[] = next.map((c) => ({ role: c.role, text: c.text }));
      const r = await api<IntakeResult & { masked: string[] }>("/api/intake", { history, lang });
      if (r.done && r.service_id) {
        setResult(r);
        const s = SERVICE_BY_ID[r.service_id];
        setChat([...next, { role: "assistant", text: `${lang === "hi" ? "समझ गया" : "Got it"} — ${lang === "hi" ? s.name_hi : s.name}.`, why: whyText(r) }]);
        setTimeout(() => setStep("plan"), 700);
      } else {
        setChat([...next, { role: "assistant", text: r.question ?? t("whatHelp", lang), options: [...(r.options ?? []), t("other", lang)], why: whyText(r) }]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setThinking(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-md bg-background pb-24 shadow-sm">
      <header className="sticky top-0 z-20 flex items-center justify-between bg-brand-800 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <Link href="/" aria-label="Back to roles" className="text-brand-200">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="text-sm font-semibold">Sample Demo Bank</div>
            <div className="text-[11px] text-brand-200">BranchFlow · in-app branch assistant</div>
          </div>
        </div>
        <button
          onClick={() => setProfile({ ...profile, lang: lang === "en" ? "hi" : "en" })}
          className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs"
        >
          <Languages className="h-3.5 w-3.5" /> {lang === "en" ? "हिंदी" : "English"}
        </button>
      </header>

      {step === "profile" && (
        <section className="space-y-4 p-5">
          <h1 className="pt-4 text-2xl font-bold text-brand-900">{t("hello", lang)}</h1>
          <p className="text-sm text-muted-foreground">
            {lang === "hi" ? "बताइए आपको क्या चाहिए — हम दस्तावेज़, सही समय और टोकन तैयार कर देंगे।" : "Tell us what you need — we'll prepare your documents list, the best time to come and your token."}
          </p>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t("yourName", lang)}</span>
            <Input className="h-12 text-base" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t("mobile", lang)}</span>
            <Input
              className="h-12 text-base tracking-wider"
              inputMode="numeric"
              value={profile.mobile}
              onChange={(e) => setProfile({ ...profile, mobile: e.target.value.replace(/\D/g, "").slice(0, 10) })}
            />
          </label>
          {otpSent && (
            <label className="block space-y-1">
              <span className="text-sm font-medium">{t("otp", lang)}</span>
              <Input className="h-12 text-center text-xl tracking-[0.6em]" inputMode="numeric" maxLength={4} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} />
            </label>
          )}
          {!otpSent ? (
            <Button size="lg" className="h-12 w-full" disabled={!profile.name || profile.mobile.length !== 10} onClick={() => setOtpSent(true)}>
              {lang === "hi" ? "ओटीपी भेजें" : "Send OTP"}
            </Button>
          ) : (
            <Button size="lg" className="h-12 w-full" disabled={otp !== "1234"} onClick={startChat}>
              {t("continue", lang)}
            </Button>
          )}
          <p className="text-center text-xs text-muted-foreground">Demo OTP is 1234. We never ask for account, Aadhaar, PAN or card numbers.</p>
        </section>
      )}

      {step === "chat" && (
        <section className="flex min-h-[calc(100vh-56px)] flex-col">
          <div className="flex-1 space-y-3 p-4">
            {chat.map((m, i) => (
              <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[85%] space-y-2")}>
                  <div className={cn("rounded-2xl px-4 py-2.5 text-sm", m.role === "user" ? "rounded-br-sm bg-brand-700 text-white" : "rounded-bl-sm bg-muted")}>
                    {m.role === "assistant" && <Bot className="mb-1 h-4 w-4 text-brand-600" />}
                    {m.text}
                  </div>
                  {m.why && (
                    <details className="px-2 text-[11px] text-muted-foreground">
                      <summary className="cursor-pointer">Why?</summary>
                      {m.why}
                    </details>
                  )}
                  {m.options && (
                    <div className="flex flex-wrap gap-2">
                      {m.options.map((o) => (
                        <button
                          key={o}
                          onClick={() => (o === t("other", lang) ? setOtherOpen(true) : send(o))}
                          className="rounded-full border border-brand-300 bg-white px-3 py-2 text-sm text-brand-800 shadow-sm active:scale-95"
                        >
                          {o}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {thinking && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {lang === "hi" ? "समझ रहा हूँ…" : "Understanding…"}
              </div>
            )}
            {warning && (
              <div className="flex gap-2 rounded-lg bg-status-amber/15 p-3 text-xs">
                <ShieldAlert className="h-4 w-4 shrink-0 text-status-amber" /> {warning}
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div ref={end} />
          </div>
          {(otherOpen || chat.length > 1) && (
            <form
              className="sticky bottom-0 flex gap-2 border-t bg-white p-3"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <Input autoFocus value={input} onChange={(e) => setInput(e.target.value)} placeholder={t("typeHere", lang)} className="h-11" />
              <Button type="submit" size="icon" className="h-11 w-11" disabled={!input.trim() || thinking}>
                <Send />
              </Button>
            </form>
          )}
        </section>
      )}

      {step === "plan" && result?.service_id && (
        <Plan service={SERVICE_BY_ID[result.service_id]} result={result} profile={profile} onBook={() => setStep("book")} onToken={(tok) => router.push(`/customer/token/${tok.id}`)} />
      )}

      {(step === "book" || step === "booked") && result?.service_id && (
        <Booking service={SERVICE_BY_ID[result.service_id]} result={result} profile={profile} onBack={() => setStep("plan")} onBooked={() => setStep("booked")} />
      )}
      <PhonePanel mobile={profile.mobile.length === 10 ? maskMobile(profile.mobile) : undefined} />
    </main>
  );
}

function whyText(r: IntakeResult): string {
  const pct = Math.round((r.confidence ?? 0) * 100);
  return r.source === "llm"
    ? `AI classification (confidence ${pct}%). Summary for staff: “${r.summary}”.`
    : `Matched keywords in your message against the service catalog (confidence ${pct}%).`;
}

function checklistKey(serviceId: string) {
  return `bf.check.${serviceId}`;
}

export function useChecklist(serviceId: string) {
  const [checked, setChecked] = useState<string[]>([]);
  useEffect(() => {
    try {
      setChecked(JSON.parse(localStorage.getItem(checklistKey(serviceId)) ?? "[]"));
    } catch {
      setChecked([]);
    }
  }, [serviceId]);
  const toggle = (id: string) => {
    const next = checked.includes(id) ? checked.filter((x) => x !== id) : [...checked, id];
    setChecked(next);
    try {
      localStorage.setItem(checklistKey(serviceId), JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  return { checked, toggle };
}

function Plan({ service, result, profile, onBook, onToken }: { service: Service; result: IntakeResult; profile: Profile; onBook: () => void; onToken: (t: Token) => void }) {
  const lang = profile.lang;
  const { checked, toggle } = useChecklist(service.id);
  const [atBranch, setAtBranch] = useState(false);
  const [best, setBest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const branch = getBranch(HOME_BRANCH)!;

  useEffect(() => {
    api<{ bestHour: string | null }>(`/api/booking/slots?branch=${HOME_BRANCH}`)
      .then((r) => setBest(r.bestHour))
      .catch(() => setBest(null));
  }, []);

  async function walkIn() {
    setBusy(true);
    try {
      const r = await api<{ token: Token }>("/api/tokens", {
        branchId: HOME_BRANCH,
        serviceId: service.id,
        source: "APP_WALKIN",
        name: profile.name,
        mobile: profile.mobile,
        aiSummary: { summary: result.summary, extra_notes: result.extra_notes, confidence: result.confidence, documents_checked: checked, language: lang },
      });
      onToken(r.token);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  const catColor = service.category === "QUICK" ? "green" : service.category === "STANDARD" ? "amber" : "red";

  return (
    <section className="space-y-4 p-4">
      <h1 className="pt-2 text-xl font-bold text-brand-900">{t("yourPlan", lang)}</h1>

      {/* 1. Summary */}
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <ServiceIcon name={service.icon} className="h-9 w-9 text-brand-700" />
          <div className="flex-1">
            <div className="text-xs text-muted-foreground">{profile.name}</div>
            <div className="text-lg font-semibold">{lang === "hi" ? service.name_hi : service.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <Badge variant={catColor as "green" | "amber" | "red"}>{service.category.toLowerCase()}</Badge>
              <span className="text-muted-foreground">
                <Clock className="mr-0.5 inline h-3 w-3" />~{service.avg_handle_min} min at the counter
              </span>
            </div>
          </div>
        </div>
        <p className="mt-3 rounded-md bg-muted p-2 text-sm">{result.summary}</p>
        <details className="mt-1 text-[11px] text-muted-foreground">
          <summary className="cursor-pointer">Why?</summary>
          {whyText(result)}
        </details>
      </div>

      {/* 2. Online option */}
      <div className={cn("rounded-xl border p-4", service.digital_possible ? "border-status-green/40 bg-status-green/5" : "bg-white")}>
        <div className="flex items-center gap-2 font-semibold">
          <Sparkles className={cn("h-4 w-4", service.digital_possible ? "text-status-green" : "text-muted-foreground")} /> {t("onlineTitle", lang)}
        </div>
        {service.digital_possible ? (
          <>
            <p className="mt-1 text-sm">
              <b>
                {t("saveTrip", lang)} ~{service.digital_minutes} min
              </b>{" "}
              via {service.digital_channel}
              {service.digital_level === "PARTIAL" && " (some cases still need a visit)"}.
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
              {service.digital_steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <a
              href={service.digital_link ?? "#"}
              target="_blank"
              rel="noreferrer"
              onClick={() => api("/api/events", { type: "digital_deflection", service_id: service.id, branch_id: HOME_BRANCH }).catch(() => undefined)}
              className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-status-green font-medium text-white"
            >
              <Smartphone className="h-4 w-4" /> {t("openApp", lang)} <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">This needs a branch visit. We&apos;ll make it quick.</p>
        )}
      </div>

      {/* 3. Documents */}
      <div className="rounded-xl border bg-white p-4">
        <div className="mb-2 font-semibold">{t("documents", lang)}</div>
        <ul className="space-y-2">
          {service.documents.map((d) => (
            <li key={d.id}>
              <button onClick={() => toggle(d.id)} className="flex w-full items-start gap-3 text-left">
                <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border", checked.includes(d.id) && "border-status-green bg-status-green")}>
                  {checked.includes(d.id) && <Check className="h-4 w-4 text-white" />}
                </span>
                <span className="text-sm">
                  {d.label}
                  {!d.required && <span className="text-muted-foreground"> (if applicable)</span>}
                  {d.note && <span className="block text-xs text-muted-foreground">{d.note}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">Bring originals + 1 self-attested photocopy. Your ticks are saved on this phone.</p>
      </div>

      {/* 4. Tips */}
      <div className="rounded-xl border bg-white p-4 text-sm">
        <div className="mb-1 font-semibold">{t("tips", lang)}</div>
        <p>
          <Info className="mr-1 inline h-4 w-4 text-brand-600" />
          Least crowded time today at {branch.name.replace("Sample Demo Bank — ", "")}: <b>{best ?? "—"}</b> (from the branch forecast)
        </p>
        <p className="mt-1 text-muted-foreground">
          Branch hours {branch.open_time}–{branch.close_time}, closed Sundays and 2nd/4th Saturdays.
        </p>
      </div>

      {/* 5. Visit options */}
      <div className="rounded-xl border bg-white p-4">
        <div className="mb-3 font-semibold">{t("visitOptions", lang)}</div>
        <Button size="lg" className="h-12 w-full" onClick={onBook}>
          <CalendarDays /> {t("book", lang)}
        </Button>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={atBranch} onChange={(e) => setAtBranch(e.target.checked)} /> {t("atBranch", lang)} <span className="text-xs text-muted-foreground">(demo toggle for location)</span>
        </label>
        {atBranch && (
          <Button variant="outline" size="lg" className="mt-2 h-12 w-full" onClick={walkIn} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Ticket />} {t("walkIn", lang)}
          </Button>
        )}
        {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
      </div>
    </section>
  );
}

interface NetBranch {
  id: string;
  name: string;
  waitMin: number;
  lat: number;
  lng: number;
}
interface Slot {
  startMin: number;
  label: string;
  level: "GREEN" | "AMBER" | "RED";
  remaining: number;
  disabled: boolean;
  best: boolean;
}

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function Booking({ service, result, profile, onBack, onBooked }: { service: Service; result: IntakeResult; profile: Profile; onBack: () => void; onBooked: () => void }) {
  const [branches, setBranches] = useState<NetBranch[] | null>(null);
  const [branchId, setBranchId] = useState(HOME_BRANCH);
  const [date, setDate] = useState<string | null>(null);
  const [days, setDays] = useState<string[]>([]);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const [booked, setBooked] = useState<Token | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { checked } = useChecklist(service.id);
  const home = getBranch(HOME_BRANCH)!;

  useEffect(() => {
    api<{ branches: NetBranch[] }>("/api/network")
      .then((r) => setBranches(r.branches))
      .catch(() => setBranches(BRANCHES.map((b) => ({ id: b.id, name: b.name, waitMin: 0, lat: b.lat, lng: b.lng }))));
  }, []);

  useEffect(() => {
    setSlots(null);
    setSlot(null);
    api<{ days: string[]; slots: Slot[] }>(`/api/booking/slots?branch=${branchId}${date ? `&date=${date}` : ""}`)
      .then((r) => {
        setDays(r.days);
        setSlots(r.slots);
        if (!date) setDate(r.days[0]);
      })
      .catch((e) => setErr((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, date]);

  const sorted = useMemo(
    () => (branches ?? []).map((b) => ({ ...b, km: km(home, b) })).sort((a, b) => a.km + a.waitMin / 3 - (b.km + b.waitMin / 3)),
    [branches, home]
  );
  const usual = sorted.find((b) => b.id === HOME_BRANCH);

  async function book() {
    if (!slot || !date) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ token: Token }>("/api/booking", {
        branchId,
        serviceId: service.id,
        date,
        startMin: slot.startMin,
        name: profile.name,
        mobile: profile.mobile,
        aiSummary: { summary: result.summary, extra_notes: result.extra_notes, confidence: result.confidence, documents_checked: checked, language: profile.lang },
      });
      setBooked(r.token);
      onBooked();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (booked) {
    return (
      <section className="space-y-4 p-4">
        <div className="rounded-xl border border-status-green/40 bg-status-green/5 p-5 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-status-green" />
          <div className="mt-2 text-sm text-muted-foreground">Appointment confirmed</div>
          <div className="text-3xl font-black text-brand-900">{slot?.label}</div>
          <div className="text-sm">
            {date && fmtDate(date)} · {getBranch(branchId)!.name.replace("Sample Demo Bank — ", "")}
          </div>
          <div className="mt-3 text-sm">
            Booking code <b className="text-lg">{booked.code}</b>
          </div>
        </div>
        <div className="rounded-xl border bg-white p-4 text-sm">
          <ul className="space-y-2">
            <li>📱 SMS confirmation sent. We&apos;ll SMS again <b>60 min</b> before with your expected call time, and <b>15 min</b> before.</li>
            <li>🏦 On arrival, check in at the kiosk with your mobile number — your appointment gets priority in its window.</li>
            <li>⏱️ More than 15 min after your window? You&apos;ll join as a walk-in (with a small head start).</li>
          </ul>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={async () => { await api(`/api/token/${booked.id}`, { action: "cancel" }); setBooked(null); onBack(); }}>
            Cancel
          </Button>
          <Button variant="outline" onClick={async () => { await api(`/api/token/${booked.id}`, { action: "cancel" }); setBooked(null); setSlot(null); }}>
            Reschedule
          </Button>
        </div>
        <Link href={`/customer/token/${booked.id}`} className="block text-center text-sm text-primary underline">
          Open live tracker
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-4 p-4">
      <button onClick={onBack} className="text-sm text-muted-foreground">
        ← {t("back", profile.lang)}
      </button>
      <h1 className="text-xl font-bold text-brand-900">Book {service.name.toLowerCase()}</h1>

      <div>
        <div className="mb-2 text-sm font-semibold">1. Branch</div>
        {!branches && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
        <div className="space-y-2">
          {sorted.slice(0, 4).map((b) => (
            <button
              key={b.id}
              onClick={() => { setBranchId(b.id); setDate(null); }}
              className={cn("flex w-full items-center justify-between rounded-lg border bg-white p-3 text-left", branchId === b.id && "border-primary ring-1 ring-primary")}
            >
              <span>
                <span className="block text-sm font-medium">{b.name.replace("Sample Demo Bank — ", "")}</span>
                <span className="text-xs text-muted-foreground">
                  <MapPin className="mr-0.5 inline h-3 w-3" />
                  {b.km.toFixed(1)} km {b.id === HOME_BRANCH && "· your usual branch"}
                </span>
              </span>
              <span className={cn("text-sm font-semibold", b.waitMin > 25 ? "text-status-red" : b.waitMin > 12 ? "text-status-amber" : "text-status-green")}>
                ~{b.waitMin} min wait
              </span>
            </button>
          ))}
        </div>
        {usual && sorted[0] && sorted[0].id !== HOME_BRANCH && sorted[0].waitMin < usual.waitMin && (
          <p className="mt-2 text-xs text-status-green">
            {sorted[0].name.replace("Sample Demo Bank — ", "")}: ~{sorted[0].waitMin} min wait vs your usual ~{usual.waitMin} min
          </p>
        )}
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold">2. Date</div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {days.map((d) => (
            <button key={d} onClick={() => setDate(d)} className={cn("shrink-0 rounded-lg border bg-white px-3 py-2 text-sm", date === d && "border-primary bg-secondary")}>
              {fmtDate(d)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between text-sm font-semibold">
          <span>3. Time (30 min window)</span>
          <span className="flex gap-2 text-[10px] font-normal">
            <span className="text-status-green">● quiet</span>
            <span className="text-status-amber">● moderate</span>
            <span className="text-status-red">● busy</span>
          </span>
        </div>
        {!slots && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
        <div className="grid grid-cols-3 gap-2">
          {slots?.map((s) => (
            <button
              key={s.startMin}
              disabled={s.disabled}
              onClick={() => setSlot(s)}
              className={cn(
                "relative rounded-lg border-2 p-2 text-center text-xs disabled:opacity-35",
                s.level === "GREEN" && "border-status-green/50 bg-status-green/10",
                s.level === "AMBER" && "border-status-amber/50 bg-status-amber/10",
                s.level === "RED" && "border-status-red/50 bg-status-red/10",
                slot?.startMin === s.startMin && "ring-2 ring-primary"
              )}
            >
              {s.best && <Star className="absolute -right-1.5 -top-1.5 h-4 w-4 fill-status-amber text-status-amber" />}
              <div className="font-semibold">{s.label.split("–")[0]}</div>
              <div className="text-[10px] text-muted-foreground">{s.disabled ? "full" : `${s.remaining} left`}</div>
            </button>
          ))}
        </div>
        {slots?.some((s) => s.best) && (
          <p className="mt-2 text-xs text-muted-foreground">
            <Star className="inline h-3 w-3 fill-status-amber text-status-amber" /> Least crowded, from the branch&apos;s arrivals forecast
          </p>
        )}
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}
      <Button size="lg" className="h-12 w-full" disabled={!slot || busy} onClick={book}>
        {busy ? <Loader2 className="animate-spin" /> : <CalendarDays />} {slot ? `Confirm ${slot.label}` : "Choose a time"}
      </Button>
    </section>
  );
}
