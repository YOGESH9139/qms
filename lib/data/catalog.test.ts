import { describe, expect, it } from "vitest";

import { BRANCHES, COUNTERS, STAFF } from "./branches";
import { SERVICES, TOP_SERVICE_IDS } from "./catalog";
import { PROFILES, serviceWeights } from "./profiles";

describe("service catalog", () => {
  it("has the 18 services from section 4", () => {
    expect(SERVICES).toHaveLength(18);
    expect(new Set(SERVICES.map((s) => s.id)).size).toBe(18);
  });

  it.each(SERVICES.map((s) => [s.id, s] as const))("%s is complete", (_id, s) => {
    expect(s.documents.length).toBeGreaterThan(0);
    expect(s.keywords.length).toBeGreaterThanOrEqual(5);
    expect(s.name_hi).toBeTruthy();
    if (s.digital_possible) {
      expect(s.digital_steps.length).toBeGreaterThanOrEqual(3);
      expect(s.digital_link).toMatch(/^https:\/\//);
      expect(s.digital_minutes).toBeGreaterThan(0);
    } else {
      expect(s.digital_level).toBe("NONE");
    }
    if (s.skill === "LOANS") expect(s.category).toBe("COMPLEX");
  });

  it("never asks for sensitive identifiers as input", () => {
    const text = JSON.stringify(SERVICES).toLowerCase();
    expect(text).not.toMatch(/enter (your )?(aadhaar|pan|card) number/);
  });

  it("top chips reference real services", () => {
    for (const id of TOP_SERVICE_IDS) expect(SERVICES.some((s) => s.id === id)).toBe(true);
  });
});

describe("branches and staff", () => {
  it("has 5 branches with 5–7 counter staff and every skill covered", () => {
    expect(BRANCHES).toHaveLength(5);
    for (const b of BRANCHES) {
      const staff = STAFF.filter((s) => s.branch_id === b.id && s.role === "STAFF");
      expect(staff.length).toBeGreaterThanOrEqual(5);
      expect(staff.length).toBeLessThanOrEqual(7);
      for (const skill of ["QUICK", "STANDARD", "COMPLEX", "LOANS"] as const) {
        expect(staff.filter((s) => s.skills.includes(skill)).length).toBeGreaterThanOrEqual(2);
      }
      expect(STAFF.filter((s) => s.branch_id === b.id && s.role === "MANAGER")).toHaveLength(1);
      expect(COUNTERS.filter((c) => c.branch_id === b.id)).toHaveLength(staff.length + 1);
    }
  });

  it("uses unique PINs", () => {
    expect(new Set(STAFF.map((s) => s.pin)).size).toBe(STAFF.length);
  });

  it("profiles only reference catalog services", () => {
    for (const p of Object.values(PROFILES)) {
      for (const cat of ["QUICK", "STANDARD", "COMPLEX"] as const) {
        for (const id of Object.keys(serviceWeights(p, cat))) {
          expect(SERVICES.find((s) => s.id === id)?.category).toBe(cat);
        }
      }
      expect(p.hourCurve.length).toBeGreaterThan(0);
    }
  });
});
