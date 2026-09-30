// Domain types — mirror supabase/migrations/0001_init.sql exactly.

export type Category = "QUICK" | "STANDARD" | "COMPLEX";
export type Skill = "QUICK" | "STANDARD" | "COMPLEX" | "LOANS";
export const SKILLS: Skill[] = ["QUICK", "STANDARD", "COMPLEX", "LOANS"];
export const CATEGORIES: Category[] = ["QUICK", "STANDARD", "COMPLEX"];

export type AreaType = "URBAN_BUSINESS" | "RESIDENTIAL" | "SEMI_URBAN" | "SENIOR_HEAVY" | "COLLEGE_AREA";
export type DigitalLevel = "FULL" | "PARTIAL" | "NONE";

export type CounterStatus = "OFFLINE" | "AVAILABLE" | "SERVING" | "ON_BREAK";
export type TokenSource = "APP_APPOINTMENT" | "APP_WALKIN" | "KIOSK" | "GREETER" | "STAFF";
export type PriorityFlag = "NONE" | "SENIOR" | "DISABLED" | "PREGNANT";
export type TokenStatus =
  | "BOOKED"
  | "WAITING"
  | "CALLED"
  | "SERVING"
  | "PARKED"
  | "COMPLETED"
  | "TRANSFERRED"
  | "NO_SHOW"
  | "CANCELLED";
export type TokenOutcome = "RESOLVED" | "PARTIALLY_RESOLVED" | "NEEDS_FOLLOW_UP";
export type StaffRole = "STAFF" | "MANAGER";
export type Sentiment = "pos" | "neu" | "neg";
export type FeedbackTopic =
  | "wait_time"
  | "staff_behaviour"
  | "documents_confusion"
  | "system_down"
  | "process_complexity"
  | "cleanliness"
  | "other";

export interface Branch {
  id: string;
  name: string;
  area_type: AreaType;
  address: string;
  lat: number;
  lng: number;
  open_time: string; // "HH:MM"
  close_time: string; // "HH:MM"
}

export interface ServiceDocument {
  id: string;
  label: string;
  note?: string;
  required: boolean;
}

export interface Service {
  id: string;
  name: string;
  name_hi: string;
  category: Category;
  skill: Skill;
  avg_handle_min: number;
  target_wait_min: number;
  digital_possible: boolean;
  digital_level: DigitalLevel;
  digital_minutes: number | null;
  digital_channel: string | null;
  digital_link: string | null;
  digital_steps: string[];
  documents: ServiceDocument[];
  keywords: string[];
  icon: string; // lucide-react icon name
  sort_order: number;
}

export interface Staff {
  id: string;
  branch_id: string;
  name: string;
  pin: string;
  role: StaffRole;
  skills: Skill[];
  primary_skill: Skill;
}

export interface Counter {
  id: string;
  branch_id: string;
  number: number;
  staff_id: string | null;
  status: CounterStatus;
  mode_skill: Skill | null;
  status_since: string;
  break_expected_end: string | null;
  break_reason: string | null;
  human_control?: boolean;
}

export interface AiSummary {
  summary: string;
  extra_notes?: string;
  confidence?: number;
  documents_checked?: string[];
  language?: "en" | "hi";
}

export interface Token {
  id: string;
  branch_id: string;
  code: string;
  service_id: string;
  customer_name: string | null;
  mobile_masked: string | null;
  language?: "en" | "hi";
  mobile_hash?: string | null;
  source: TokenSource;
  priority_flag: PriorityFlag;
  status: TokenStatus;
  created_at: string;
  appointment_start: string | null;
  appointment_end: string | null;
  checked_in_at: string | null;
  called_at: string | null;
  serving_started_at: string | null;
  completed_at: string | null;
  counter_id: string | null;
  recall_count: number;
  skip_count: number;
  parked_until: string | null;
  original_arrival_at: string;
  returning_boost: boolean;
  parent_token_id: string | null;
  ai_summary: AiSummary | null;
  outcome: TokenOutcome | null;
  could_be_digital: boolean | null;
  eta_minutes: number | null;
  position: number | null;
}

export interface TokenEvent {
  id: string;
  token_id: string;
  type: string;
  from_status: TokenStatus | null;
  to_status: TokenStatus | null;
  counter_id: string | null;
  staff_id: string | null;
  note: string | null;
  at: string;
}

export interface Feedback {
  id: string;
  token_id: string | null;
  visit_id: number | null;
  branch_id: string;
  rating: number;
  comment: string | null;
  sentiment: Sentiment | null;
  topics: FeedbackTopic[];
  at: string;
}

export interface Alert {
  id: string;
  branch_id: string;
  type: string;
  severity: "INFO" | "WARN" | "CRITICAL";
  title: string;
  why: string;
  suggested_action_id: string | null;
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  at: string;
}

export interface Recommendation {
  id: string;
  branch_id: string;
  type:
    | "SWITCH_FOCUS"
    | "OPEN_COUNTER"
    | "DIGITAL_NUDGE"
    | "TIME_SHIFT_APPOINTMENTS"
    | "BRANCH_REDIRECT"
    | "STAFF_LENDING";
  title: string;
  explanation: string;
  impact: Record<string, unknown>;
  action: Record<string, unknown>;
  status: "OPEN" | "ACCEPTED" | "DISMISSED";
  at: string;
}
