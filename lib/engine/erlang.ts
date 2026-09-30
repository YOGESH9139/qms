// Erlang C staffing (CLAUDE.md 9.2): minimum agents N so that P(wait ≤ target) ≥ service level (80%).

/** Erlang C: probability an arriving customer has to wait. A = offered load in Erlangs (λ/μ). */
export function erlangC(n: number, a: number): number {
  if (a <= 0) return 0;
  if (n <= a) return 1;
  let b = 1; // Erlang B, computed iteratively for stability
  for (let k = 1; k <= n; k++) b = (a * b) / (k + a * b);
  return (n * b) / (n - a * (1 - b));
}

/** P(wait ≤ t) with n agents. λ per hour, avg handle in minutes, target in minutes. */
export function serviceLevel(n: number, lambdaPerHour: number, avgHandleMin: number, targetMin: number): number {
  if (lambdaPerHour <= 0) return 1;
  const mu = 60 / avgHandleMin; // per hour
  const a = lambdaPerHour / mu;
  if (n <= a) return 0;
  const c = erlangC(n, a);
  return 1 - c * Math.exp(-(n * mu - lambdaPerHour) * (targetMin / 60));
}

export interface StaffingNeed {
  agents: number;
  serviceLevel: number;
  load: number; // Erlangs
}

export function agentsNeeded(lambdaPerHour: number, avgHandleMin: number, targetMin: number, target = 0.8): StaffingNeed {
  const load = (lambdaPerHour * avgHandleMin) / 60;
  if (lambdaPerHour <= 0) return { agents: 0, serviceLevel: 1, load: 0 };
  let n = Math.max(1, Math.ceil(load));
  let sl = serviceLevel(n, lambdaPerHour, avgHandleMin, targetMin);
  while (sl < target && n < 50) {
    n++;
    sl = serviceLevel(n, lambdaPerHour, avgHandleMin, targetMin);
  }
  return { agents: n, serviceLevel: Math.round(sl * 1000) / 1000, load: Math.round(load * 100) / 100 };
}

/** Expected wait (minutes) for a random arrival with n agents — used for network "current wait" estimates. */
export function expectedWait(n: number, lambdaPerHour: number, avgHandleMin: number): number {
  if (lambdaPerHour <= 0 || n <= 0) return 0;
  const mu = 60 / avgHandleMin;
  const a = lambdaPerHour / mu;
  if (n <= a) return 60;
  return Math.min(60, (erlangC(n, a) / (n * mu - lambdaPerHour)) * 60);
}
