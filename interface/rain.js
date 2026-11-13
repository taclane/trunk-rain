// Vocoder Rain: each 20 ms vocoder frame of live digital voice falls as one
// streak of its own bits. Frames come from the recorder's `listen` with
// `voice: true` (`voice` messages); see /api/docs#vocoder-frames.

import * as frames from "./frames.js";

const $ = (id) => document.getElementById(id);
const canvas = $("rain");
const g = canvas.getContext("2d");

// ---- settings (a convenience: the page works without storage) ----
const DEFAULTS = { tags: "both", tagEvery: "sec", color: "classic", glyphs: "hex", speed: 18, size: 16, change: "data", changeRate: 1.8, stack: 2, trail: 20, cc: "all", ccLevel: 0.15, bloom: true, bad: true, flicker: true, sound: false, system: "", tgFilter: "" };
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

// ---- the grid: one glyph a cell, as on a screen of characters ----
// Frames falling write their glyphs into the cells they pass; each cell then
// dims on its own, linearly, and its glyph changes now and then while lit.
/** Row `r` on screen: past the bottom it comes round to the top. */
const wrap = (r) => ((r % rows) + rows) % rows;
let dpr = 1, W = 0, H = 0, cw = 10, ch = 16, cols = 0, rows = 0;
const PAD = 6; // room for each glyph's glow in its atlas cell
let atlases = new Map();
// Each cell: its glyph, brightness (0–1) and how fast that falls (a second),
// hue (-1: a damaged frame's red), the age that changes its glyph, its
// frame's bit errors, and whose glyph it is (the call, its place in the frame).
// Two grids, two layers: the control channel's behind, the voice's on top.
// Neither knows of the other; a lit voice glyph covers what's behind it.
const grid = (n) => ({ glyph: new Uint8Array(n), bright: new Float32Array(n), decay: new Float32Array(n), hue: new Int16Array(n), age: new Float32Array(n), errs: new Uint8Array(n), call: new Float64Array(n), k: new Uint8Array(n) });
let cell = grid(0);
let ccCell = grid(0);

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
  const n = cols * rows;
  cell = grid(n);
  ccCell = grid(n);
  colSpeed = Float32Array.from({ length: cols }, () => 0.75 + Math.random() * 0.5);
  colFreeAt[0].length = colFreeAt[1].length = 0;
  for (const d of drops) d.col %= cols;
}

/** Palette steps, darkest to brightest: dark and saturated to pale. */
const LEVELS = 10;
function palette(hue, i) {
  const f = (i + 1) / LEVELS;
  return atlas(`hsl(${hue} ${100 - 30 * f * f}% ${4 + 56 * f}%)`, `hsl(${hue} 100% ${8 + 32 * f}%)`);
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

// ---- drops: one a frame, writing its glyphs as it falls ----
const drops = [];
const MAX_DROPS = 1800;
// Each column falls at a speed of its own, so drops sharing it keep their
// distance, and takes a new drop only once its last has finished writing:
// raindrops never collide. One set of columns a layer.
const colFreeAt = [[], []]; // [voice, control]: when each column is free (ms)
let colSpeed = new Float32Array(0);

function pickCol(now, layer) {
  const free = colFreeAt[layer];
  let best = 0, bestT = Infinity;
  const start = (Math.random() * cols) | 0;
  for (let i = 0; i < cols; i++) {
    const c = (start + i * 7919) % cols; // a scattered walk through every column
    const t = free[c] ?? 0;
    if (t <= now) return c;
    if (t < bestT) [best, bestT] = [c, t];
  }
  return best;
}

/** A streak of one or more of a talker's frames, end to end. */
function spawn(v, fs, tag, now) {
  if (drops.length >= MAX_DROPS) drops.splice(0, drops.length - MAX_DROPS + 1);
  const base = Math.round(hueOf(v) / 10) * 10;
  const { glyphs, hues, errs } = frames.stack(fs.map((f) => ({ glyphs: frames.glyphsOf(f.bits, v.codec, opts.glyphs), hue: frames.isBad(f) && opts.bad ? -1 : base, errs: f.errors })));
  const len = glyphs.length;
  const col = pickCol(now, 0);
  const speed = opts.speed * colSpeed[col]; // rows a second
  // Anywhere: a streak that crosses the bottom carries on from the top.
  const r0 = Math.floor(Math.random() * rows);
  // The next drop in this column waits until this one's head is well down.
  colFreeAt[0][col] = now + ((len + 2) / speed) * 1000;
  // Its trail is gone this many rows behind its head (the glow, about half of it).
  const fade = Math.max(4, opts.trail);
  drops.push({ col, r0, y: r0, laid: 0, glyphs, hues, errs, len, speed, decay: speed / fade, hue: base, call: v.callId, tag, doneAt: 0 });
  newest.set(v.callId, { glyphs, at: now });
}

// ---- the control channel: a layer of its own, behind the voice ----
// Its messages' numbers fall as glyphs too: slower, and as dim as `ccLevel`,
// background noise by default. Lines come in bursts; they fall evenly over
// the next second.
const CC = -1; // `newest`'s key for the newest control channel message
const ccQueue = [];
let ccSeen = 0;

function onLog(m) {
  for (const l of m.lines) {
    if (!frames.ccShown(l, opts.cc) || !ccPasses(l)) continue;
    ccQueue.push(l);
  }
  if (ccQueue.length > 600) ccQueue.splice(0, ccQueue.length - 600);
}

function ccPasses(l) {
  if (opts.system && l.system !== opts.system) return false;
  const want = opts.tgFilter.trim();
  if (!want) return true;
  const tg = frames.ccTalkgroup(l.text);
  if (tg == null) return false;
  if (/^\d+$/.test(want)) return tg === Number(want);
  return names.talkgroup({ system: names.systemIndex(l.system), talkgroup: tg }).toLowerCase().includes(want.toLowerCase());
}

function spawnCC(l, now) {
  const glyphs = frames.nibbleGlyphs(frames.ccNibbles(l.text), opts.glyphs);
  if (!glyphs.length) return;
  if (drops.length >= MAX_DROPS) drops.splice(0, drops.length - MAX_DROPS + 1);
  const tg = frames.ccTalkgroup(l.text);
  const hue = opts.color === "tg" && tg != null ? Math.round(frames.hueOf(names.systemIndex(l.system), tg) / 10) * 10 : 135;
  const len = glyphs.length;
  const col = pickCol(now, 1);
  const speed = opts.speed * 0.6 * colSpeed[col];
  colFreeAt[1][col] = now + ((len + 2) / speed) * 1000;
  const r0 = Math.floor(Math.random() * rows);
  drops.push({ cc: true, col, r0, y: r0, laid: 0, glyphs, hues: new Array(len).fill(hue), errs: new Array(len).fill(0), len, speed, decay: speed / Math.max(4, opts.trail), hue, call: CC, tag: null, doneAt: 0 });
  newest.set(CC, { glyphs, at: now });
  ccSeen++;
}

// Each call's newest frame, as glyphs: what its trails change to.
const newest = new Map();

// ---- incoming frames: spread over time as they were spoken ----
// The page's clock, ms: performance.now(), moved ahead by ?warm.
let ahead = 0;
const clock = () => performance.now() + ahead;

const queue = []; // { at, v, f }
const pending = new Map(); // call id → { v, fs, tag, at }: frames waiting to stack
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
  if (opts.system && names.systemName(v.system) !== opts.system) return false;
  const want = opts.tgFilter.trim();
  if (!want || /^\d+$/.test(want)) return true; // a number filters at the recorder
  return names.talkgroup(v).toLowerCase().includes(want.toLowerCase());
}

// ---- names (the recorder's, or the demo's) ----
let names = { talkgroup: (v) => `TG ${v.talkgroup}`, unit: (v) => (v.unit ? `${v.unit}` : ""), systemIndex: () => 0, systemName: () => "" };

/** The System menu: all systems, or one; kept as chosen while the list changes. */
let systemsShown = "";
function setSystems(list) {
  const key = list.join("\n");
  if (key === systemsShown) return;
  systemsShown = key;
  const el = $("system");
  const want = opts.system && !list.includes(opts.system) ? [...list, opts.system] : list;
  el.replaceChildren(new Option("all systems", ""), ...want.map((n) => new Option(n, n)));
  el.value = opts.system;
}

// ---- drawing ----
let lastT = clock();
const bloom = document.createElement("canvas");
const TAG_FONT = () => `${Math.max(10, Math.round(opts.size * 0.72))}px ui-monospace, "DejaVu Sans Mono", monospace`;

function frame() {
  draw(clock());
  requestAnimationFrame(frame);
}

/** Frames due by `t` fall in; drops move on to `t`, writing as they go; cells dim and change. */
function advance(t) {
  const dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  while (queue.length && queue[0].at <= t) {
    const q = queue.shift();
    framesSeen++;
    lastFrameAt = t;
    // A talker's frames stack into streaks of `stack` frames; a new talker starts another.
    let p = pending.get(q.v.callId);
    if (p && p.v.unit !== q.v.unit) {
      spawn(p.v, p.fs, p.tag, t);
      p = null;
    }
    if (!p) pending.set(q.v.callId, (p = { v: q.v, fs: [], tag: tagFor(q.v, t), at: t }));
    p.fs.push(q.f);
    if (p.fs.length >= Math.max(1, opts.stack)) {
      spawn(p.v, p.fs, p.tag, t);
      pending.delete(q.v.callId);
    }
  }
  // Control channel lines fall evenly: the queue empties over about a second.
  for (let n = Math.min(ccQueue.length, Math.ceil(ccQueue.length * dt / 0.8)); n > 0; n--) spawnCC(ccQueue.shift(), t);
  // A stack the talker stopped short of goes as it is.
  for (const [id, p] of pending) {
    if (t - p.at > Math.max(1, opts.stack) * 20 + 80) {
      spawn(p.v, p.fs, p.tag, t);
      pending.delete(id);
    }
  }
  // Cells dim, linearly; lit ones change glyph as they come of age: to the
  // same place in the talker's (or the control channel's) newest message
  // ("data"), or to any glyph.
  const set = glyphSet().length;
  for (const grd of [cell, ccCell]) {
    const { glyph, bright, decay, age, errs, call, k } = grd;
    const changing = opts.change !== "off" && opts.changeRate > 0;
    for (let i = 0; i < bright.length; i++) {
      if (bright[i] <= 0) continue;
      bright[i] = Math.max(0, bright[i] - decay[i] * dt);
      if (changing && frames.ripen(age, i, opts.changeRate, dt)) {
        const src = opts.change === "data" ? newest.get(call[i])?.glyphs : null;
        glyph[i] = src && k[i] < src.length ? src[k[i]] : (Math.random() * set) | 0;
      }
      if (opts.flicker && errs[i] && Math.random() < errs[i] * 0.03 * dt * 60) glyph[i] = (Math.random() * set) | 0;
    }
  }
  // Drops fall, laying their glyphs into the cells they reach, each in its own layer.
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    if (d.doneAt) {
      if (t - d.doneAt > 1000) drops.splice(i, 1);
      continue;
    }
    d.y += d.speed * dt;
    const grd = d.cc ? ccCell : cell;
    while (d.laid < d.len && d.r0 + d.laid <= Math.floor(d.y)) {
      const c = wrap(d.r0 + d.laid) * cols + d.col;
      grd.glyph[c] = d.glyphs[d.laid];
      grd.bright[c] = 1;
      grd.decay[c] = d.decay;
      grd.hue[c] = d.hues[d.laid];
      grd.age[c] = Math.random();
      grd.errs[c] = Math.min(255, d.errs[d.laid]);
      grd.call[c] = d.call;
      grd.k[c] = d.laid;
      d.laid++;
    }
    if (d.laid === d.len && Math.floor(d.y) > d.r0 + d.len - 1) d.doneAt = t;
  }
  for (const [c, n] of newest) if (t - n.at > 10000) newest.delete(c);
}

function draw(t) {
  advance(t);
  g.globalAlpha = 1;
  g.fillStyle = "#000";
  g.fillRect(0, 0, W, H);
  const set = glyphSet().length;
  const put = (a, gi, c) => g.drawImage(a, gi * a.cellW * dpr, 0, a.cellW * dpr, a.cellH * dpr, (c % cols) * cw - PAD, Math.floor(c / cols) * ch - PAD, a.cellW, a.cellH);
  const lit = (grd, c) => frames.shown(grd.bright[c]);
  // Behind: the control channel's layer, as dim as ccLevel.
  if (opts.cc !== "off") {
    g.globalAlpha = opts.ccLevel;
    for (let c = 0; c < ccCell.bright.length; c++) {
      const b = lit(ccCell, c);
      if (b > 0.02) put(palette(ccCell.hue[c] < 0 ? 0 : ccCell.hue[c], frames.level(b, LEVELS)), ccCell.glyph[c] % set, c);
    }
    g.globalAlpha = 1;
  }
  // On top: the voice. Lit voice glyphs cover their cells first, then glow over them.
  g.fillStyle = "#000";
  if (opts.cc !== "off") {
    for (let c = 0; c < cell.bright.length; c++) if (lit(cell, c) > 0.02) g.fillRect((c % cols) * cw, Math.floor(c / cols) * ch, cw, ch);
  }
  for (let c = 0; c < cell.bright.length; c++) {
    const b = lit(cell, c);
    if (b > 0.02) put(palette(cell.hue[c] < 0 ? 0 : cell.hue[c], frames.level(b, LEVELS)), cell.glyph[c] % set, c);
  }
  // Each falling voice frame's head: the cell it wrote last, brightest of all.
  const tags = [];
  for (const d of drops) {
    if (!d.laid || d.cc) continue;
    const row = wrap(d.r0 + d.laid - 1);
    const c = row * cols + d.col;
    const h = d.hues[d.laid - 1] < 0 ? 0 : d.hues[d.laid - 1];
    if (!d.doneAt) put(atlas(`hsl(${h} 100% 90%)`, `hsl(${h} 100% 72%)`), cell.glyph[c] % set, c);
    if (d.tag) tags.push({ x: (d.col + 1) * cw + 3, y: row * ch, text: d.tag, hue: d.hue, alpha: d.doneAt ? Math.max(0, 1 - (t - d.doneAt) / 1000) : 1 });
  }

  // Bloom: the rain, small and soft (scaled down, then up), added over itself.
  if (opts.bloom) {
    const bw = Math.max(1, Math.round(W / 6)), bh = Math.max(1, Math.round(H / 6));
    if (bloom.width !== bw || bloom.height !== bh) Object.assign(bloom, { width: bw, height: bh });
    const b = bloom.getContext("2d");
    b.clearRect(0, 0, bw, bh);
    b.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, bw, bh);
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.55;
    g.imageSmoothingEnabled = true;
    g.drawImage(bloom, 0, 0, W, H);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
  }

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
    g.fillStyle = `hsl(${opts.color === "classic" || tg.hue < 0 ? 135 : tg.hue} 100% 80%)`;
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
  const ccps = ccSeen;
  ccSeen = 0;
  const quiet = clock() - lastFrameAt > 8000;
  document.body.classList.toggle("quiet", quiet);
  $("hud").textContent = `${status()}${quiet ? "\nwaiting for digital voice…" : `\n${fps} frames/s · ${ccps} control/s · ${drops.length} falling`}`;
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
    if (id === "sound" || id === "tgFilter" || id === "cc" || id === "system") relisten();
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
    systemIndex: (short) => Math.max(0, rec.status?.systemNames?.indexOf(short) ?? 0),
    systemName: (i) => client.systemName(rec.status, i),
  };
  // The systems: those recording (status), else those set up (config).
  const systems = () => rec.status?.systemNames?.length ? rec.status.systemNames : [...(rec.config?.systems ?? []), ...(rec.config?.conventional ?? [])].map((s) => s.shortName);
  rec.on("status", () => setSystems(systems()));
  rec.on("config", () => setSystems(systems()));
  relisten = () => {
    const want = opts.tgFilter.trim();
    rec.listen({ voice: true, audio: !!opts.sound, system: opts.system || null, talkgroup: /^\d+$/.test(want) ? Number(want) : null });
    // The control channel's messages come on the log topic.
    rec.subscribe(opts.cc === "off" ? [] : ["log"]);
    ccQueue.length = 0;
  };
  sound = { on: () => player.resume(), off: () => {} };
  rec.on("voice", (m) => onVoice(frames.fromChunk(m.chunk)));
  rec.on("log", onLog);
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
    if (talkers.length < 2 && Math.random() < 0.3) {
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
    // A control channel's steady beat: grants for the talkers, site broadcasts, the odd unit.
    const r = (n) => (Math.random() * n) | 0;
    const mhz = () => (771 + Math.random()).toFixed(5);
    const lines = [];
    for (const t of talkers) if (Math.random() < 0.4) lines.push({ kind: "update", text: `Update TG ${t.talkgroup} ${mhz()} MHz` });
    for (let i = 0; i < 4; i++) {
      lines.push([
        { kind: "grant", text: `Grant TG ${100 + r(6)} ${mhz()} MHz src ${4000 + r(900)} slot 0` },
        { kind: "affiliation", text: `Affiliation ${4000 + r(900)} TG ${100 + r(6)}` },
        { kind: "sysid", text: `System 0x${r(4096).toString(16)} WACN 0x${r(1 << 20).toString(16)}` },
        { kind: "adjacent", text: `Adjacent site ${r(9)}.${r(30)} CC ${mhz()} MHz` },
        { kind: "unknown", text: `Opcode 0x${r(64).toString(16)} mfid 0x90` },
      ][r(5)]);
    }
    onLog({ lines: lines.map((l) => ({ timeS: 0, system: "demo", site: "demo", ...l })) });
  };
  names = { talkgroup: (v) => v.alias ?? `TG ${v.talkgroup}`, unit: (v) => `Unit ${v.unit}`, systemIndex: () => 0, systemName: () => "demo" };
  setSystems(["demo"]);
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
