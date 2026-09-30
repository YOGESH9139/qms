"use client";

import { useCallback, useState } from "react";
import { MessageSquare, Smartphone, X } from "lucide-react";

import { api, useRealtime } from "@/lib/client/live";
import { fmtTime } from "@/lib/clock";
import { cn } from "@/lib/utils";

interface Sms {
  id: number;
  mobile_masked: string;
  token_id: string | null;
  body: string;
  at: string;
}

/** Floating mock phone showing the SMS outbox (all SMS are mocked — CLAUDE.md section 2). */
export function PhonePanel({ tokenId, mobile, defaultOpen = false }: { tokenId?: string; mobile?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [msgs, setMsgs] = useState<Sms[]>([]);
  const [seen, setSeen] = useState(0);
  const load = useCallback(async () => {
    const q = tokenId ? `?token=${tokenId}` : mobile ? `?mobile=${encodeURIComponent(mobile)}` : "";
    try {
      const r = await api<{ messages: Sms[] }>(`/api/sms${q}`);
      setMsgs(r.messages);
    } catch {
      /* phone is decorative; ignore */
    }
  }, [tokenId, mobile]);
  useRealtime(["sms_outbox"], load, undefined, 5000);

  const unread = Math.max(0, (msgs[0]?.id ?? 0) - seen > 0 ? msgs.filter((m) => m.id > seen).length : 0);

  return (
    <div className="fixed bottom-4 right-4 z-40 print:hidden">
      {open ? (
        <div className="flex h-[30rem] w-72 flex-col overflow-hidden rounded-[2rem] border-[6px] border-slate-800 bg-slate-100 shadow-2xl">
          <div className="flex items-center justify-between bg-slate-800 px-4 py-2 text-xs text-slate-200">
            <span className="flex items-center gap-1">
              <Smartphone className="h-3.5 w-3.5" /> Messages (mock SMS)
            </span>
            <button onClick={() => setOpen(false)} aria-label="Close phone">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {msgs.length === 0 && <p className="pt-10 text-center text-xs text-slate-500">No messages yet</p>}
            {msgs.map((m) => (
              <div key={m.id} className="rounded-2xl rounded-tl-sm bg-white p-2.5 text-xs shadow-sm">
                <div className="mb-1 flex justify-between text-[10px] text-slate-400">
                  <span>DM-DEMOBK → {m.mobile_masked}</span>
                  <span>{fmtTime(m.at)}</span>
                </div>
                <p className="leading-snug text-slate-800">{m.body}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <button
          onClick={() => {
            setOpen(true);
            setSeen(msgs[0]?.id ?? 0);
          }}
          className="relative flex h-14 w-14 items-center justify-center rounded-full bg-slate-800 text-white shadow-xl transition hover:scale-105"
          aria-label="Open phone"
        >
          <MessageSquare className="h-6 w-6" />
          {unread > 0 && (
            <span className={cn("absolute -right-1 -top-1 rounded-full bg-status-red px-1.5 text-xs font-bold")}>{unread}</span>
          )}
        </button>
      )}
    </div>
  );
}
