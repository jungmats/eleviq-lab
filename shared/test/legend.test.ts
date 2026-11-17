import assert from "node:assert/strict";
import { test } from "node:test";
import { LEGENDS } from "../index.ts";

function shape(value: unknown, path = ""): string[] {
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => shape(v, `${path}/${k}`));
  }
  return [path];
}

function leaves(value: unknown): unknown[] {
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(leaves);
  return [value];
}

test("EN and FR legends have identical keys", () => {
  assert.deepEqual(shape(LEGENDS.fr).sort(), shape(LEGENDS.en).sort());
});

test("every legend value is a non-empty string", () => {
  for (const lang of ["en", "fr"] as const) {
    for (const v of leaves(LEGENDS[lang])) assert.ok(typeof v === "string" && v.trim().length > 0, `${lang}: ${String(v)}`);
  }
});

test("all eight §5.8 texts exist", () => {
  assert.deepEqual(Object.keys(LEGENDS.en.texts).sort(), [
    "TXT-ATTESTED", "TXT-CONTRADICTED", "TXT-DECLARED", "TXT-LIMITS",
    "TXT-PEOPLE", "TXT-SIG-INVALID", "TXT-SIG-UNCHECKED", "TXT-VERIFIED",
  ]);
});

test("labels exist for every kind, level, flag shown to clients and note", () => {
  assert.deepEqual(Object.keys(LEGENDS.en.kinds).sort(), ["ai-assistant", "ai-training", "other-bot", "people", "search", "unknown"]);
  assert.deepEqual(Object.keys(LEGENDS.en.levels).sort(), ["attested", "declared", "verified"]);
  assert.deepEqual(Object.keys(LEGENDS.en.flags).sort(), ["contradicted", "signature-invalid"]);
  assert.deepEqual(Object.keys(LEGENDS.en.notes), ["sig-unchecked"]);
});
