// Demo bank-holiday calendar (Karnataka-style). Dates of lunar festivals are approximate — demo data only.
// Banks are also closed on Sundays and the 2nd & 4th Saturdays (see lib/engine/calendar.ts).

export const HOLIDAYS: { date: string; name: string }[] = [
  { date: "2026-05-01", name: "May Day" },
  { date: "2026-06-26", name: "Muharram" },
  { date: "2026-08-15", name: "Independence Day" },
  { date: "2026-08-26", name: "Id-e-Milad" },
  { date: "2026-09-04", name: "Janmashtami" },
  { date: "2026-09-14", name: "Ganesh Chaturthi" },
  { date: "2026-10-02", name: "Gandhi Jayanti" },
  { date: "2026-10-20", name: "Vijayadashami" },
  { date: "2026-11-01", name: "Kannada Rajyotsava" },
  { date: "2026-11-09", name: "Deepavali" },
  { date: "2026-12-25", name: "Christmas" },
  { date: "2027-01-01", name: "New Year" },
  { date: "2027-01-15", name: "Makara Sankranti" },
  { date: "2027-01-26", name: "Republic Day" },
];

export const HOLIDAY_SET = new Set(HOLIDAYS.map((h) => h.date));
