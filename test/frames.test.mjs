// The rain's reading of the recorder's `voice` messages: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { fromChunk, glyphsOf, glyphSet, isBad, hueOf, HEX } from "../interface/frames.js";

// A chunk as the recorder sends it (the `voice` plugin topic's).
const chunk = {
  call_id: 4, system: 1, short_name: "dcfd", talkgroup: 101, unit: 1234, unit_name: "E1", decrypted: false,
  frames: [
    { codec: "imbe", bits: "190e6391f8f002ad5136b2", e0: 0, errs: 2, erased: false, kind: "voice" },
    { codec: "imbe", bits: "190e6391f8f002ad5136b2", e0: 0, errs: 0, erased: false, kind: "repeat" },
  ],
};

test("a chunk becomes the call, its codec and each frame's bytes", () => {
  const v = fromChunk(chunk);
  assert.deepEqual([v.callId, v.system, v.talkgroup, v.unit, v.codec], [4, 1, 101, 1234, "imbe"]);
  assert.equal(v.frames.length, 2);
  assert.equal(v.frames[0].bits.length, 11);
  assert.deepEqual([v.frames[0].errors, v.frames[1].kind], [2, "repeat"]);
});

test("hex glyphs spell the frame's hex", () => {
  const v = fromChunk(chunk);
  const glyphs = glyphsOf(v.frames[0].bits, "imbe", "hex");
  assert.equal(glyphs.map((g) => HEX[g]).join(""), "190E6391F8F002AD5136B2");
});

test("AMBE+2: 13 nibbles or 49 bits", () => {
  const bits = fromChunk({ ...chunk, frames: [{ codec: "ambe", bits: "f801a99f8ce080", e0: 0, errs: 0, erased: false, kind: "voice" }] }).frames[0].bits;
  assert.equal(glyphsOf(bits, "ambe", "hex").length, 13);
  const one = glyphsOf(bits, "ambe", "bits");
  assert.equal(one.length, 49);
  assert.equal(one.slice(0, 8).join(""), "11111000");
});

test("every glyph index is in its set", () => {
  const bits = fromChunk(chunk).frames[0].bits;
  for (const style of ["hex", "kana", "bits"]) {
    assert.ok(glyphsOf(bits, "imbe", style).every((g) => g < glyphSet(style).length), style);
  }
});

test("damaged frames: repeated, muted, erasures and lost ones, not tones", () => {
  const f = (kind, lost = false) => ({ kind, lost });
  assert.deepEqual(["voice", "tone", "repeat", "muted", "erasure"].map((k) => isBad(f(k))), [false, false, true, true, true]);
  assert.ok(isBad(f("voice", true)));
});

test("neighbouring talkgroups get colours far apart", () => {
  const gap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  const hues = [100, 101, 102, 103, 104, 105].map((tg) => hueOf(0, tg));
  for (let i = 0; i < hues.length; i++) for (let j = i + 1; j < hues.length; j++) assert.ok(gap(hues[i], hues[j]) >= 30, `${100 + i} and ${100 + j}`);
  assert.ok(hues.every((h) => h >= 0 && h < 360));
  assert.notEqual(hueOf(0, 101), hueOf(1, 101), "another system's 101");
});
