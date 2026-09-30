# BranchFlow — Intelligent Branch Service Load & Customer Experience Optimizer

> Hackathon project (TCS problem statement). This file is the single source of truth for the build.
> Claude Code: read this entire file before writing any code. Follow the stack, data model and logic exactly.
> Priority is a WORKING, DEMO-ABLE end-to-end flow in one day, not completeness. Numbers are computed by
> deterministic code; the LLM is only used for conversation, classification and plain-English phrasing.

---

## 1. What we are building (one paragraph)

A branch operations platform with four connected surfaces:
1. **Customer app** (mobile-first web/PWA, pitched as "integrates into the bank's app"): conversational AI intake that
   identifies the need, resolves it digitally when possible, gives a document checklist, and books a smart
   appointment slot or a walk-in token.
2. **Branch floor**: a self-service kiosk / greeter tablet for walk-ins, and a TV display board.
3. **Staff console**: counter-level queue actions with the customer's AI-prepared summary.
4. **Manager command center**: load forecast, bottleneck alerts, staffing and redirection recommendations with
   explanations and one-click "Accept" actions, feedback insights, multi-branch view.

Plus a **synthetic data generator** (90 days, 5 branches) and a **live simulator** that fast-forwards a branch day
for the demo.

The core loop: *predict load → detect bottleneck → recommend action → manager accepts → system executes → wait drops.*

---

## 2. Tech stack (do not change)

- Next.js 14 (App Router, TypeScript), Tailwind CSS, shadcn/ui, lucide-react, Recharts
- Supabase (Postgres + Realtime). Fallback if Supabase setup fails: SQLite via better-sqlite3 + 2s polling.
- LLM: Anthropic API (`@anthropic-ai/sdk`), key in `.env.local` as `ANTHROPIC_API_KEY`. Every LLM call must have a
  rule-based fallback so the demo never breaks.
- Queue engine, forecast, Erlang C, recommendations: pure TypeScript modules in `/lib/engine`, unit tested with Vitest.
- SMS: mocked. Write to `sms_outbox` table and show in an on-screen "phone" panel. (Twilio only if time remains.)
- Auth: no real auth. Role switcher on `/` with a simple 4-digit PIN per staff member.

Routes:
```
/                      role picker (Customer / Kiosk / Display / Staff / Manager / Simulator)
/customer              AI intake → result → book
/customer/token/[id]   live token tracker
/kiosk/[branchId]      walk-in token issue (also greeter mode)
/display/[branchId]    TV board
/staff/[counterId]     counter console
/manager/[branchId]    command center (tabs)
/manager/network       all branches
/simulator             speed control + scenario buttons
/api/...               route handlers
```

---

## 3. Data model

```
branches(id, name, area_type, lat, lng, open_time, close_time)
services(id, name, category, skill, avg_handle_min, target_wait_min, digital_possible bool,
         digital_link, digital_steps jsonb, documents jsonb, keywords text[])
staff(id, branch_id, name, pin, skills text[], primary_skill)
counters(id, branch_id, number, staff_id nullable, status, mode_skill, status_since, break_expected_end)
   status: OFFLINE | AVAILABLE | SERVING | ON_BREAK
tokens(id, branch_id, code, service_id, customer_name, mobile_masked, source, priority_flag,
       status, created_at, appointment_start, appointment_end, checked_in_at, called_at,
       serving_started_at, completed_at, counter_id, recall_count, parked_until,
       original_arrival_at, ai_summary jsonb, outcome, eta_minutes, position)
   source: APP_APPOINTMENT | APP_WALKIN | KIOSK | GREETER | STAFF
   priority_flag: NONE | SENIOR | DISABLED | PREGNANT
   status: BOOKED | WAITING | CALLED | SERVING | PARKED | COMPLETED | TRANSFERRED | NO_SHOW | CANCELLED
token_events(id, token_id, type, from_status, to_status, counter_id, staff_id, note, at)   -- audit log, feeds analytics
counter_events(id, counter_id, staff_id, type, reason, at)
feedback(id, token_id, branch_id, rating 1-5, comment, sentiment, topics text[], at)
forecasts(branch_id, date, hour, category, expected_arrivals, explanation jsonb)
alerts(id, branch_id, type, severity, title, why, suggested_action_id, status, at)
recommendations(id, branch_id, type, title, explanation, impact jsonb, action jsonb, status, at)
   status: OPEN | ACCEPTED | DISMISSED
sms_outbox(id, mobile_masked, token_id, body, at)
visit_history(...)  -- 90 days of synthetic historical visits for forecasting
```
Never store full account numbers, Aadhaar, PAN. Mobile numbers stored masked for display (98xxxxxx21).

---

## 4. Service catalog (seed data — this is the knowledge base the AI is grounded on)

Categories: **QUICK** (≤5 min), **STANDARD** (5–15 min), **COMPLEX** (15+ min). Skill = category, plus `LOANS` for loan work.

| Service | Cat | Skill | Avg min | Target wait | Digital? |
|---|---|---|---|---|---|
| Cash deposit | QUICK | QUICK | 4 | 10 | Partly (cash deposit machine) |
| Cash withdrawal | QUICK | QUICK | 3 | 10 | Yes (ATM) |
| Cheque deposit | QUICK | QUICK | 3 | 10 | Yes (drop box) |
| Passbook update | QUICK | QUICK | 2 | 10 | Yes (kiosk/app statement) |
| Cheque book request | QUICK | QUICK | 3 | 10 | Yes (app) |
| NEFT/RTGS transfer | QUICK | QUICK | 5 | 10 | Yes (app) |
| Demand draft | STANDARD | STANDARD | 8 | 15 | No |
| KYC update | STANDARD | STANDARD | 10 | 15 | Yes (video KYC) |
| Address / mobile update | STANDARD | STANDARD | 10 | 15 | Partly |
| Debit card issue/replace | STANDARD | STANDARD | 10 | 15 | Yes (block/reissue in app) |
| FD open/close | STANDARD | STANDARD | 10 | 15 | Yes (app) |
| Nominee update | STANDARD | STANDARD | 8 | 15 | Yes (app) |
| Life certificate (pension) | STANDARD | STANDARD | 8 | 15 | Yes (Jeevan Pramaan) |
| Account opening | COMPLEX | COMPLEX | 25 | 20 | Partly (video KYC) |
| Loan enquiry | COMPLEX | LOANS | 20 | 20 | Partly |
| Loan application / docs | COMPLEX | LOANS | 30 | 20 | No |
| Locker services | COMPLEX | COMPLEX | 20 | 20 | No |
| Complaint / dispute | COMPLEX | COMPLEX | 20 | 20 | Partly (online grievance) |

Each service row also carries: `documents` (list), `digital_steps` (numbered navigation steps), `keywords`.
Use realistic generic documents (ID proof, address proof, passport photo, PAN, cancelled cheque, etc.).
Label everything "sample / demo bank" — do not claim to be a real bank's procedure.

---

## 5. Customer app

### 5.1 Conversational AI intake
- Step 1: name, mobile (mock OTP "1234"), language (English / Hindi).
- Step 2: "What do you need help with today?" → 6 chips (top services) + "Something else" free text.
- LLM classifies into `service_id` with confidence. If confidence < 0.7, ask up to 3 follow-up questions, each
  rendered as 2–4 tappable chips + "Other (type)". Max 5 turns total.
- LLM must return strict JSON:
  ```json
  {"done": bool, "question": str|null, "options": [str], "service_id": str|null, "confidence": 0-1,
   "summary": "one-line problem summary for staff", "extra_notes": str}
  ```
- Fallback (no API / bad JSON): keyword match on `services.keywords`, then show the category chips.
- Never ask for account number, Aadhaar, PAN, card number. If the user types one, mask it and warn.

### 5.2 Result screen ("Your plan")
Card sections, in order:
1. **Summary**: name, problem in one line, identified service, category badge, estimated time at counter.
2. **Can this be done online?** If `digital_possible`: green card, "Save a trip — do it in ~X min", numbered
   navigation steps, deep link button. Track click as `digital_deflection` event.
3. **Documents checklist**: tickable items, "Bring originals + 1 photocopy" style notes. Tick state persists.
4. **Before you visit tips**: best time to visit today (from forecast), branch hours.
5. **Visit options**: "Book appointment" (primary) or "Get a walk-in token now" (only if user is at/near branch;
   in demo, a toggle).

### 5.3 Smart appointment booking
- Choose branch (list sorted by distance + current wait, shows "Branch B: ~8 min wait vs your usual ~35 min").
- Choose date, then 30-min slot grid. Each slot colored GREEN / AMBER / RED by forecasted crowd and shows
  remaining appointment capacity. Full slots disabled. Recommend the best slot with a star ("Least crowded").
- Customer gets a **time window at booking** (e.g. 11:00–11:30) — never "we'll tell you later".
- Day of visit: SMS 60 min before with refined expected-call time; SMS 15 min before if running on time/late.
- Arrival: check in at kiosk by mobile/QR → token becomes WAITING with appointment boost.
- Late > 15 min after window end → converted to normal walk-in (keeps a small boost). Cancel/reschedule buttons.

### 5.4 Token tracker (/customer/token/[id])
Big token code, status pill, position in line, ETA range ("~10–15 min"), live updates, checklist below,
buttons: "I'm running late (10 min)", "Cancel". When CALLED: full-screen "Go to Counter 4", vibration, SMS.
After COMPLETED: feedback (stars + optional comment).

---

## 6. Branch floor

### 6.1 Kiosk / greeter tablet
Big icon tiles for services (grouped by category), language toggle, optional mobile number, priority checkbox
(Senior citizen / Differently abled / Pregnant — verified by greeter), confirm → token screen with code, ETA,
"SMS sent" (if mobile given) and a printable slip view. Greeter mode = same flow, staff-assisted, for customers
who cannot use phones. **Walk-ins are always accepted; nobody is turned away for not having the app.**

Token codes: `Q###` QUICK, `S###` STANDARD, `C###` COMPLEX/LOANS, `A###` appointments. Priority tokens show a ★.

### 6.2 Display board (TV, 16:9)
- "Now serving" list: token → counter, newest highlighted, soft chime on new call (announce twice).
- "Next up" (next 6 tokens, no counter shown).
- Estimated wait per category.
- Rotating tip strip for digital deflection ("Cheque book? 2 min on the app — scan QR").
- **Counter number appears only when a token is CALLED.** We never pre-assign counters in the queue.

---

## 7. Queue engine (the heart — `/lib/engine/queue.ts`)

### 7.1 Pull-based routing
Tokens are NOT pushed to counters. When a counter presses **Call next**, the engine picks the best eligible token.
This avoids counter numbers flipping on customers' screens and handles staff changes automatically.

Eligible tokens for counter c: `status = WAITING`, `service.skill ∈ staff.skills`, not parked, and appointment
tokens only if `now ≥ appointment_start − 10 min`.

Score (highest wins):
```
score = minutes_waited_since(original_arrival_at)        // fairness
      + 15  if priority_flag != NONE
      + 30  if appointment and now within window           // honor booked time
      + 20  if returning from PARKED or TRANSFERRED        // don't punish re-routing
      + 10  if service.skill == counter.mode_skill         // specialization
      + 50  if minutes_waited > service.target_wait_min    // SLA breach rescue
```
Return the token AND a human-readable reason list ("waited 18 min", "appointment due", "SLA breached") shown on
the staff console as "Why this customer".

### 7.2 ETA estimation (recompute on every event)
Discrete projection: for each active counter compute `free_at` (SERVING: now + max(1, avg_handle − elapsed);
AVAILABLE: now; ON_BREAK: break_expected_end; OFFLINE: excluded). Loop: take the counter with the earliest
`free_at`, apply the same scoring (using projected time) to remaining WAITING tokens, assign, advance
`free_at += service.avg_handle_min`. Store `eta_minutes` and `position` per token. Display as a 5-minute range.

`avg_handle_min` is learned: rolling mean of the last 30 actual handle times per service per branch
(falls back to catalog value). Pitch this as "the system learns each branch's real service times".

### 7.3 Token state machine
```
BOOKED ──check-in──▶ WAITING ──call──▶ CALLED ──start──▶ SERVING ──complete──▶ COMPLETED
                        ▲                 │                  │
                        │   no response   │                  ├─transfer──▶ WAITING (new service/skill, +20 boost)
                        │   (recall ≤1)   ▼                  ├─park──────▶ PARKED ──return──▶ WAITING (+20)
                        └──── moved back 3 places            └─add service▶ new linked token
                                          │ 2nd miss
                                          ▼
                                       NO_SHOW
Any non-final state ──cancel──▶ CANCELLED
```
Every transition writes a `token_events` row.

### 7.4 Counter modes and auto-rebalancing
Each counter has `mode_skill` (its current focus). Staff with multiple skills can serve anything in their skill
set, but prefer their mode. The recommendation engine (section 9) suggests mode switches when one category's
projected wait exceeds target and a multi-skilled counter's category is under-loaded.

---

## 8. Staff console (/staff/[counterId])

Header: staff name, counter number, status toggle, today's served count, avg handle time vs branch avg.

**Counter status actions**
- Go online / Go offline (end shift)
- Take break (reason: lunch / short / meeting; expected duration) → counter ON_BREAK, ETAs recompute
- Back from break
- Change focus (mode_skill) — within own skills

**Token actions**
- **Call next** → engine picks token, shows "Why this customer", chime on display, SMS to customer
- **Recall** (announce again; max 1)
- **Customer arrived / Start** → SERVING, timer starts
- **Not here / Skip** → back 3 places (1st time), NO_SHOW (2nd time)
- **Complete** with outcome: Resolved / Partially resolved / Needs follow-up; checkbox "Could have been done digitally"
- **Transfer** → pick target service or skill + note; keeps original arrival time
- **Park** (customer went to get a missing document/photocopy; 10–30 min) → returns with boost
- **Add another service** (same customer needs a 2nd thing) → linked token at the right skill
- **Book follow-up appointment** for the customer
- **Escalate to manager** (creates an alert)
- Add private note

**Customer panel** (when CALLED/SERVING): AI summary from intake, identified service, document checklist
(what customer ticked), priority flag, previous transfers/notes, live handle timer turning amber at 1.5× average.

**Queue side panel**: my eligible queue (next 5), per-category counts, branch-wide wait.

---

## 9. Manager command center (/manager/[branchId]) — this is what the problem statement actually scores

Tabs:

**Live**: counter grid (status color, staff, current token, timer), queue length + projected wait per category vs
target, KPI strip (avg wait, P90 wait, SLA %, served, no-shows, digital deflections today), open alerts.

**Forecast**: today's hourly expected arrivals (bars) vs actual (line) per category; tomorrow's forecast; recommended
counters per hour (from Erlang C) vs rostered. Each hour has an "Explain" popover listing the factors.

**Recommendations**: cards, each with title, plain-English explanation, predicted impact
("Standard wait 38 → 14 min"), and Accept / Dismiss. Accept actually executes the action.

**Insights**: CSAT trend, feedback topics and sentiment, top services that customers came in for but were digital
(deflection opportunity), most-transferred services (misrouting signal), staff handle-time comparison.

**Network** (/manager/network): table + map of all branches: current wait, forecast peak, staff gap, CSAT.
Suggests redirecting customers or lending staff between nearby branches.

### 9.1 Forecast model (`/lib/engine/forecast.ts`) — explainable by design
```
expected_arrivals(branch, date, hour, category) =
    base_rate[branch][day_of_week][hour][category]     // mean from 90-day history
  × salary_day_factor   (1.4 on days 1–5)
  × month_end_factor    (1.2 on last 2 working days)
  × post_holiday_factor (1.3 day after a holiday)
  × pension_day_factor  (1.3 for STANDARD in senior-heavy branches, days 1–7)
  + booked_appointments(branch, date, hour, category)
```
Explanation JSON lists base value and each multiplier applied. Report forecast accuracy (MAPE) on the last 14
days of synthetic data in the Forecast tab. (Optional stretch: a LightGBM notebook for comparison in the pitch.)

### 9.2 Staffing need — Erlang C (`/lib/engine/erlang.ts`)
For each hour and skill: arrival rate λ from forecast, service rate μ = 60/avg_handle. Find the minimum agents N
such that P(wait ≤ target) ≥ 80%. Gap = N − rostered staff with that skill. This gives defensible numbers.

### 9.3 Bottleneck alerts (rule-based, run every engine tick)
| Alert | Trigger | Suggested action |
|---|---|---|
| Queue overload | projected wait > 1.5× target for a category | switch a flexible counter / open counter |
| Stuck counter | current handle > 2.5× avg | check in with staff |
| Long break | break exceeded expected end by 10 min | notify |
| Forecast gap | next 2 hours Erlang need > available | call in / move staff |
| No-show spike | >20% no-shows last hour | shorten recall grace, SMS reminders |
| Misrouting | same service transferred ≥3 times today | fix intake mapping / counter skills |
| Low CSAT | avg rating < 3 in last 10 feedbacks | review comments |

Each alert stores `why` in plain English with numbers, e.g.
"Standard queue: 9 waiting, projected 38 min vs 15 min target. Only 1 of 3 Standard-skilled staff is serving
(Anita on break, Ravi on Quick counter where the queue is 2)."

### 9.4 Recommendation types (Accept = execute)
1. **Switch counter focus**: move a multi-skilled counter's mode_skill. Execute: update counter.
2. **Open extra counter**: bring an offline rostered staff online.
3. **Digital nudge**: SMS waiting QUICK customers whose service is digital ("Your cheque book request takes 2 min
   on the app — keep your token if you prefer"). Execute: batch SMS.
4. **Time-shift appointments**: offer customers booked in an overloaded slot a quieter slot. Execute: SMS offers.
5. **Branch redirect**: suggest a nearby branch with low wait to new arrivals/bookings. Execute: banner on
   customer app + kiosk.
6. **Staff lending** (network view): move a staff member between branches for a day.
Impact is computed by re-running the ETA projection with the action applied (what-if), never guessed by the LLM.
The LLM may only rewrite the explanation into friendlier language.

### 9.5 Feedback analysis
After COMPLETED, SMS link → rating + comment. LLM tags `sentiment` (pos/neu/neg) and `topics` from:
wait_time, staff_behaviour, documents_confusion, system_down, process_complexity, cleanliness, other.
Fallback: keyword tagging.

---

## 10. Synthetic data (`/scripts/generate.ts` → CSV in `/data` + DB seed)

- 5 branches: Urban business (lunch-hour peak), Residential (morning + evening peaks), Semi-urban
  (market-day peak), Senior-heavy (pension-day peak, more STANDARD), College-area (QUICK heavy, start-of-month).
- 90 days of history, Poisson arrivals per hour from each profile's curve × the day factors in 9.1.
- Service mix per profile; handle times lognormal around avg_handle_min.
- Staff: 5–7 per branch with mixed skills, rosters with ~8% random absences and breaks.
- Wait times produced by replaying the queue engine on the history (so data is consistent).
- Feedback: ~30% of visits; rating correlated with wait; templated comments in English + some Hinglish.
- All names synthetic, mobiles masked. Document this in README ("Data Considerations" section of the problem).

---

## 11. Live simulator (/simulator) — the demo weapon

- Clock control: pause, 1×, 10×, 30×, 60×. Simulated "today" starts 10:00.
- Generates walk-ins from today's forecast; bot staff auto-serve with lognormal times. Any counter can be
  switched to "human control" so a teammate operates it live on the staff console.
- Scenario buttons: **Salary-day rush**, **Staff goes on unplanned break**, **Counter system outage**,
  **Senior citizen group arrives**, **Reset day**.
- Everything (display, staff, manager, customer tracker) updates in real time from the same engine.

---

## 12. KPIs shown everywhere
Average wait, P90 wait, SLA % (served within target), no-show %, first-visit resolution %, digital deflections,
staff utilization %, CSAT. Show "before vs after BranchFlow" on the simulator by replaying the same day with
(a) FIFO single queue, no recommendations, and (b) BranchFlow routing + accepted recommendations.

---

## 13. UI rules
- Mobile-first for customer pages; large touch targets; English/Hindi toggle on customer + kiosk.
- Calm bank palette (deep blue + white, green/amber/red only for status). High contrast on the display board.
- Every AI output shows a small "Why?" link with the reasoning.
- Loading and error states everywhere; LLM failures silently fall back to rules.

## 14. Build order (must-have first)
1. Scaffold, schema, seed catalog + synthetic data
2. Queue engine + ETA + tests
3. Kiosk, display board, staff console (realtime)
4. Customer AI intake + result + token tracker + booking
5. Forecast, Erlang C, alerts, recommendations, manager dashboard
6. Simulator + scenarios + before/after comparison
7. Stretch: network view, feedback insights, Hindi, Twilio SMS
