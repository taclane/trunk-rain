// Vocoder Rain: each 20 ms vocoder frame of live digital voice falls as one
// streak of its own bits. Frames come from the recorder's `listen` with
// `voice: true` (`voice` messages); see /api/docs#vocoder-frames.

import * as frames from "./frames.js";

const $ = (id) => document.getElementById(id);
const canvas = $("rain");
const g = canvas.getContext("2d");

// ---- settings (a convenience: the page works without storage) ----
const DEFAULTS = { tags: "both", tagEvery: "sec", color: "classic", glyphs: "hex", speed: 18, size: 16, bad: true, flicker: true, sound: false, tgFilter: "" };
const opts = { ...DEFAULTS };
try {
  Object.assign(opts, JSON.parse(localStorage.getItem("rain.opts") ?? "{}"));
} catch {}
// Any option in the address too (a wall display's): ?glyphs=kana&color=tg; not saved.
for (const [k, v] of new URLSearchParams(location.search)) {
  if (!(k in DEFAULTS)) continue;
  const d = DEFAULTS[k];
  opts[k] = typeof d === "number" ? Number(v) || d : typeof d === "boolean" ? v !== "0" && v !== "false" : v;
}
const save = () => {
  try {
    localStorage.setItem("rain.opts", JSON.stringify(opts));
  } catch {}
};

// ---- glyphs ----
const glyphSet = () => frames.glyphSet(opts.glyphs);

// ---- grid and atlases ----
/** Row `r` on screen: past the bottom it comes round to the top. */
const wrap = (r) => ((r % rows) + rows) % rows;
let dpr = 1, W = 0, H = 0, cw = 10, ch = 16, cols = 0, rows = 0;
const PAD = 6; // room for each glyph's glow in its atlas cell
let atlases = new Map();

function layout() {
  dpr = window.devicePixelRatio || 1;
  W = innerWidth;
  H = innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  cw = Math.ceil(opts.size * 0.72);
  ch = Math.ceil(opts.size * 1.12);
  cols = Math.max(1, Math.floor(W / cw));
  rows = Math.max(1, Math.ceil(H / ch));
  atlases = new Map();
  for (const d of drops) d.col %= cols;
}

/** Every glyph of the current set in `css`, glowing, for drawImage. */
function atlas(css, glow) {
  const key = `${css}|${glow}|${opts.glyphs}`;
  let a = atlases.get(key);
  if (a) return a;
  const set = glyphSet();
  const cellW = cw + PAD * 2, cellH = ch + PAD * 2;
  a = document.createElement("canvas");
  a.width = Math.ceil(cellW * set.length * dpr);
  a.height = Math.ceil(cellH * dpr);
  const c = a.getContext("2d");
  c.scale(dpr, dpr);
  c.font = `${opts.size}px ui-monospace, "DejaVu Sans Mono", "Noto Sans Mono CJK JP", monospace`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillStyle = css;
  c.shadowColor = glow;
  c.shadowBlur = opts.size * 0.5;
  for (let i = 0; i < set.length; i++) {
    c.save();
    c.translate(i * cellW + cellW / 2, cellH / 2);
    if (opts.glyphs === "kana") c.scale(-1, 1);
    c.fillText(set[i], 0, 0);
    c.restore();
  }
  a.cellW = cellW;
  a.cellH = cellH;
  atlases.set(key, a);
  return a;
}

// ---- colour ----
function hueOf(v) {
  switch (opts.color) {
    case "tg": return frames.hueOf(v.system, v.talkgroup);
    case "unit": return v.unit ? frames.hueOf(v.system, v.unit) : 135;
    case "codec": return v.codec === "imbe" ? 135 : 185;
    default: return 135;
  }
}

// ---- drops: one a frame ----
const drops = [];
const MAX_DROPS = 1800;
const colFreeAt = []; // a column's last drop has left room for another (ms)

function pickCol(now, len) {
  let best = 0, bestT = Infinity;
  for (let i = 0; i < 10; i++) {
    const c = (Math.random() * cols) | 0;
    const t = colFreeAt[c] ?? 0;
    if (t <= now) return c;
    if (t < bestT) [best, bestT] = [c, t];
  }
  return best;
}

function spawn(v, f, tag, now) {
  if (drops.length >= MAX_DROPS) drops.splice(0, drops.length - MAX_DROPS + 1);
  const glyphs = frames.glyphsOf(f.bits, v.codec, opts.glyphs);
  const len = glyphs.length;
  const speed = opts.speed * (0.75 + Math.random() * 0.5); // rows a second
  const col = pickCol(now, len);
  // Anywhere: a streak that crosses the bottom carries on from the top.
  const r0 = Math.floor(Math.random() * rows);
  // The next drop in this column waits until this one's head is well down.
  colFreeAt[col] = now + ((len + 4) / speed) * 1000;
  const bad = frames.isBad(f);
  drops.push({ col, r0, y: r0, glyphs, len, speed, fade: Math.max(len, 12) * 1.3, hue: hueOf(v), bad, errs: f.errors, tag });
}

// ---- incoming frames: spread over time as they were spoken ----
// The page's clock, ms: performance.now(), moved ahead by ?warm.
let ahead = 0;
const clock = () => performance.now() + ahead;

const queue = []; // { at, v, f, tag }
const lastAt = new Map(); // call id → when its last queued frame plays (ms)
const runs = new Map(); // call id → { unit, start, lastTag }
let framesSeen = 0, lastFrameAt = 0;

function tagFor(v, now) {
  if (opts.tags === "off") return null;
  const run = runs.get(v.callId);
  const fresh = !run || run.unit !== v.unit || now - run.seen > 1500;
  if (fresh) runs.set(v.callId, { unit: v.unit, seen: now, lastTag: -Infinity });
  const r = runs.get(v.callId);
  r.seen = now;
  const due = opts.tagEvery === "drop" || fresh || (opts.tagEvery === "sec" && now - r.lastTag >= 1000);
  if (!due) return null;
  r.lastTag = now;
  const parts = [];
  if (opts.tags !== "unit") parts.push(names.talkgroup(v));
  if (opts.tags !== "tg") parts.push(names.unit(v));
  return parts.filter(Boolean).join(" · ");
}

function onVoice(v) {
  if (!passes(v)) return;
  const now = clock();
  let at = Math.max(now, lastAt.get(v.callId) ?? 0);
  if (at - now > 500) at = now; // fell behind: catch up
  for (const f of v.frames) {
    queue.push({ at, v, f });
    at += 20;
  }
  lastAt.set(v.callId, at);
}

function passes(v) {
  const want = opts.tgFilter.trim();
  if (!want || /^\d+$/.test(want)) return true; // a number filters at the recorder
  return names.talkgroup(v).toLowerCase().includes(want.toLowerCase());
}

// ---- names (the recorder's, or the demo's) ----
let names = { talkgroup: (v) => `TG ${v.talkgroup}`, unit: (v) => (v.unit ? `${v.unit}` : "") };

// ---- drawing ----
let lastT = clock();
const TAG_FONT = () => `${Math.max(10, Math.round(opts.size * 0.72))}px ui-monospace, "DejaVu Sans Mono", monospace`;

function frame() {
  draw(clock());
  requestAnimationFrame(frame);
}

/** Frames due by `t` fall in; every drop moves on to `t`. */
function advance(t) {
  const dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  while (queue.length && queue[0].at <= t) {
    const q = queue.shift();
    spawn(q.v, q.f, tagFor(q.v, t), t);
    framesSeen++;
    lastFrameAt = t;
  }
  const set = glyphSet().length;
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.y += d.speed * dt;
    if (Math.floor(d.y) - (d.r0 + d.len - 1) > d.fade) {
      drops.splice(i, 1);
      continue;
    }
    if (opts.flicker && d.errs && Math.random() < d.errs * 0.03 * dt * 60) {
      d.glyphs[(Math.random() * d.len) | 0] = (Math.random() * set) | 0;
    }
  }
}

function draw(t) {
  advance(t);
  g.fillStyle = "#000";
  g.fillRect(0, 0, W, H);
  const set = glyphSet().length;
  const tags = [];
  for (const d of drops) {
    const head = Math.floor(d.y);
    const last = d.r0 + d.len - 1;
    const hue = d.bad && opts.bad ? 0 : d.hue;
    const body = atlas(`hsl(${hue} 95% ${d.bad && opts.bad ? 58 : 52}%)`, `hsl(${hue} 100% 45%)`);
    const lit = atlas(`hsl(${hue} 100% 92%)`, `hsl(${hue} 100% 70%)`);
    const x = d.col * cw;
    const top = Math.max(d.r0, head - Math.ceil(d.fade));
    for (let r = Math.min(head, last); r >= top; r--) {
      const k = r - d.r0;
      const dist = head - r;
      const a = dist === 0 ? lit : body;
      g.globalAlpha = dist === 0 ? 1 : Math.pow(Math.max(0, 1 - dist / d.fade), 1.6) * 0.95;
      if (g.globalAlpha <= 0.01) continue;
      const gi = d.glyphs[k] % set;
      g.drawImage(a, gi * a.cellW * dpr, 0, a.cellW * dpr, a.cellH * dpr, x - PAD, wrap(r) * ch - PAD, a.cellW, a.cellH);
    }
    if (d.tag && head <= last + d.fade * 0.6) {
      tags.push({ x: x + cw + 3, y: wrap(Math.min(head, last)) * ch, text: d.tag, hue: d.hue, alpha: head <= last ? 1 : 1 - (head - last) / (d.fade * 0.6) });
    }
  }
  g.globalAlpha = 1;

  // Tags ride their drop's head, over the rain.
  g.font = TAG_FONT();
  g.textBaseline = "top";
  for (const tg of tags) {
    const w = g.measureText(tg.text).width;
    const x = Math.min(tg.x, W - w - 6);
    g.globalAlpha = tg.alpha * 0.85;
    g.fillStyle = "#000";
    g.fillRect(x - 3, tg.y - 1, w + 6, opts.size * 0.95);
    g.globalAlpha = tg.alpha;
    g.fillStyle = `hsl(${opts.color === "classic" ? 135 : tg.hue} 100% 80%)`;
    g.fillText(tg.text, x, tg.y + 1);
  }
  g.globalAlpha = 1;
}

// ---- HUD and options ----
let status = () => "";
let fps = 0;
function hud() {
  fps = framesSeen;
  framesSeen = 0;
  const quiet = clock() - lastFrameAt > 8000;
  document.body.classList.toggle("quiet", quiet);
  $("hud").textContent = `${status()}${quiet ? "\nwaiting for digital voice…" : `\n${fps} frames/s · ${drops.length} falling`}`;
  if (quiet) $("hud").style.opacity = 1;
  else $("hud").style.opacity = "";
}
setInterval(hud, 1000);

let idleTimer;
const wake = () => {
  document.body.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!$("panel").classList.contains("open")) document.body.classList.add("idle");
  }, 3000);
};
for (const e of ["mousemove", "pointerdown", "keydown"]) addEventListener(e, wake);
wake();

$("gear").onclick = () => $("panel").classList.toggle("open");
let relisten = () => {};
let sound = { on() {}, off() {} };
for (const id of Object.keys(DEFAULTS)) {
  const el = $(id);
  if (el.type === "checkbox") el.checked = !!opts[id];
  else el.value = opts[id];
  el.addEventListener(el.type === "text" ? "change" : "input", () => {
    opts[id] = el.type === "checkbox" ? el.checked : el.type === "range" ? Number(el.value) : el.value;
    save();
    if (id === "size" || id === "glyphs") layout();
    if (id === "sound") opts.sound ? sound.on() : sound.off();
    if (id === "sound" || id === "tgFilter") relisten();
  });
}
addEventListener("resize", layout);

// ---- the source: the recorder, or ?demo ----
async function connect() {
  const client = await import("/api/client.js");
  const rec = new client.TrunkClient();
  const player = new client.LivePlayer();
  names = {
    talkgroup(v) {
      const short = client.systemName(rec.status, v.system);
      const row = short && rec.talkgroups(short).get(v.talkgroup);
      const live = rec.calls?.find((c) => c.id === v.callId);
      return row?.alphaTag || live?.alphaTag || `TG ${v.talkgroup}`;
    },
    unit(v) {
      if (!v.unit) return "";
      const short = client.systemName(rec.status, v.system);
      return (short && rec.unitName(short, v.unit)) || `${v.unit}`;
    },
  };
  relisten = () => {
    const want = opts.tgFilter.trim();
    rec.listen({ voice: true, audio: !!opts.sound, talkgroup: /^\d+$/.test(want) ? Number(want) : null });
  };
  sound = { on: () => player.resume(), off: () => {} };
  rec.on("voice", (m) => onVoice(frames.fromChunk(m.chunk)));
  rec.on("audio", (chunk) => opts.sound && player.play(chunk));
  status = () => (rec.connected ? `● ${rec.phase?.phase === "running" ? "recording" : rec.phase?.phase ?? "connected"}` : "○ connecting…");
  relisten();
  // Browsers play sound only after a click.
  if (opts.sound) addEventListener("pointerdown", () => player.resume(), { once: true });
}

function demo(warmS) {
  status = () => "◆ demo (no recorder)";
  const talkers = [];
  const aliases = ["FIRE DISP", "EMS 2", "PD NORTH", "DPW", "TAC 4", "MUTUAL AID"];
  const tick = () => {
    if (talkers.length < 3 && Math.random() < 0.35) {
      const i = (Math.random() * aliases.length) | 0;
      talkers.push({ callId: (Math.random() * 1e9) | 0, system: 0, talkgroup: 100 + i, unit: 4000 + ((Math.random() * 900) | 0), codec: Math.random() < 0.6 ? "imbe" : "ambe", alias: aliases[i], left: 40 + ((Math.random() * 200) | 0) });
    }
    for (const t of talkers) {
      const made = [];
      for (let k = 0; k < 9 && t.left > 0; k++, t.left--) {
        const bits = new Uint8Array(t.codec === "imbe" ? 11 : 7).map(() => (Math.random() * 256) | 0);
        const r = Math.random();
        made.push({ kind: r < 0.03 ? "repeat" : "voice", lost: r > 0.995, errors: r < 0.2 ? (Math.random() * 6) | 0 : 0, bits });
      }
      onVoice({ ...t, decrypted: false, frames: made });
    }
    for (let i = talkers.length - 1; i >= 0; i--) if (talkers[i].left <= 0) talkers.splice(i, 1);
  };
  names = { talkgroup: (v) => v.alias ?? `TG ${v.talkgroup}`, unit: (v) => `Unit ${v.unit}` };
  // ?warm=N: N seconds of it already fallen (for screenshots).
  for (let ms = 0; ms < warmS * 1000; ms += 20) {
    ahead += 20;
    if (ms % 180 === 0) tick();
    advance(clock());
  }
  if (warmS) {
    draw(clock());
    hud();
  }
  setInterval(tick, 180);
}

layout();
const params = new URLSearchParams(location.search);
if (params.has("demo")) demo(Number(params.get("warm")) || 0);
else connect().catch((e) => {
  console.warn("no recorder here, so the demo:", e);
  demo(0);
});
requestAnimationFrame(frame);
