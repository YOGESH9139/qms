"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CalendarCheck, CheckCircle2, Languages, Loader2, Printer, Star, UserRound } from "lucide-react";

import { PhonePanel } from "@/components/phone-panel";
import { ServiceIcon } from "@/components/service-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, useBranchState } from "@/lib/client/live";
import { fmtTime } from "@/lib/clock";
import { BRANCHES } from "@/lib/data/branches";
import { SERVICES } from "@/lib/data/catalog";
import { etaRange } from "@/lib/engine/queue";
import { t, type Lang } from "@/lib/i18n";
import type { Branch, Category, PriorityFlag, Service, Token } from "@/lib/types";
import { cn } from "@/lib/utils";

type Step = { kind: "home" } | { kind: "details"; service: Service } | { kind: "token"; token: Token; smsSent: boolean } | { kind: "checkin" };

const CAT_KEY: Record<Category, "quick" | "standard" | "complex"> = { QUICK: "quick", STANDARD: "standard", COMPLEX: "complex" };
const CAT_STYLE: Record<Category, string> = {
  QUICK: "from-sky-50 to-white border-sky-200",
  STANDARD: "from-indigo-50 to-white border-indigo-200",
  COMPLEX: "from-violet-50 to-white border-violet-200",
};

export function Kiosk({ branch, greeter }: { branch: Branch; greeter: boolean }) {
  const [lang, setLang] = useState<Lang>("en");
  const [step, setStep] = useState<Step>({ kind: "home" });
  const [mobile, setMobile] = useState("");
  const [name, setName] = useState("");
  const [priority, setPriority] = useState<PriorityFlag>("NONE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const { data } = useBranchState(branch.id, 6000);

  const redirect = data?.settings?.redirect_to ? data.settings : null;
  const waits = data?.waitByCategory ?? {};

  // auto-return to home 25 s after showing a token (unattended kiosk)
  useEffect(() => {
    if (step.kind !== "token") return;
    const tm = setTimeout(() => reset(), 25000);
    return () => clearTimeout(tm);
  }, [step]);

  function reset() {
    setStep({ kind: "home" });
    setMobile("");
    setName("");
    setPriority("NONE");
    setError(null);
    setKey("");
  }

  async function issue(service: Service) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: Token; smsSent: boolean }>("/api/tokens", {
        branchId: branch.id,
        serviceId: service.id,
        source: greeter ? "GREETER" : "KIOSK",
        mobile: mobile || null,
        name: name || null,
        priority,
      });
      setStep({ kind: "token", token: r.token, smsSent: r.smsSent });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function checkIn() {
    setBusy(true);
    setError(null);
    try {
      const isCode = /^[a-z]\d{3}$/i.test(key.trim());
      const r = await api<{ token: Token }>("/api/checkin", { branchId: branch.id, ...(isCode ? { code: key } : { mobile: key }) });
      setStep({ kind: "token", token: r.token, smsSent: Boolean(r.token.mobile_masked) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const grouped = useMemo(() => {
    const g: Record<Category, Service[]> = { QUICK: [], STANDARD: [], COMPLEX: [] };
    for (const s of SERVICES) g[s.category].push(s);
    return g;
  }, []);

  const liveToken = step.kind === "token" ? (data?.tokens.find((x) => x.id === step.token.id) ?? step.token) : null;

  return (
    <main className="min-h-screen bg-gradient-to-b from-brand-50 to-white">
      <header className="flex items-center justify-between bg-brand-800 px-6 py-4 text-white print:hidden">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-brand-200 hover:text-white" aria-label="Back to roles">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="text-xl font-bold">{t("welcome", lang)}</div>
            <div className="text-sm text-brand-200">
              {branch.name.replace("Sample Demo Bank — ", "")} · {greeter ? "Greeter-assisted" : "Self-service kiosk"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/kiosk/${branch.id}${greeter ? "" : "?mode=greeter"}`}
            className="rounded-md border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
          >
            <UserRound className="mr-1 inline h-4 w-4" />
            {greeter ? "Kiosk mode" : "Greeter mode"}
          </Link>
          <button
            onClick={() => setLang(lang === "en" ? "hi" : "en")}
            className="rounded-md bg-white px-4 py-2 text-base font-semibold text-brand-800"
          >
            <Languages className="mr-1 inline h-4 w-4" />
            {lang === "en" ? "हिंदी" : "English"}
          </button>
        </div>
      </header>

      {redirect && step.kind === "home" && (
        <div className="flex items-center gap-2 bg-status-amber/15 px-6 py-3 text-status-amber print:hidden">
          <AlertTriangle className="h-5 w-5" />
          <span className="font-medium text-foreground">{redirect.redirect_message}</span>
          <span className="text-sm text-muted-foreground">You&apos;re still welcome to take a token here.</span>
        </div>
      )}

      <div className="mx-auto max-w-6xl px-6 py-8">
        {step.kind === "home" && (
          <>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold text-brand-900">{t("chooseService", lang)}</h1>
                <p className="mt-1 text-muted-foreground">{t("noAppNeeded", lang)}</p>
              </div>
              <Button size="lg" variant="outline" className="h-14 text-lg" onClick={() => setStep({ kind: "checkin" })}>
                <CalendarCheck className="h-5 w-5" /> {t("haveAppt", lang)}
              </Button>
            </div>
            {(["QUICK", "STANDARD", "COMPLEX"] as Category[]).map((cat) => (
              <section key={cat} className="mb-8">
                <div className="mb-3 flex items-baseline gap-3">
                  <h2 className="text-xl font-semibold text-brand-800">{t(CAT_KEY[cat], lang)}</h2>
                  <span className="text-sm text-muted-foreground">
                    {t("estWait", lang)}: {etaText(waits[cat])}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {grouped[cat].map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setStep({ kind: "details", service: s })}
                      className={cn(
                        "flex min-h-[7.5rem] flex-col items-start justify-between rounded-xl border bg-gradient-to-br p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md active:scale-[0.99]",
                        CAT_STYLE[cat]
                      )}
                    >
                      <ServiceIcon name={s.icon} className="h-9 w-9 text-brand-700" />
                      <span className="text-lg font-semibold leading-tight text-brand-900">{lang === "hi" ? s.name_hi : s.name}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </>
        )}

        {step.kind === "details" && (
          <div className="mx-auto max-w-xl rounded-2xl border bg-white p-8 shadow-sm">
            <button onClick={reset} className="mb-4 text-sm text-muted-foreground hover:text-foreground">
              ← {t("back", lang)}
            </button>
            <div className="mb-6 flex items-center gap-4">
              <ServiceIcon name={step.service.icon} className="h-12 w-12 text-brand-700" />
              <div>
                <div className="text-2xl font-bold">{lang === "hi" ? step.service.name_hi : step.service.name}</div>
                <div className="text-muted-foreground">
                  {t("estWait", lang)}: {etaText(waits[step.service.category])}
                </div>
              </div>
            </div>
            {greeter && (
              <label className="mb-4 block">
                <span className="mb-1 block text-sm font-medium">Customer name (greeter)</span>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="h-12 text-lg" />
              </label>
            )}
            <label className="mb-4 block">
              <span className="mb-1 block text-sm font-medium">{t("mobileOptional", lang)}</span>
              <Input
                inputMode="numeric"
                value={mobile}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="98xxxxxxxx"
                className="h-12 text-lg tracking-wider"
              />
            </label>
            <fieldset className="mb-6">
              <legend className="mb-2 text-sm font-medium">{t("priority", lang)}</legend>
              <div className="flex flex-wrap gap-2">
                {(["SENIOR", "DISABLED", "PREGNANT"] as PriorityFlag[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(priority === p ? "NONE" : p)}
                    className={cn(
                      "rounded-full border px-4 py-2 text-base",
                      priority === p ? "border-primary bg-primary text-primary-foreground" : "bg-white hover:bg-accent"
                    )}
                  >
                    {p === "SENIOR" ? t("senior", lang) : p === "DISABLED" ? t("disabled", lang) : t("pregnant", lang)}
                  </button>
                ))}
              </div>
            </fieldset>
            {error && <p className="mb-3 text-destructive">{error}</p>}
            <Button size="lg" className="h-14 w-full text-lg" disabled={busy} onClick={() => issue(step.service)}>
              {busy ? <Loader2 className="animate-spin" /> : null} {t("getToken", lang)}
            </Button>
          </div>
        )}

        {step.kind === "checkin" && (
          <div className="mx-auto max-w-xl rounded-2xl border bg-white p-8 shadow-sm">
            <button onClick={reset} className="mb-4 text-sm text-muted-foreground hover:text-foreground">
              ← {t("back", lang)}
            </button>
            <h2 className="mb-4 text-2xl font-bold">{t("haveAppt", lang)}</h2>
            <label className="mb-4 block">
              <span className="mb-1 block text-sm font-medium">{t("enterMobile", lang)}</span>
              <Input value={key} onChange={(e) => setKey(e.target.value.slice(0, 12))} placeholder="9876543210 or A001" className="h-14 text-xl tracking-wider" />
            </label>
            <p className="mb-4 text-xs text-muted-foreground">Demo: the first booking today uses mobile 9876543210.</p>
            {error && <p className="mb-3 text-destructive">{error}</p>}
            <Button size="lg" className="h-14 w-full text-lg" disabled={busy || key.length < 4} onClick={checkIn}>
              {busy ? <Loader2 className="animate-spin" /> : null} {t("checkIn", lang)}
            </Button>
          </div>
        )}

        {step.kind === "token" && liveToken && (
          <TokenScreen token={liveToken} smsSent={step.smsSent} lang={lang} branch={branch} onDone={reset} />
        )}
      </div>
      {greeter && <PhonePanel />}
    </main>
  );
}

function etaText(eta: number | undefined | null) {
  const r = etaRange(eta ?? 0);
  if (!r || r.high <= 5) return "< 5 min";
  return `~${r.low}–${r.high} min`;
}

function TokenScreen({ token, smsSent, lang, branch, onDone }: { token: Token; smsSent: boolean; lang: Lang; branch: Branch; onDone: () => void }) {
  const svc = SERVICES.find((s) => s.id === token.service_id)!;
  const star = token.priority_flag !== "NONE";
  return (
    <>
      <div className="mx-auto max-w-xl rounded-2xl border bg-white p-10 text-center shadow-lg print:hidden">
        <CheckCircle2 className="mx-auto h-12 w-12 text-status-green" />
        <div className="mt-2 text-lg text-muted-foreground">{t("yourToken", lang)}</div>
        <div className="my-2 text-8xl font-black tracking-tight text-brand-900">
          {token.code}
          {star && <Star className="ml-2 inline h-12 w-12 fill-status-amber text-status-amber" />}
        </div>
        <div className="text-xl font-medium">{lang === "hi" ? svc.name_hi : svc.name}</div>
        {token.status === "WAITING" && (
          <div className="mt-4 text-lg">
            {t("estWait", lang)}: <b>{etaText(token.eta_minutes)}</b>
            {token.position != null && <span className="text-muted-foreground"> · #{token.position} in line</span>}
          </div>
        )}
        {token.status === "CALLED" && (
          <div className="mt-4 rounded-lg bg-status-green/15 p-3 text-xl font-bold text-status-green">Please go to the counter shown on the screen now</div>
        )}
        {smsSent && <div className="mt-3 text-sm text-status-green">✓ {t("smsSent", lang)}</div>}
        <p className="mt-4 text-muted-foreground">{t("watchScreen", lang)}</p>
        <div className="mt-6 flex justify-center gap-3">
          <Button variant="outline" size="lg" onClick={() => window.print()}>
            <Printer /> {t("print", lang)}
          </Button>
          <Button size="lg" onClick={onDone}>
            {t("done", lang)}
          </Button>
        </div>
      </div>
      {/* printable slip */}
      <div className="hidden print:block">
        <div className="mx-auto w-[58mm] text-center font-mono text-[11px] leading-tight">
          <div className="font-bold">SAMPLE DEMO BANK</div>
          <div>{branch.name.replace("Sample Demo Bank — ", "")}</div>
          <div className="my-2 border-y border-dashed py-2 text-4xl font-black">
            {token.code}
            {star ? "*" : ""}
          </div>
          <div>{svc.name}</div>
          <div>Issued {fmtTime(token.created_at)}</div>
          <div>Est. wait {etaText(token.eta_minutes)}</div>
          <div className="mt-2">Watch the display for your counter.</div>
          <div className="mt-2 border-t border-dashed pt-1">Documents: {svc.documents.filter((d) => d.required).map((d) => d.label.split("(")[0].trim()).join(", ")}</div>
        </div>
      </div>
    </>
  );
}

export const KIOSK_BRANCHES = BRANCHES;
