"use client";

// Demo "auth": the role picker stores who you are in sessionStorage. No real authentication (CLAUDE.md section 2).

export type Role = "CUSTOMER" | "KIOSK" | "DISPLAY" | "STAFF" | "MANAGER" | "SIMULATOR";

export interface DemoSession {
  role: Role;
  branchId?: string;
  staffId?: string;
  counterId?: string;
}

const KEY = "branchflow.session";

export function saveSession(s: DemoSession): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable (private mode) — demo still works via URLs
  }
}

export function loadSession(): DemoSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DemoSession) : null;
  } catch {
    return null;
  }
}
