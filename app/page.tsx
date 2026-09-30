"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Building2,
  Gauge,
  Headset,
  LayoutDashboard,
  Lock,
  MonitorPlay,
  Network,
  Smartphone,
  Tablet,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BRANCHES, COUNTERS, STAFF } from "@/lib/data/branches";
import { saveSession, type Role } from "@/lib/session";
import { cn } from "@/lib/utils";

interface RoleDef {
  role: Role;
  title: string;
  description: string;
  icon: LucideIcon;
  needsBranch: boolean;
  needsPin: boolean;
}

const ROLES: RoleDef[] = [
  {
    role: "CUSTOMER",
    title: "Customer",
    description: "AI intake, document checklist, smart booking, live token tracker",
    icon: Smartphone,
    needsBranch: false,
    needsPin: false,
  },
  {
    role: "KIOSK",
    title: "Kiosk / Greeter",
    description: "Walk-in token issue at the branch entrance",
    icon: Tablet,
    needsBranch: true,
    needsPin: false,
  },
  {
    role: "DISPLAY",
    title: "Display board",
    description: "TV board: now serving, next up, wait per category",
    icon: MonitorPlay,
    needsBranch: true,
    needsPin: false,
  },
  {
    role: "STAFF",
    title: "Staff counter",
    description: "Call next, serve, transfer, park, with the AI-prepared summary",
    icon: Headset,
    needsBranch: true,
    needsPin: true,
  },
  {
    role: "MANAGER",
    title: "Manager",
    description: "Forecast, bottleneck alerts, one-click recommendations",
    icon: LayoutDashboard,
    needsBranch: true,
    needsPin: true,
  },
  {
    role: "SIMULATOR",
    title: "Simulator",
    description: "Fast-forward a branch day and trigger scenarios",
    icon: Gauge,
    needsBranch: false,
    needsPin: false,
  },
];

export default function RolePickerPage() {
  const router = useRouter();
  const [role, setRole] = useState<RoleDef | null>(null);
  const [branchId, setBranchId] = useState<string>(BRANCHES[0].id);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  const counterStaff = useMemo(
    () => STAFF.filter((s) => s.branch_id === branchId && s.role === "STAFF"),
    [branchId]
  );
  const manager = useMemo(() => STAFF.find((s) => s.branch_id === branchId && s.role === "MANAGER"), [branchId]);

  function choose(r: RoleDef) {
    setError(null);
    setPin("");
    setStaffId(null);
    if (!r.needsBranch) {
      saveSession({ role: r.role });
      router.push(r.role === "CUSTOMER" ? "/customer" : "/simulator");
      return;
    }
    setRole(r);
  }

  function enter(target?: "network") {
    if (!role) return;
    setError(null);
    if (role.role === "KIOSK") {
      saveSession({ role: "KIOSK", branchId });
      router.push(`/kiosk/${branchId}`);
    } else if (role.role === "DISPLAY") {
      saveSession({ role: "DISPLAY", branchId });
      router.push(`/display/${branchId}`);
    } else if (role.role === "STAFF") {
      const s = counterStaff.find((x) => x.id === staffId);
      if (!s) return setError("Pick your name first.");
      if (s.pin !== pin) return setError("Incorrect PIN.");
      const counter = COUNTERS.find((c) => c.staff_id === s.id)!;
      saveSession({ role: "STAFF", branchId, staffId: s.id, counterId: counter.id });
      router.push(`/staff/${counter.id}`);
    } else if (role.role === "MANAGER") {
      if (!manager || manager.pin !== pin) return setError("Incorrect PIN.");
      saveSession({ role: "MANAGER", branchId, staffId: manager.id });
      router.push(target === "network" ? "/manager/network" : `/manager/${branchId}`);
    }
  }

  const pinHint =
    role?.role === "STAFF"
      ? counterStaff.find((s) => s.id === staffId)?.pin
      : role?.role === "MANAGER"
        ? manager?.pin
        : undefined;

  return (
    <main className="min-h-screen bg-gradient-to-b from-brand-800 to-brand-900 pb-16">
      <header className="container flex flex-col gap-2 py-10 text-white">
        <div className="flex items-center gap-2">
          <Building2 className="h-7 w-7" />
          <h1 className="text-3xl font-bold tracking-tight">BranchFlow</h1>
        </div>
        <p className="max-w-2xl text-brand-100">
          Predict load, detect bottlenecks, recommend actions, and cut branch wait times. Pick a role to start the
          demo.
        </p>
        <p className="text-xs text-brand-300">Sample Demo Bank. Synthetic data only, not a real bank&apos;s procedure.</p>
      </header>

      <div className="container grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ROLES.map((r) => {
          const Icon = r.icon;
          const active = role?.role === r.role;
          return (
            <button
              key={r.role}
              type="button"
              onClick={() => choose(r)}
              className={cn(
                "group rounded-lg border border-white/10 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300",
                active && "ring-2 ring-brand-300"
              )}
            >
              <div className="flex items-start justify-between">
                <span className="rounded-md bg-brand-50 p-2.5 text-brand-700">
                  <Icon className="h-6 w-6" />
                </span>
                {r.needsPin ? (
                  <Badge variant="secondary" className="gap-1">
                    <Lock className="h-3 w-3" /> PIN
                  </Badge>
                ) : (
                  <ArrowRight className="h-5 w-5 text-muted-foreground transition group-hover:translate-x-0.5" />
                )}
              </div>
              <h2 className="mt-4 text-lg font-semibold text-brand-900">{r.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{r.description}</p>
            </button>
          );
        })}
      </div>

      {role && (
        <div className="container mt-6">
          <Card className="mx-auto max-w-2xl">
            <CardHeader>
              <CardTitle className="text-xl">{role.title}</CardTitle>
              <CardDescription>Choose a branch{role.needsPin ? ", then sign in with your PIN" : ""}.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label>Branch</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {BRANCHES.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => {
                        setBranchId(b.id);
                        setStaffId(null);
                        setPin("");
                        setError(null);
                      }}
                      className={cn(
                        "rounded-md border px-3 py-2 text-left text-sm transition hover:bg-accent",
                        branchId === b.id && "border-primary bg-secondary"
                      )}
                    >
                      <div className="font-medium">{b.name.replace("Sample Demo Bank — ", "")}</div>
                      <div className="text-xs text-muted-foreground">
                        {b.id} · {b.area_type.replace("_", " ").toLowerCase()}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {role.role === "STAFF" && (
                <div className="space-y-2">
                  <Label>Who are you?</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {counterStaff.map((s) => {
                      const counter = COUNTERS.find((c) => c.staff_id === s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setStaffId(s.id);
                            setError(null);
                          }}
                          className={cn(
                            "rounded-md border px-3 py-2 text-left text-sm transition hover:bg-accent",
                            staffId === s.id && "border-primary bg-secondary"
                          )}
                        >
                          <div className="font-medium">{s.name}</div>
                          <div className="text-xs text-muted-foreground">
                            Counter {counter?.number} · {s.skills.join(", ").toLowerCase()}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {role.role === "MANAGER" && manager && (
                <p className="text-sm text-muted-foreground">
                  Branch manager: <span className="font-medium text-foreground">{manager.name}</span>
                </p>
              )}

              {role.needsPin && (
                <div className="space-y-2">
                  <Label htmlFor="pin">4-digit PIN</Label>
                  <Input
                    id="pin"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={4}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    onKeyDown={(e) => e.key === "Enter" && enter()}
                    className="max-w-[10rem] text-center text-lg tracking-[0.5em]"
                    placeholder="••••"
                  />
                  {pinHint && <p className="text-xs text-muted-foreground">Demo PIN: {pinHint}</p>}
                </div>
              )}

              {error && <p className="text-sm font-medium text-destructive">{error}</p>}

              <div className="flex flex-wrap items-center gap-3">
                <Button size="lg" onClick={() => enter()}>
                  Continue <ArrowRight />
                </Button>
                {role.role === "MANAGER" && (
                  <Button variant="outline" size="lg" onClick={() => enter("network")}>
                    <Network /> Network view
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setRole(null)}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </main>
  );
}
