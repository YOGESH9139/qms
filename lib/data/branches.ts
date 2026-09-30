// 5 demo branches + staff (CLAUDE.md section 10). All names synthetic. PINs are demo-only.
// Kept static (not random) so the role picker works without a DB and PINs are memorable for the demo.
// PIN scheme: staff = <b><b>0<n> (BR02 staff 3 -> 2203), manager = <b><b>00 (BR02 -> 2200).

import type { Branch, Category, Skill, Staff } from "@/lib/types";

export const BRANCHES: Branch[] = [
  {
    id: "BR01",
    name: "Sample Demo Bank — MG Road",
    area_type: "URBAN_BUSINESS",
    address: "MG Road, Bengaluru (demo)",
    lat: 12.9756,
    lng: 77.6066,
    open_time: "10:00",
    close_time: "17:00",
  },
  {
    id: "BR02",
    name: "Sample Demo Bank — Whitefield",
    area_type: "RESIDENTIAL",
    address: "Whitefield, Bengaluru (demo)",
    lat: 12.9698,
    lng: 77.75,
    open_time: "10:00",
    close_time: "16:00",
  },
  {
    id: "BR03",
    name: "Sample Demo Bank — Hoskote",
    area_type: "SEMI_URBAN",
    address: "Market Road, Hoskote (demo)",
    lat: 13.0707,
    lng: 77.7981,
    open_time: "10:00",
    close_time: "16:00",
  },
  {
    id: "BR04",
    name: "Sample Demo Bank — Jayanagar",
    area_type: "SENIOR_HEAVY",
    address: "4th Block, Jayanagar, Bengaluru (demo)",
    lat: 12.925,
    lng: 77.5938,
    open_time: "10:00",
    close_time: "16:00",
  },
  {
    id: "BR05",
    name: "Sample Demo Bank — Malleshwaram",
    area_type: "COLLEGE_AREA",
    address: "Sampige Road, Malleshwaram, Bengaluru (demo)",
    lat: 13.0035,
    lng: 77.5709,
    open_time: "10:00",
    close_time: "16:00",
  },
];

// Staff definitions: [name, skills (first = primary)]
type StaffDef = [string, Skill[]];

const ALL: Skill[] = ["COMPLEX", "LOANS", "STANDARD", "QUICK"];

const STAFF_DEFS: Record<string, { manager: string; counters: StaffDef[] }> = {
  BR01: {
    manager: "Kavitha Raghunath",
    counters: [
      ["Arjun Mehra", ["QUICK"]],
      ["Sneha Kulkarni", ["QUICK", "STANDARD"]],
      ["Ravi Shankar", ["QUICK", "STANDARD"]],
      ["Anita Desai", ["STANDARD", "QUICK"]],
      ["Farhan Qureshi", ["STANDARD", "COMPLEX"]],
      ["Meera Pillai", ["LOANS", "COMPLEX"]],
      ["Suresh Iyer", ALL], // senior officer — covers every skill
    ],
  },
  BR02: {
    manager: "Deepak Malhotra",
    counters: [
      ["Pooja Hegde", ["QUICK", "STANDARD"]],
      ["Vikram Rao", ["QUICK"]],
      ["Lakshmi Narayan", ["STANDARD", "QUICK"]],
      ["Imran Sheikh", ["STANDARD", "COMPLEX"]],
      ["Divya Menon", ["LOANS", "COMPLEX"]],
      ["Harish Gowda", ALL],
    ],
  },
  BR03: {
    manager: "Manjunath Reddy",
    counters: [
      ["Shilpa Patil", ["QUICK", "STANDARD"]],
      ["Ramesh Babu", ["QUICK"]],
      ["Asha Kumari", ["STANDARD", "QUICK"]],
      ["Naveen Shetty", ["LOANS", "COMPLEX"]],
      ["Girish Hosmani", ALL],
    ],
  },
  BR04: {
    manager: "Uma Srinivasan",
    counters: [
      ["Prakash Joshi", ["QUICK", "STANDARD"]],
      ["Revathi Subramanian", ["STANDARD", "QUICK"]],
      ["Anand Bhat", ["STANDARD"]],
      ["Nandini Rao", ["STANDARD", "COMPLEX"]],
      ["Karthik Venkatesh", ["LOANS", "COMPLEX"]],
      ["Geetha Murthy", ALL],
    ],
  },
  BR05: {
    manager: "Sanjay Kapoor",
    counters: [
      ["Neha Agarwal", ["QUICK"]],
      ["Rahul Verma", ["QUICK", "STANDARD"]],
      ["Priya Nair", ["STANDARD", "QUICK"]],
      ["Aditya Kamath", ["LOANS", "COMPLEX"]],
      ["Zoya Khan", ALL],
    ],
  },
};

function branchNo(branchId: string): number {
  return Number(branchId.slice(2));
}

export const STAFF: Staff[] = BRANCHES.flatMap((b) => {
  const n = branchNo(b.id);
  const def = STAFF_DEFS[b.id];
  const manager: Staff = {
    id: `${b.id}-M`,
    branch_id: b.id,
    name: def.manager,
    pin: `${n}${n}00`,
    role: "MANAGER",
    skills: [...ALL],
    primary_skill: "COMPLEX",
  };
  const counterStaff: Staff[] = def.counters.map(([name, skills], i) => ({
    id: `${b.id}-S${i + 1}`,
    branch_id: b.id,
    name,
    pin: `${n}${n}0${i + 1}`,
    role: "STAFF",
    skills,
    primary_skill: skills[0],
  }));
  return [manager, ...counterStaff];
});

/** Each counter staff member has a home counter (number = staff index). One extra spare counter per branch. */
export interface CounterSeed {
  id: string;
  branch_id: string;
  number: number;
  staff_id: string | null;
  mode_skill: Skill | null;
}

export const COUNTERS: CounterSeed[] = BRANCHES.flatMap((b) => {
  const staff = STAFF.filter((s) => s.branch_id === b.id && s.role === "STAFF");
  const assigned = staff.map((s, i) => ({
    id: `${b.id}-C${i + 1}`,
    branch_id: b.id,
    number: i + 1,
    staff_id: s.id,
    mode_skill: s.primary_skill,
  }));
  const spareNo = staff.length + 1;
  return [...assigned, { id: `${b.id}-C${spareNo}`, branch_id: b.id, number: spareNo, staff_id: null, mode_skill: null }];
});

export function getBranch(id: string): Branch | undefined {
  return BRANCHES.find((b) => b.id === id);
}

export const CATEGORY_LABEL: Record<Category, string> = {
  QUICK: "Quick (≤5 min)",
  STANDARD: "Standard (5–15 min)",
  COMPLEX: "Complex (15+ min)",
};
