import assert from "node:assert/strict";
import test from "node:test";
import { formatEffectiveReferenceOhms, formatFileReferenceOhms } from "../impedanceDisplay";

test("formats a shared file reference impedance compactly", () => {
  assert.equal(formatFileReferenceOhms([50, 50]), "File Z0: 50 Ohm");
});

test("formats mixed file reference impedances per port", () => {
  assert.equal(formatFileReferenceOhms([50, 75, 50]), "File Z0: P1 50, P2 75, P3 50 Ohm");
});

test("formats the active effective impedance state", () => {
  assert.equal(formatEffectiveReferenceOhms([75, 50]), "Active Z0: P1 75, P2 50 Ohm");
});
