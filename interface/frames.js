// What the rain makes of the recorder's `voice` messages: no DOM here, so
// the tests can run it in Node.

export const HEX = "0123456789ABCDEF";
// Half-width katakana, one per nibble, drawn mirrored.
export const KANA = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀ";
export const BITS = "01";

/** The glyphs of a style: "hex", "kana" or "bits". */
export const glyphSet = (style) => (style === "kana" ? KANA : style === "bits" ? BITS : HEX);

/** Information bits in a frame of `codec`: IMBE 88, AMBE+2 49. */
export const frameBits = (codec) => (codec === "imbe" ? 88 : 49);

/**
 * A `voice` message's chunk as the rain takes it: one codec, and each
 * frame's bits as bytes.
 */
export function fromChunk(c) {
  const bytes = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
  return {
    callId: c.call_id,
    system: c.system,
    talkgroup: c.talkgroup,
    unit: c.unit,
    decrypted: c.decrypted,
    codec: c.frames[0]?.codec ?? "imbe",
    frames: c.frames.map((f) => ({ kind: f.kind, lost: f.erased, errors: f.errs, bits: bytes(f.bits) })),
  };
}

/** Not played as sent: repeated, muted, an erasure, or lost (a tone frame plays as its tone). */
export const isBad = (f) => f.lost || f.kind === "repeat" || f.kind === "muted" || f.kind === "erasure";

/** A frame's information bits as glyph indices: nibbles ("hex", "kana") or single bits ("bits"). */
export function glyphsOf(bytes, codec, style) {
  const nbits = frameBits(codec);
  const out = [];
  if (style === "bits") {
    for (let i = 0; i < nbits; i++) out.push((bytes[i >> 3] >> (7 - (i & 7))) & 1);
  } else {
    for (let i = 0; i < Math.ceil(nbits / 4); i++) out.push(i & 1 ? bytes[i >> 1] & 15 : bytes[i >> 1] >> 4);
  }
  return out;
}

/**
 * A hue for talkgroup or radio `id` of system `system`, degrees: a golden
 * angle (137.5°) apart for each step, so neighbouring numbers, often one
 * agency's, still get colours far apart.
 */
export const hueOf = (system, id) => (((id + system * 0.381966) * 137.50776) % 360 + 360) % 360;

/**
 * A trail glyph's brightness, 1 at the head down to 0 at `fade` rows behind
 * it: linear, as a sawtooth falls.
 */
export const brightness = (dist, fade) => Math.max(0, 1 - dist / fade);

/**
 * What a cell's brightness shows as: contrast 1.1 and an offset of -0.45, so
 * the dimmer part of a trail is dark and only the part near the head glows
 * (still linear in between).
 */
export const shown = (b) => Math.max(0, Math.min(1, (b * 1.1 - 0.45) / 0.65));

/** Brightness 0–1 as one of `levels` palette steps (0: darkest). */
export const level = (b, levels) => Math.min(levels - 1, Math.floor(b * levels));

/**
 * Cell `i`'s age moves on by `rate` changes a second; true when it comes of
 * age (passes 1): its glyph changes, and it starts again.
 */
export function ripen(ages, i, rate, dt) {
  ages[i] += rate * dt;
  if (ages[i] < 1) return false;
  ages[i] %= 1;
  return true;
}

/**
 * Frames stacked into one streak: their glyphs end to end, each glyph with
 * its own frame's hue and bit errors.
 */
export function stack(parts) {
  const glyphs = [], hues = [], errs = [];
  for (const p of parts) {
    for (const gl of p.glyphs) {
      glyphs.push(gl);
      hues.push(p.hue);
      errs.push(p.errs);
    }
  }
  return { glyphs, hues, errs };
}
