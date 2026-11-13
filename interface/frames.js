// What the rain makes of the recorder's `voice` messages: no DOM here, so
// the tests can run it in Node.

export const HEX = "0123456789ABCDEF";
// 64 glyphs, six bits each, drawn mirrored: half-width katakana, the digits
// and a few symbols, all in an ordinary font.
export const KANA = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛ" + "0123456789" + ':.=*+-<>¦|"';
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

/** Bits each glyph of a style shows: hex 4, kana 6, bits 1. */
export const glyphBits = (style) => (style === "kana" ? 6 : style === "bits" ? 1 : 4);

/** Bits (0 / 1) as glyph indices, `width` bits a glyph, the last zero-padded. */
export function chunkBits(bits, width) {
  const out = [];
  for (let i = 0; i < bits.length; i += width) {
    let v = 0;
    for (let j = 0; j < width; j++) v = (v << 1) | (bits[i + j] ?? 0);
    out.push(v);
  }
  return out;
}

/** A frame's information bits as glyph indices, as many bits a glyph as its style shows. */
export function glyphsOf(bytes, codec, style) {
  const nbits = frameBits(codec);
  const bits = Array.from({ length: nbits }, (_, i) => (bytes[i >> 3] >> (7 - (i & 7))) & 1);
  return chunkBits(bits, glyphBits(style));
}

/**
 * A hue for talkgroup or radio `id` of system `system`, degrees: a golden
 * angle (137.5°) apart for each step, so neighbouring numbers, often one
 * agency's, still get colours far apart. Never red (25°–335° only): red is
 * a damaged frame's.
 */
export const hueOf = (system, id) => 25 + ((((id + system * 0.381966) * 137.50776) % 360 + 360) % 360) * (310 / 360);

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

// ---- the control channel, as the `log` topic gives it ----

/** Control channel message kinds that are radios and calls: grants, updates, units, patches. */
export const ACTIVITY = new Set([
  "grant", "uu_v_grant", "phone_grant", "data_grant", "deny", "queued", "uu_ans_req",
  "update", "uu_v_update", "phone_update",
  "registration", "deregistration", "affiliation", "location", "acknowledge", "call_alert", "status_update", "message_update", "emergency_alarm",
  "patch_add", "patch_delete",
]);
// The recorder's own lines and notes, not the control channel's.
const NOT_CC = new Set(["info", "plugin", "note", "error", "warning", "alias"]);

/**
 * Whether a log line is a control channel message the rain shows: `mode`
 * "all" (every message heard, site broadcasts and undecoded ones too),
 * "activity" (grants, updates, units, patches) or "off".
 */
export function ccShown(line, mode) {
  if (mode === "off" || !line.system || line.level || NOT_CC.has(line.kind)) return false;
  return mode === "all" || ACTIVITY.has(line.kind);
}

/**
 * A control channel message's numbers as hex nibbles: its talkgroups,
 * radios, frequencies (the decimal point dropped) and hex fields, in order,
 * at most `max`.
 */
export function ccNibbles(text, max = 24) {
  const out = [];
  for (const m of text.matchAll(/0x([0-9a-f]+)|(\d+(?:\.\d+)?)/gi)) {
    const hex = m[1] ?? BigInt(m[2].replace(".", "")).toString(16);
    for (const c of hex) out.push(parseInt(c, 16));
  }
  return out.slice(0, max);
}

/** Nibbles as glyph indices in a style: regrouped into its bits a glyph. */
export function nibbleGlyphs(nibbles, style) {
  return chunkBits(nibbles.flatMap((n) => [n >> 3, (n >> 2) & 1, (n >> 1) & 1, n & 1]), glyphBits(style));
}

/** The talkgroup a control channel message names, if any ("TG 301"). */
export function ccTalkgroup(text) {
  const m = /\bTG (\d+)/.exec(text);
  return m ? Number(m[1]) : null;
}
