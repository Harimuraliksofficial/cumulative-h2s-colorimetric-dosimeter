export const MOCK_SHIFT_HISTORY = [
  { date: "2026-09-23", exposure: 2.1, time: "07:45", status: "NORMAL" },
  { date: "2026-09-24", exposure: 3.4, time: "08:00", status: "NORMAL" },
  { date: "2026-09-25", exposure: 5.8, time: "08:15", status: "ADVISORY" },
  { date: "2026-09-26", exposure: 1.9, time: "07:30", status: "NORMAL" },
  { date: "2026-09-27", exposure: 4.2, time: "08:00", status: "NORMAL" },
  { date: "2026-09-28", exposure: 8.9, time: "08:30", status: "WARNING" },
  { date: "2026-09-29", exposure: 3.1, time: "07:50", status: "NORMAL" }
];

export const MOCK_ACTIVE_STRIP = {
  batchId: "MRPL-H2S-2026-09",
  chemistry: "Bi(NO3)3 + Chitosan-PVA",
  mfgDate: "2026-08-15",
  expiryDate: "2027-02-15",
  sensitivityRange: "0.5 - 50.0 ppm·h",
  moistureStatus: "DRY_PASS"
};
