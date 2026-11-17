import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { createInternalMarker, verifyInternalMarker, MAX_AGE_S } from "../internal-marker.ts";

const SECRET = "secret-for-tests-3c1f";
const HOST = "eleviq.solutions";
const T0 = new Date("2026-11-17T14:00:00Z");
const at = (s: number) => new Date(T0.getTime() + s * 1000);

test("a fresh marker for the host verifies", async () => {
  const m = await createInternalMarker(SECRET, HOST, T0);
  assert.match(m, /^v1\.\d+\.[0-9a-f]{64}$/);
  assert.equal(await verifyInternalMarker(m, SECRET, HOST, T0), true);
  assert.equal(await verifyInternalMarker(m, SECRET, "ELEVIQ.solutions", T0), true, "host is case-insensitive");
});

test("the marker never contains the secret", async () => {
  const m = await createInternalMarker(SECRET, HOST, T0);
  assert.ok(!m.includes(SECRET));
});

test("accepted within the window either side, rejected outside", async () => {
  const m = await createInternalMarker(SECRET, HOST, T0);
  assert.equal(await verifyInternalMarker(m, SECRET, HOST, at(MAX_AGE_S)), true);
  assert.equal(await verifyInternalMarker(m, SECRET, HOST, at(-MAX_AGE_S)), true, "tool clock ahead of the Worker");
  assert.equal(await verifyInternalMarker(m, SECRET, HOST, at(MAX_AGE_S + 1)), false);
  assert.equal(await verifyInternalMarker(m, SECRET, HOST, at(-MAX_AGE_S - 1)), false);
});

test("wrong secret, other host, tampered parts are rejected", async () => {
  const m = await createInternalMarker(SECRET, HOST, T0);
  assert.equal(await verifyInternalMarker(m, SECRET + "x", HOST, T0), false);
  assert.equal(await verifyInternalMarker(m, SECRET, "agents.eleviq.solutions", T0), false);
  const [v, ts, mac] = m.split(".");
  assert.equal(await verifyInternalMarker(`${v}.${Number(ts) + 1}.${mac}`, SECRET, HOST, T0), false);
  const flipped = mac.slice(0, -1) + (mac.endsWith("0") ? "1" : "0");
  assert.equal(await verifyInternalMarker(`${v}.${ts}.${flipped}`, SECRET, HOST, T0), false);
  assert.equal(await verifyInternalMarker(`v2.${ts}.${mac}`, SECRET, HOST, T0), false);
});

test("missing or malformed input is rejected, never throws", async () => {
  for (const h of [null, undefined, "", SECRET, "v1", "v1..", "v1.abc.def", `v1.${T0.getTime() / 1000}.zz`, "v1.1.2.3"]) {
    assert.equal(await verifyInternalMarker(h, SECRET, HOST, T0), false, String(h));
  }
  const m = await createInternalMarker(SECRET, HOST, T0);
  assert.equal(await verifyInternalMarker(m, undefined, HOST, T0), false, "secret unset");
  assert.equal(await verifyInternalMarker(m, "", HOST, T0), false);
});

test("the raw secret sent as the header is rejected (old scheme)", async () => {
  assert.equal(await verifyInternalMarker(SECRET, SECRET, HOST, T0), false);
});

test("matches an independent HMAC computation (the Python tools' formula)", async () => {
  const ts = Math.floor(T0.getTime() / 1000);
  const mac = createHmac("sha256", SECRET).update(`v1.${ts}.${HOST}`).digest("hex");
  assert.equal(await createInternalMarker(SECRET, HOST, T0), `v1.${ts}.${mac}`);
});
