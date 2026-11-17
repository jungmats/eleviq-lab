import assert from "node:assert/strict";
import { test } from "node:test";
import { dayRange, isPartialMonth, monthRange, pivot, segmentHeight } from "../public/chart-data.js";

test("a small count keeps a visible segment on a tall bar", () => {
  assert.equal(segmentHeight(67, 4445, 112, 2), 2);
  assert.equal(segmentHeight(1, 330, 182, 2), 2);
});

test("a large count is scaled to the axis, less the gap", () => {
  assert.equal(segmentHeight(2000, 4000, 100, 2), 48);
});

test("dayRange includes both ends and crosses month and year boundaries", () => {
  assert.deepEqual(dayRange("2026-12-30", "2027-01-02"), ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
});

test("dayRange handles a single day and a leap day", () => {
  assert.deepEqual(dayRange("2026-11-02", "2026-11-02"), ["2026-11-02"]);
  assert.deepEqual(dayRange("2028-02-28", "2028-03-01"), ["2028-02-28", "2028-02-29", "2028-03-01"]);
});

test("a 30-day window has 30 days across a daylight-saving change", () => {
  assert.equal(dayRange("2026-10-04", "2026-11-02").length, 30);
});

test("monthRange spans whole months, including a year change", () => {
  assert.deepEqual(monthRange("2026-09-11", "2026-11-02"), ["2026-09", "2026-10", "2026-11"]);
  assert.deepEqual(monthRange("2026-12-31", "2027-01-01"), ["2026-12", "2027-01"]);
  assert.deepEqual(monthRange("2026-11-01", "2026-11-30"), ["2026-11"]);
});

test("monthRange does not skip a month when starting on the 31st", () => {
  assert.deepEqual(monthRange("2026-01-31", "2026-03-02"), ["2026-01", "2026-02", "2026-03"]);
});

test("pivot fills periods without visits with zeros, in period order", () => {
  const rows = [
    { day: "2026-11-02", key: "people", n: 5 },
    { day: "2026-11-02", key: "ai-assistant", n: 1 },
  ];
  assert.deepEqual(pivot(rows, "day", ["2026-11-01", "2026-11-02"], ["people", "ai-assistant"]), [
    { period: "2026-11-01", counts: { people: 0, "ai-assistant": 0 } },
    { period: "2026-11-02", counts: { people: 5, "ai-assistant": 1 } },
  ]);
});

test("pivot ignores periods and categories that have no bar", () => {
  const rows = [
    { month: "2026-08", key: "people", n: 9 },
    { month: "2026-09", key: "unlisted", n: 4 },
  ];
  assert.deepEqual(pivot(rows, "month", ["2026-09"], ["people"]), [{ period: "2026-09", counts: { people: 0 } }]);
});

test("pivot adds up repeated keys in one period (e.g. evidence levels)", () => {
  const rows = [
    { month: "2026-11", key: "declared", n: 2 },
    { month: "2026-11", key: "declared", n: 3 },
    { month: "2026-11", key: "verified", n: 1 },
  ];
  assert.deepEqual(pivot(rows, "month", ["2026-11"], ["verified", "declared"]), [
    { period: "2026-11", counts: { verified: 1, declared: 5 } },
  ]);
});

test("the first month is partial only if logging started after the 1st", () => {
  assert.equal(isPartialMonth("2026-09", "2026-09-11", "2026-11-02"), true);
  assert.equal(isPartialMonth("2026-09", "2026-09-01", "2026-11-02"), false);
});

test("the running month is partial, full months between are not", () => {
  assert.equal(isPartialMonth("2026-11", "2026-09-11", "2026-11-02"), true);
  assert.equal(isPartialMonth("2026-10", "2026-09-11", "2026-11-02"), false);
});
