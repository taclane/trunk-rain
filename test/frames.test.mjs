// The rain's reading of the recorder's `voice` messages: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { fromChunk, glyphsOf, glyphSet, isBad, hueOf, brightness, shown, level, ripen, stack, HEX } from "../interface/frames.js";

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

test("the trail dims linearly from the head", () => {
  assert.deepEqual([0, 5, 10, 15, 20].map((d) => brightness(d, 20)), [1, 0.75, 0.5, 0.25, 0]);
  assert.equal(brightness(30, 20), 0);
  assert.deepEqual([0, 0.19, 0.2, 0.99, 1].map((b) => level(b, 5)), [0, 0, 1, 4, 4]);
  assert.deepEqual([0, 0.4, 1].map(shown), [0, 0, 1]);
  const mid = [0.6, 0.7, 0.8].map(shown);
  assert.ok(Math.abs(mid[1] - mid[0] - (mid[2] - mid[1])) < 1e-9, "linear between");
});

test("a cell's glyph changes as it comes of age", () => {
  const ages = Float32Array.from([0.9, 0.5]);
  assert.equal(ripen(ages, 0, 2, 0.06), true); // +0.12
  assert.ok(Math.abs(ages[0] - 0.02) < 1e-6);
  assert.equal(ripen(ages, 1, 2, 0.06), false);
  assert.equal(ripen(ages, 1, 0, 10), false, "rate 0: never");
});

test("stacked frames keep each glyph's own hue and errors", () => {
  const s = stack([{ glyphs: [1, 2], hue: 135, errs: 0 }, { glyphs: [3], hue: -1, errs: 4 }]);
  assert.deepEqual(s, { glyphs: [1, 2, 3], hues: [135, 135, -1], errs: [0, 0, 4] });
});

import { ccShown, ccNibbles, nibbleGlyphs, ccTalkgroup, KANA } from "../interface/frames.js";

test("control channel lines: which ones fall", () => {
  const line = (kind, extra = {}) => ({ timeS: 1, kind, text: "", system: "CLMRN", site: "clmrn-G", ...extra });
  assert.ok(ccShown(line("grant"), "activity") && ccShown(line("grant"), "all"));
  assert.ok(!ccShown(line("sysid"), "activity") && ccShown(line("sysid"), "all"));
  assert.ok(ccShown(line("unknown"), "all"));
  assert.ok(!ccShown(line("grant"), "off"));
  assert.ok(!ccShown(line("info"), "all"), "the recorder's own");
  assert.ok(!ccShown(line("grant", { level: "info" }), "all"), "a recorder line with a level");
  assert.ok(!ccShown({ kind: "grant", text: "" }, "all"), "no system");
});

test("a message's numbers become nibbles", () => {
  const hex = (t) => ccNibbles(t).map((n) => n.toString(16)).join("");
  assert.equal(hex("Grant TG 11501 771.35625 MHz src 154297 slot 0 ENC"), (11501).toString(16) + (77135625).toString(16) + (154297).toString(16) + "0");
  assert.equal(hex("Opcode 0x09 mfid 0x90"), "0990");
  assert.equal(hex("Deregistration 1891034"), (1891034).toString(16));
  assert.equal(ccNibbles("no numbers").length, 0);
  assert.equal(ccNibbles("1".repeat(80)).length, 24, "capped");
  assert.deepEqual(nibbleGlyphs([0xa, 0x3], "bits"), [1, 0, 1, 0, 0, 0, 1, 1]);
  assert.deepEqual(nibbleGlyphs([0xa], "hex"), [0xa]);
  assert.equal(ccTalkgroup("Grant TG 11501 771.35625 MHz"), 11501);
  assert.equal(ccTalkgroup("Deregistration 1891034"), null);
});

test("kana: 64 glyphs of six bits, with digits and symbols", () => {
  assert.equal([...KANA].length, 64);
  assert.ok(/[0-9]/.test(KANA) && KANA.includes(":"));
  const bits = fromChunk(chunk).frames[0].bits;
  const g = glyphsOf(bits, "imbe", "kana");
  assert.equal(g.length, 15); // 88 bits
  assert.equal(g[0], 0x19 >> 2); // 000110|01…
  assert.ok(g.every((x) => x < 64));
  assert.deepEqual(nibbleGlyphs([0xf, 0xf, 0xf], "kana"), [63, 63]);
});
