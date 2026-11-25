#!/usr/bin/env node
'use strict';
/*
 * SHOWDOWN: endless little contests between coloured dots, for your terminal.
 *
 * Something is always happening: races with overtakes and photo finishes,
 * balls smashing their way out of spinning rings, colour wars for territory,
 * dots hunting and outrunning each other. Every round ends with a winner and
 * a new one starts straight away; a running tally keeps the rivalries going.
 *
 *   node showdown.js               run forever
 *   node showdown.js --round race  only one kind of round (race, escape, war, hunt)
 *   node showdown.js --help        all options
 *
 * Keys: Space / N  next round    P  pause    Q / Esc  quit
 *
 * Graphics: where the terminal supports real pixels it draws smooth,
 * anti-aliased graphics through one of the terminal image protocols:
 *   sixel   Windows Terminal 1.22+, foot, xterm -ti vt340, Konsole, mlterm, ...
 *   kitty   kitty, Ghostty
 *   iterm   iTerm2, WezTerm
 * Elsewhere (e.g. macOS Terminal.app) it falls back to anti-aliased
 * half-block characters. The best option is picked automatically; override
 * with --gfx.
 *
 * Zero dependencies; Node.js 16+ on Windows, macOS or Linux. Adapts to any
 * terminal size, including live resizes.
 */

const zlib = require('zlib');

const TAU = Math.PI * 2;

// ───────────────────────────── helpers ─────────────────────────────

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function c8(v) { return v <= 0 ? 0 : v >= 255 ? 255 : v | 0; }
function rgb(r, g, b) { return (c8(r) << 16) | (c8(g) << 8) | c8(b); }
function mix(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const ar = a >> 16, ag = (a >> 8) & 255, ab = a & 255;
  return rgb(ar + ((b >> 16) - ar) * t, ag + (((b >> 8) & 255) - ag) * t, ab + ((b & 255) - ab) * t);
}
function scale(c, f) { return rgb((c >> 16) * f, ((c >> 8) & 255) * f, (c & 255) * f); }
function hsv(h, s, v) {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return rgb(r * 255, g * 255, b * 255);
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function angDiff(a, b) { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }

const TEAMS = [
  { name: 'RED', col: 0xff3b4e }, { name: 'BLUE', col: 0x3d8bff }, { name: 'GREEN', col: 0x38e86a },
  { name: 'YELLOW', col: 0xffd33a }, { name: 'PINK', col: 0xff5fd2 }, { name: 'CYAN', col: 0x36ecf0 },
  { name: 'ORANGE', col: 0xff8a2a }, { name: 'PURPLE', col: 0xa56cff },
];

// Stroke font for the big text: polylines on a 4-wide, 6-tall grid.
const O_SHAPE = [[1, 0], [3, 0], [4, 1], [4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0]];
const P_SHAPE = [[0, 6], [0, 0], [3, 0], [4, 1], [4, 2], [3, 3], [0, 3]];
const GLYPHS = {
  A: [[[0, 6], [0, 2], [2, 0], [4, 2], [4, 6]], [[0, 3.6], [4, 3.6]]],
  B: [[[0, 3], [0, 0], [3, 0], [4, 1], [4, 2], [3, 3], [0, 3], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3]]],
  C: [[[4, 1], [3, 0], [1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5]]],
  D: [[[0, 0], [0, 6], [2.5, 6], [4, 4.5], [4, 1.5], [2.5, 0], [0, 0]]],
  E: [[[4, 0], [0, 0], [0, 6], [4, 6]], [[0, 3], [3, 3]]],
  F: [[[4, 0], [0, 0], [0, 6]], [[0, 3], [3, 3]]],
  G: [[[4, 1], [3, 0], [1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 3.5], [2.5, 3.5]]],
  H: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]],
  I: [[[1, 0], [3, 0]], [[2, 0], [2, 6]], [[1, 6], [3, 6]]],
  J: [[[4, 0], [4, 5], [3, 6], [1, 6], [0, 5]]],
  K: [[[0, 0], [0, 6]], [[4, 0], [0, 3.6]], [[1.4, 2.6], [4, 6]]],
  L: [[[0, 0], [0, 6], [4, 6]]],
  M: [[[0, 6], [0, 0], [2, 3], [4, 0], [4, 6]]],
  N: [[[0, 6], [0, 0], [4, 6], [4, 0]]],
  O: [O_SHAPE],
  P: [P_SHAPE],
  Q: [O_SHAPE, [[2.6, 4.6], [4, 6]]],
  R: [P_SHAPE, [[2, 3], [4, 6]]],
  S: [[[4, 1], [3, 0], [1, 0], [0, 1], [0, 2], [1, 3], [3, 3], [4, 4], [4, 5], [3, 6], [1, 6], [0, 5]]],
  T: [[[0, 0], [4, 0]], [[2, 0], [2, 6]]],
  U: [[[0, 0], [0, 5], [1, 6], [3, 6], [4, 5], [4, 0]]],
  V: [[[0, 0], [2, 6], [4, 0]]],
  W: [[[0, 0], [1, 6], [2, 2.5], [3, 6], [4, 0]]],
  X: [[[0, 0], [4, 6]], [[4, 0], [0, 6]]],
  Y: [[[0, 0], [2, 3], [4, 0]], [[2, 3], [2, 6]]],
  Z: [[[0, 0], [4, 0], [0, 6], [4, 6]]],
  0: [O_SHAPE],
  1: [[[1, 1], [2, 0], [2, 6]], [[1, 6], [3, 6]]],
  2: [[[0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [0, 6], [4, 6]]],
  3: [[[0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3], [4, 4], [4, 5], [3, 6], [1, 6], [0, 5]], [[1.5, 3], [3, 3]]],
  4: [[[3, 6], [3, 0], [0, 4], [4, 4]]],
  5: [[[4, 0], [0, 0], [0, 3], [3, 3], [4, 4], [4, 5], [3, 6], [0, 6]]],
  6: [[[3.5, 0], [1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]]],
  7: [[[0, 0], [4, 0], [1.5, 6]]],
  8: [[[1, 3], [0, 2], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3], [1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3]]],
  9: [[[4, 3], [1, 3], [0, 2], [0, 1], [1, 0], [3, 0], [4, 1], [4, 5], [3, 6], [0.5, 6]]],
  '!': [[[2, 0], [2, 4]], [[2, 5.9], [2, 6]]],
  '?': [[[0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [2, 3.5], [2, 4.2]], [[2, 5.9], [2, 6]]],
  '.': [[[2, 5.9], [2, 6]]],
  ' ': [],
};

// ───────────────────────────── raster ─────────────────────────────
// RGB pixel buffer with anti-aliased primitives. ox/oy shift everything
// drawn (used for screen shake).

class Raster {
  constructor(W, H) {
    this.W = Math.max(1, W | 0);
    this.H = Math.max(1, H | 0);
    this.buf = new Uint8ClampedArray(this.W * this.H * 3);
    this.ox = 0; this.oy = 0;
  }
  clear(c) {
    const b = this.buf, row = this.W * 3;
    for (let i = 0; i < row; i += 3) { b[i] = c >> 16; b[i + 1] = (c >> 8) & 255; b[i + 2] = c & 255; }
    for (let off = row; off < b.length; off += row) b.copyWithin(off, 0, row);
  }
  put(i, r, g, b, k) {
    const buf = this.buf;
    if (k >= 1) { buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; }
    else { buf[i] += (r - buf[i]) * k; buf[i + 1] += (g - buf[i + 1]) * k; buf[i + 2] += (b - buf[i + 2]) * k; }
  }
  rect(x0, y0, x1, y1, c, a = 1) {
    x0 = Math.max(0, Math.round(x0 + this.ox)); x1 = Math.min(this.W, Math.round(x1 + this.ox));
    y0 = Math.max(0, Math.round(y0 + this.oy)); y1 = Math.min(this.H, Math.round(y1 + this.oy));
    const r = c >> 16, g = (c >> 8) & 255, b = c & 255;
    for (let y = y0; y < y1; y++) for (let x = x0, i = (y * this.W + x0) * 3; x < x1; x++, i += 3) this.put(i, r, g, b, a);
  }
  disc(cx, cy, rad, c, a = 1) {
    if (rad <= 0 || a <= 0) return;
    cx += this.ox; cy += this.oy;
    const { W, H } = this, r = c >> 16, g = (c >> 8) & 255, b = c & 255;
    if (rad < 0.6) { // sub-pixel dot: fade by area instead
      const x = Math.floor(cx), y = Math.floor(cy);
      if (x >= 0 && y >= 0 && x < W && y < H) this.put((y * W + x) * 3, r, g, b, a * Math.min(1, rad * rad * 3.5));
      return;
    }
    const x0 = Math.max(0, Math.floor(cx - rad - 1)), x1 = Math.min(W - 1, Math.ceil(cx + rad + 1));
    const y0 = Math.max(0, Math.floor(cy - rad - 1)), y1 = Math.min(H - 1, Math.ceil(cy + rad + 1));
    const inner = rad > 0.5 ? (rad - 0.5) * (rad - 0.5) : 0;
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy, dy2 = dy * dy;
      for (let x = x0, i = (y * W + x0) * 3; x <= x1; x++, i += 3) {
        const dx = x + 0.5 - cx, d2 = dx * dx + dy2;
        let cov = 1;
        if (d2 > inner) { cov = rad + 0.5 - Math.sqrt(d2); if (cov <= 0) continue; if (cov > 1) cov = 1; }
        this.put(i, r, g, b, cov * a);
      }
    }
  }
  ellipse(cx, cy, rx, ry, c, a = 1) {
    if (rx <= 0.3 || ry <= 0.3 || a <= 0) return;
    cx += this.ox; cy += this.oy;
    const { W, H } = this, r = c >> 16, g = (c >> 8) & 255, b = c & 255, m = Math.min(rx, ry);
    const x0 = Math.max(0, Math.floor(cx - rx - 1)), x1 = Math.min(W - 1, Math.ceil(cx + rx + 1));
    const y0 = Math.max(0, Math.floor(cy - ry - 1)), y1 = Math.min(H - 1, Math.ceil(cy + ry + 1));
    for (let y = y0; y <= y1; y++) {
      const dy = (y + 0.5 - cy) / ry;
      for (let x = x0, i = (y * W + x0) * 3; x <= x1; x++, i += 3) {
        const dx = (x + 0.5 - cx) / rx;
        let cov = (1 - Math.sqrt(dx * dx + dy * dy)) * m + 0.5;
        if (cov <= 0) continue;
        if (cov > 1) cov = 1;
        this.put(i, r, g, b, cov * a);
      }
    }
  }
  // soft additive light
  glow(cx, cy, R, c, a) {
    if (R <= 0.5 || a <= 0) return;
    cx += this.ox; cy += this.oy;
    const { W, H, buf } = this, r = c >> 16, g = (c >> 8) & 255, b = c & 255, R2 = R * R;
    const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(W - 1, Math.ceil(cx + R));
    const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(H - 1, Math.ceil(cy + R));
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy, dy2 = dy * dy;
      for (let x = x0, i = (y * W + x0) * 3; x <= x1; x++, i += 3) {
        const dx = x + 0.5 - cx, d2 = dx * dx + dy2;
        if (d2 >= R2) continue;
        let f = 1 - Math.sqrt(d2) / R;
        f = f * f * a;
        buf[i] += r * f; buf[i + 1] += g * f; buf[i + 2] += b * f;
      }
    }
  }
  // round-capped line of width w
  line(xa, ya, xb, yb, w, c, a = 1) {
    if (a <= 0 || w <= 0) return;
    xa += this.ox; ya += this.oy; xb += this.ox; yb += this.oy;
    const { W, H } = this, r = c >> 16, g = (c >> 8) & 255, b = c & 255, hw = w / 2;
    const thin = Math.min(1, w);
    const x0 = Math.max(0, Math.floor(Math.min(xa, xb) - hw - 1)), x1 = Math.min(W - 1, Math.ceil(Math.max(xa, xb) + hw + 1));
    const y0 = Math.max(0, Math.floor(Math.min(ya, yb) - hw - 1)), y1 = Math.min(H - 1, Math.ceil(Math.max(ya, yb) + hw + 1));
    const dx = xb - xa, dy = yb - ya, L2 = dx * dx + dy * dy || 1e-9;
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5 - ya;
      for (let x = x0, i = (y * W + x0) * 3; x <= x1; x++, i += 3) {
        const px = x + 0.5 - xa;
        let t = (px * dx + py * dy) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = px - t * dx, ey = py - t * dy;
        let cov = hw + 0.5 - Math.sqrt(ex * ex + ey * ey);
        if (cov <= 0) continue;
        if (cov > 1) cov = 1;
        this.put(i, r, g, b, cov * thin * a);
      }
    }
  }
  // annulus of radius R, width w, optionally with a gap of half-angle gapW at angle gapTh
  ring(cx, cy, R, w, c, a = 1, gapTh = 0, gapW = 0) {
    cx += this.ox; cy += this.oy;
    const ro = R + w / 2 + 1, ri = Math.max(0, R - w / 2 - 1);
    const y0 = Math.max(0, Math.floor(cy - ro)), y1 = Math.min(this.H - 1, Math.ceil(cy + ro));
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy, dy2 = dy * dy;
      if (dy2 > ro * ro) continue;
      const xo = Math.sqrt(ro * ro - dy2);
      if (dy2 < ri * ri) {
        const xi = Math.sqrt(ri * ri - dy2);
        this.ringSpan(cx, cy, y, dy, cx - xo, cx - xi, R, w, c, a, gapTh, gapW);
        this.ringSpan(cx, cy, y, dy, cx + xi, cx + xo, R, w, c, a, gapTh, gapW);
      } else {
        this.ringSpan(cx, cy, y, dy, cx - xo, cx + xo, R, w, c, a, gapTh, gapW);
      }
    }
  }
  ringSpan(cx, cy, y, dy, sa, sb, R, w, c, a, gapTh, gapW) {
    const W = this.W, r = c >> 16, g = (c >> 8) & 255, b = c & 255, hw = w / 2, thin = Math.min(1, w);
    const xa = Math.max(0, Math.floor(sa)), xb = Math.min(W - 1, Math.ceil(sb));
    for (let x = xa, i = (y * W + xa) * 3; x <= xb; x++, i += 3) {
      const dx = x + 0.5 - cx, d = Math.sqrt(dx * dx + dy * dy);
      let cov = hw + 0.5 - Math.abs(d - R);
      if (cov <= 0) continue;
      if (cov > 1) cov = 1;
      if (gapW > 0) {
        const gd = (Math.abs(angDiff(Math.atan2(dy, dx), gapTh)) - gapW) * d + 0.5;
        if (gd <= 0) continue;
        if (gd < 1) cov *= gd;
      }
      this.put(i, r, g, b, cov * thin * a);
    }
  }
  // filled convex polygon (no anti-aliasing; used for small static details)
  poly(pts, c, a = 1) {
    const ys = pts.map(p => p[1] + this.oy);
    const y0 = Math.max(0, Math.ceil(Math.min(...ys) - 0.5)), y1 = Math.min(this.H - 1, Math.floor(Math.max(...ys) - 0.5));
    const r = c >> 16, g = (c >> 8) & 255, b = c & 255;
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5;
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1_] = pts[i], [x2, y2_] = pts[(i + 1) % pts.length];
        const ya = y1_ + this.oy, yb = y2_ + this.oy;
        if ((yc < ya && yc < yb) || (yc > ya && yc > yb) || ya === yb) continue;
        const x = x1 + this.ox + ((yc - ya) * (x2 - x1)) / (yb - ya);
        lo = Math.min(lo, x); hi = Math.max(hi, x);
      }
      const xa = Math.max(0, Math.round(lo)), xb = Math.min(this.W, Math.round(hi));
      for (let x = xa, i = (y * this.W + xa) * 3; x < xb; x++, i += 3) this.put(i, r, g, b, a);
    }
  }
  tint(c, a) {
    const buf = this.buf, r = c >> 16, g = (c >> 8) & 255, b = c & 255;
    for (let i = 0; i < buf.length; i += 3) this.put(i, r, g, b, a);
  }
  // big stroke-font text centred at (cx, cy), `size` = cap height in pixels
  text(str, cx, cy, size, col) {
    const s = size / 6, n = str.length;
    const x0 = cx - ((n * 5.6 - 1.6) * s) / 2, y0 = cy - size / 2;
    const w = Math.max(1.2, size * 0.17);
    for (let pass = 0; pass < 2; pass++) {
      const off = pass ? 0 : Math.max(1, s * 0.6);
      for (let k = 0; k < n; k++) {
        const gl = GLYPHS[str[k]];
        if (!gl) continue;
        const gx = x0 + k * 5.6 * s;
        for (const pl of gl) {
          for (let j = 1; j < pl.length; j++) {
            const [ax, ay] = pl[j - 1], [bx, by] = pl[j];
            const c = pass ? mix(col, 0xffffff, 0.4 - ((ay + by) / 12) * 0.4) : 0x05040a;
            this.line(gx + ax * s + off, y0 + ay * s + off, gx + bx * s + off, y0 + by * s + off, pass ? w : w * 1.5, c, pass ? 1 : 0.85);
          }
        }
      }
    }
  }
  static textSize(str, maxW, maxH) { return Math.min(maxH, (maxW / (str.length * 5.6 - 1.6)) * 6); }
}

class Particles {
  constructor(rand) { this.rand = rand; this.list = []; this.u = 1; }
  burst(x, y, col, n, speed, opt = {}) {
    const r = this.rand;
    for (let i = 0; i < n; i++) {
      const a = (opt.dir ?? 0) + (r() - 0.5) * (opt.spread ?? TAU);
      const s = speed * (0.3 + 0.7 * r());
      const life = (opt.life ?? 0.7) * (0.5 + 0.5 * r());
      this.list.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life,
        col: opt.white && r() < 0.3 ? 0xffffff : col, g: opt.g ?? 0, size: (opt.size ?? 0.55) * this.u * (0.6 + 0.8 * r()),
      });
    }
  }
  update(dt) {
    for (const p of this.list) {
      p.vy += p.g * dt;
      p.vx *= 1 - dt * 0.8; p.vy *= 1 - dt * 0.3;
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    }
    this.list = this.list.filter(p => p.life > 0);
  }
  draw(rs) {
    for (const p of this.list) {
      const f = Math.min(1, (p.life / p.max) * 1.6);
      rs.disc(p.x, p.y, p.size * (0.5 + 0.5 * f), p.col, f);
    }
  }
}

// ───────────────────────────── rounds ─────────────────────────────
// Each round: start(W, H, teams), update(dt) → winning team or null,
// draw(raster), hud() → coloured text segments for the status line.
// `show.u` is the size of one design unit in pixels, so everything scales
// with the resolution the terminal gives us.

// RACE: five laps of a freshly generated circuit, watched from a chase camera
// behind one racer. The track swells and pinches (bottlenecks cause
// pile-ups) and splits round dividers where it's wide, and it's full of
// trouble: pinball bumpers, spinning bars, sliding gates, boulders rolling
// the wrong way, oil, jumps and boost pads. Racers grab pickups to zap,
// shockwave, mine or shield against each other, and the last-placed racers
// are knocked out at the end of each lap until two are left to duel it out.

const CHASE_BACK = 2.4;   // chase camera distance behind the hero, in track widths
const CHASE_HEIGHT = 1.0;  // and its height
const RAMP_APEX = 0.6;    // jump height, in track widths
const RAMP_AIR = 0.75;    // seconds in the air
const RACE_LAPS = 5;
const RACE_CUTS = [0, 2, 2, 1, 1]; // racers knocked out at the end of each lap (8 → 6 → 4 → 3 → 2)
const ITEMS = ['WAVE', 'ZAP', 'SHIELD', 'MINE'];
const ITEM_COL = { WAVE: 0x7fd8ff, ZAP: 0xfff06a, SHIELD: 0x9cff7a, MINE: 0xff5050 };
const RACE_THEMES = [
  { bg: [0x10301c, 0x12331f], track: 0x2a2c38, line: 0xe8e8ee, kerb: [0xd8283c, 0xeeeef2], sky: [0x2f6fd0, 0xa8d4f5], hill: 0x1d4a2c }, // grass
  { bg: [0x5c4628, 0x5f492a], track: 0x34302e, line: 0xf0e0c0, kerb: [0xf08a24, 0xf4efe6], sky: [0xd8663a, 0xf7c78a], hill: 0x7a4c28 }, // desert
  { bg: [0x0b1024, 0x0c1227], track: 0x1c1f30, line: 0x7fd8ff, kerb: [0xff4fd8, 0x7fd8ff], sky: [0x03050c, 0x1a2350], hill: 0x0b1028, stars: true }, // night
  { bg: [0xccdae8, 0xd0dcea], track: 0x3a3f4c, line: 0xffffff, kerb: [0x2878d2, 0xf4f8ff], sky: [0x7f98bc, 0xe6eef6], hill: 0x95a8c0 }, // snow
];

function convexHull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// Pull any control point that makes a corner sharper than ~110° towards its
// neighbours; otherwise the spline turns it into a needle-thin spike.
function softenCorners(pts) {
  const n = pts.length;
  for (let iter = 0; iter < 12; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
      const ux = a[0] - b[0], uy = a[1] - b[1], vx = c[0] - b[0], vy = c[1] - b[1];
      const cos = (ux * vx + uy * vy) / ((Math.hypot(ux, uy) * Math.hypot(vx, vy)) || 1);
      if (cos > -0.34) { // angle under ~110°
        b[0] = b[0] * 0.5 + (a[0] + c[0]) * 0.25;
        b[1] = b[1] * 0.5 + (a[1] + c[1]) * 0.25;
        changed = true;
      }
    }
    if (!changed) break;
  }
}

// Closed centripetal Catmull-Rom spline (no loops or cusps between points).
function splineLoop(pts, perSeg) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const P0 = pts[(i - 1 + n) % n], P1 = pts[i], P2 = pts[(i + 1) % n], P3 = pts[(i + 2) % n];
    const t1 = Math.sqrt(Math.hypot(P1[0] - P0[0], P1[1] - P0[1])) || 1e-3;
    const t2 = t1 + (Math.sqrt(Math.hypot(P2[0] - P1[0], P2[1] - P1[1])) || 1e-3);
    const t3 = t2 + (Math.sqrt(Math.hypot(P3[0] - P2[0], P3[1] - P2[1])) || 1e-3);
    for (let s = 0; s < perSeg; s++) {
      const t = t1 + ((t2 - t1) * s) / perSeg;
      const L = (a, b, ta, tb) => [((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta), ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)];
      const A1 = L(P0, P1, 0, t1), A2 = L(P1, P2, t1, t2), A3 = L(P2, P3, t2, t3);
      const B1 = L(A1, A2, 0, t2), B2 = L(A2, A3, t1, t3);
      out.push(L(B1, B2, t1, t2));
    }
  }
  return out;
}

class Race {
  constructor(show) { this.show = show; }
  start(W, H, teams) {
    const r = this.show.rand, u = (this.u = this.show.u);
    this.W = W; this.H = H;
    const tw = (this.tw = Math.min(W, H) * 0.085); // base track width; it varies round the lap
    this.theme = RACE_THEMES[(r() * RACE_THEMES.length) | 0];
    const raw = this.genTrack(W, H, tw, r);

    // resample at even spacing so distance along the track is uniform
    const cum = [0];
    for (let i = 1; i <= raw.length; i++) {
      const [ax, ay] = raw[i - 1], [bx, by] = raw[i % raw.length];
      cum.push(cum[i - 1] + Math.hypot(bx - ax, by - ay));
    }
    const L = (this.L = cum[cum.length - 1]);
    const M = (this.M = Math.max(400, Math.round(L / (0.5 * u))));
    const ds = (this.ds = L / M);
    this.xs = new Float32Array(M); this.ys = new Float32Array(M);
    for (let k = 0, j = 0; k < M; k++) {
      const d = k * ds;
      while (cum[j + 1] < d) j++;
      const f = (d - cum[j]) / (cum[j + 1] - cum[j] || 1);
      const [ax, ay] = raw[j], [bx, by] = raw[(j + 1) % raw.length];
      this.xs[k] = ax + (bx - ax) * f; this.ys[k] = ay + (by - ay) * f;
    }

    // speed profile: corner speed from curvature, then braking and
    // acceleration zones so racers slow *before* a bend and build speed after
    const win = Math.max(2, Math.round((tw * 0.8) / ds));
    const prof = (this.prof = new Float32Array(M)), side = (this.side = new Float32Array(M));
    const Rref = tw * 3.2;
    for (let k = 0; k < M; k++) {
      const a = (k - win + M) % M, b = (k + win) % M;
      const h1 = Math.atan2(this.ys[k] - this.ys[a], this.xs[k] - this.xs[a]);
      const h2 = Math.atan2(this.ys[b] - this.ys[k], this.xs[b] - this.xs[k]);
      const turn = angDiff(h2, h1);
      const R = (2 * win * ds) / Math.max(1e-4, Math.abs(turn));
      prof[k] = clamp(Math.sqrt(R / Rref), 0.38, 1);
      side[k] = Math.sign(turn); // +normal is the inside of the bend
    }
    const dec = 1 / (tw * 5), acc = 1 / (tw * 9);
    for (let pass = 0; pass < 2; pass++) {
      for (let k = M - 1; k >= 0; k--) prof[k] = Math.min(prof[k], Math.sqrt(prof[(k + 1) % M] ** 2 + 2 * dec * ds));
      for (let k = 0; k < M; k++) prof[k] = Math.min(prof[k], Math.sqrt(prof[(k - 1 + M) % M] ** 2 + 2 * acc * ds));
    }
    // start/finish goes in the middle of the longest straight
    let best = 0, bestLen = 0;
    for (let k = 0, run = 0; k < 2 * M; k++) {
      run = prof[k % M] > 0.95 ? run + 1 : 0;
      if (run > bestLen) { bestLen = run; best = (k - (run >> 1) + M) % M; }
    }
    this.d0 = best * ds;
    this.computeWidths(r);

    this.laps = RACE_LAPS;
    let lapNorm = 0;
    for (let k = 0; k < M; k++) lapNorm += ds / prof[k];
    this.vs = lapNorm / 7; // px/s at profile speed 1, tuned for ~7 s laps
    this.total = this.laps * L;
    this.rr = Math.max(1, tw * 0.13);

    this.placeFeatures(r);
    this.buildField();
    this.arches = [{ a: 0, start: true }]; // the start/finish gantry marks the lap line
    this.drawBackground(W, H, tw, u);
    const n = teams.length;
    this.racers = teams.map((team, i) => ({
      team,
      d: -(Math.floor(i / 2) * this.rr * 4 + this.rr * 2), // two-wide starting grid behind the line
      lat: (i % 2 ? 1 : -1) * tw * 0.18, v: 0,
      top: 1 + (r() - 0.5) * 0.1, grip: 1 + (r() - 0.5) * 0.16, form: 1, formT: 0,
      greedy: r(), alert: r(), // how keen on pads and pickups; a seed for spotting hazards
      wide: 0, spinA: 0, boost: 0, h: 0, vh: 0, ramp: -1, contactT: 0, hitT: 0,
      item: null, itemT: 0, itemHeld: 0, shield: 0, zapT: 0, island: -1,
      out: false, outT: 0, done: false, time: 0, hist: [],
    }));
    this.camHold = 0; this.lonely = 0; this.boostVis = 0;
    this.order = [...this.racers];
    this.leader = this.racers[0]; this.leadHold = 0; this.passHold = 0;
    this.lapDone = 0; this.finished = []; this.endT = 0; this.t = 0; this.danger = new Set();
    this.nextBoulder = 5;
    // the camera rides with one racer from the middle of the grid
    this.hero = this.racers[Math.min(n - 1, 3 + ((r() * 2) | 0))];
    this.hills = [r() * TAU, r() * TAU, r() * TAU];
    this.stars = Array.from({ length: 90 }, () => [r() * TAU, r(), 0.4 + 0.6 * r()]);
    this.camTh = undefined;
    this.updateCamera(1);
  }

  // How wide the track is round the lap: a slow wave between bottlenecks
  // (about half the base width) and wide sections (up to ~1.6x), but never
  // so wide that it gets close to another part of the circuit.
  computeWidths(r) {
    const { M, ds, tw, xs, ys } = this;
    const step = Math.max(1, Math.round(tw / 3 / ds)), n = Math.floor(M / step);
    const room = new Float32Array(M);
    for (let i = 0; i < n; i++) {
      const ki = i * step;
      let near = tw * 4;
      for (let j = 0; j < n; j++) {
        const kj = j * step, sep = Math.min(Math.abs(ki - kj), M - Math.abs(ki - kj)) * ds;
        if (sep < tw * 3) continue;
        near = Math.min(near, Math.hypot(xs[ki] - xs[kj], ys[ki] - ys[kj]));
      }
      for (let k = ki; k < Math.min(M, ki + step); k++) room[k] = near;
    }
    for (let k = n * step; k < M; k++) room[k] = room[n * step - 1];
    const f1 = 2 + ((r() * 2) | 0), f2 = 4 + ((r() * 3) | 0), p1 = r() * TAU, p2 = r() * TAU;
    let wf = new Float32Array(M);
    for (let k = 0; k < M; k++) {
      const a = (k / M) * TAU;
      const want = clamp(1 + 0.42 * Math.sin(f1 * a + p1) + 0.28 * Math.sin(f2 * a + p2), 0.55, 1.6);
      const fit = (room[k] / 2 - tw * 0.32) / (tw / 2); // leave a strip of grass between sections
      wf[k] = clamp(Math.min(want, fit), 0.55, 1.6);
    }
    // smooth it so the edges flow rather than step
    const half = Math.max(1, Math.round((tw * 1.2) / ds));
    for (let pass = 0; pass < 2; pass++) {
      const out = new Float32Array(M);
      let sum = 0;
      for (let k = -half; k <= half; k++) sum += wf[(k + M) % M];
      for (let k = 0; k < M; k++) {
        out[k] = sum / (2 * half + 1);
        sum += wf[(k + half + 1) % M] - wf[(k - half + M) % M];
      }
      wf = out;
    }
    this.wf = wf;
    this.maxHw = (Math.max(...wf) * tw) / 2;
    // half-width by lap position (for the renderer's per-pixel lookups)
    this.hwS = new Float32Array(M);
    for (let s = 0; s < M; s++) this.hwS[s] = this.hwAt(s * ds);
  }
  hwAt(d) { return (this.wf[this.idx(d)] * this.tw) / 2; }

  // Everything on the track. Static markings (pads, ramps, oil, dividers) are
  // indexed by lap position so the renderer can paint them per pixel; solid
  // obstacles and pickups are objects that move, spin and get hit.
  placeFeatures(r) {
    const { M, ds, L, tw } = this;
    this.features = [];
    this.featAt = new Int16Array(M).fill(-1);
    this.obs = []; this.boulders = []; this.mines = []; this.effects = [];
    const busy = new Uint8Array(M);
    const slot = a => Math.floor((((a % L) + L) % L) / ds) % M;
    const free = (a0, a1) => {
      if (a0 < tw * 2.5 || a1 > L - tw * 1.5) return false; // keep the start line clear
      for (let a = a0 - tw * 0.8; a <= a1 + tw * 0.8; a += ds) if (busy[slot(a)]) return false;
      return true;
    };
    const reserve = (a0, a1) => { for (let a = a0 - tw * 0.8; a <= a1 + tw * 0.8; a += ds) busy[slot(a)] = 1; };
    const addFeat = f => {
      if (!free(f.a0, f.a1)) return false;
      reserve(f.a0, f.a1);
      const id = this.features.push(f) - 1;
      for (let a = f.a0; a <= f.a1; a += ds) this.featAt[slot(a)] = id;
      return true;
    };
    const addObs = (o, a0, a1) => { if (!free(a0, a1)) return false; reserve(a0, a1); this.obs.push(o); return true; };

    // dividers: where the track runs wide for a while, an island splits it in two
    for (let k = 0, start = -1; k <= M; k++) {
      const a = k * ds, wide = k < M && this.hwAt(a) > tw * 0.66;
      if (wide && start < 0) start = a;
      if (!wide && start >= 0) {
        if (a - start > tw * 3 && r() < 0.85) addFeat({ kind: 'island', a0: start + tw * 0.6, a1: a - tw * 0.6, lat: 0, w: tw * 0.12 });
        start = -1;
      }
    }
    // straights get a set piece each (and the long ones two), plus boost pads
    const runs = [];
    for (let k = 0, start = -1; k <= M; k++) {
      const fast = k < M && this.profAt(k * ds) > 0.92;
      if (fast && start < 0) start = k;
      if (!fast && start >= 0) { runs.push([start * ds, (k - start) * ds]); start = -1; }
    }
    const spots = [];
    for (const [a0, len] of runs) {
      if (len < tw * 3.5) continue;
      spots.push([a0 + len * (0.3 + r() * 0.15), len]);
      if (len > tw * 9) spots.push([a0 + len * (0.7 + r() * 0.1), len]);
    }
    for (let i = spots.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [spots[i], spots[j]] = [spots[j], spots[i]]; }
    const plan = ['items', 'rotor', 'bumpers', 'ramp', 'gate', 'items', 'rotor', 'bumpers', 'gate', 'items'];
    spots.forEach(([a, len], i) => {
      let kind = plan[i % plan.length];
      if (kind === 'ramp' && len < tw * 4.5) kind = 'bumpers';
      this.placePiece(kind, a, r, addFeat, addObs);
    });
    for (const [a0, len] of runs) {
      if (len < tw * 3.5) continue;
      const a = a0 + tw * 0.8 + r() * (len - tw * 2);
      addFeat({ kind: 'pad', a0: a, a1: a + tw * 0.9, lat: (r() < 0.5 ? -1 : 1) * this.hwAt(a) * 0.45, w: tw * 0.16 });
    }
    // make sure there are always pickups to fight over
    for (let tries = 0; tries < 60 && this.obs.filter(o => o.kind === 'item').length < 2; tries++) {
      this.placePiece('items', r() * L, r, addFeat, addObs);
    }
    // corners: oil slicks and the odd bumper at the exit
    for (let tries = 0, oil = 0; tries < 40 && oil < 2; tries++) {
      const a = r() * L, w = tw * 0.11;
      if (this.profAt(a) < 0.8 && addFeat({ kind: 'oil', a0: a - w, a1: a + w, ac: a, lat: (r() - 0.5) * this.hwAt(a), w })) oil++;
    }
  }
  placePiece(kind, a, r, addFeat, addObs) {
    const tw = this.tw, hw = this.hwAt(a);
    if (kind === 'items') {
      addObs({ kind: 'item', a, lats: [-0.55, 0, 0.55].map(f => f * hw), cd: [0, 0, 0] }, a - tw * 0.3, a + tw * 0.3);
    } else if (kind === 'ramp') {
      addFeat({ kind: 'ramp', a0: a, a1: a + tw * 0.45, lat: 0, w: hw });
    } else if (kind === 'rotor') {
      const len = Math.min(hw * 0.85, tw * 0.48);
      addObs({ kind: 'rotor', a, lat: (r() - 0.5) * (hw - len), len, w: tw * 0.06, ang: r() * TAU, spd: (r() < 0.5 ? -1 : 1) * (1.8 + r() * 1.2) }, a - len, a + len);
    } else if (kind === 'gate') {
      const half = hw * 0.42;
      addObs({ kind: 'gate', a, half, amp: hw - half, spd: 1.1 + r() * 0.9, ph: r() * TAU, lat: 0, w: tw * 0.06 }, a - tw * 0.3, a + tw * 0.3);
    } else { // a triangle of pinball bumpers
      const br = tw * 0.1;
      addObs({ kind: 'bumpers', a, r: br, list: [{ a, lat: 0, flash: 0 }, { a: a + tw * 0.7, lat: -hw * 0.5, flash: 0 }, { a: a + tw * 0.7, lat: hw * 0.5, flash: 0 }] }, a - br, a + tw * 0.7 + br);
    }
  }
  featureAt(d) { return this.featAt[Math.floor((((d % this.L) + this.L) % this.L) / this.ds) % this.M]; }
  // signed distance along the track from lap position b to a, in [-L/2, L/2)
  along(a, b) { const L = this.L; return ((((a - b + L / 2) % L) + L) % L) - L / 2; }

  // Signed sideways offset from the track centre line for every map cell (and
  // how far round the lap that nearest point is). The 3D view reads this per
  // pixel, so edges, kerbs and pads stay sharp however close the camera gets.
  buildField() {
    const { W, H, M, ds, L, xs, ys } = this, R = (this.fieldR = this.maxHw + this.tw * 0.75), R2 = R * R;
    const fl = (this.fl = new Float32Array(W * H).fill(1e6)), fa = (this.fa = new Float32Array(W * H));
    for (let k = 0; k < M; k++) {
      const x = xs[k], y = ys[k], arc = (((k * ds - this.d0) % L) + L) % L;
      let tx = xs[(k + 3) % M] - xs[(k - 3 + M) % M], ty = ys[(k + 3) % M] - ys[(k - 3 + M) % M];
      const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl; // same normal as at()
      const x0 = Math.max(0, Math.floor(x - R)), x1 = Math.min(W - 1, Math.ceil(x + R));
      const y0 = Math.max(0, Math.floor(y - R)), y1 = Math.min(H - 1, Math.ceil(y + R));
      for (let yy = y0; yy <= y1; yy++) {
        const dy = yy + 0.5 - y;
        for (let xx = x0, i = yy * W + x0; xx <= x1; xx++, i++) {
          const dx = xx + 0.5 - x, d2 = dx * dx + dy * dy;
          if (d2 < R2 && d2 < fl[i] * fl[i]) { fl[i] = Math.sign(dy * tx - dx * ty) * Math.sqrt(d2) || Math.sqrt(d2); fa[i] = arc; }
        }
      }
    }
  }
  // chase camera: trails behind the hero along its direction of travel
  // (looking slightly into the next bend), swinging smoothly through corners
  updateCamera(dt) {
    const h = this.hero, tw = this.tw;
    const here = this.at(h.d), ahead = this.at(h.d + tw * 0.9);
    const th = Math.atan2(ahead.y - here.y, ahead.x - here.x);
    this.camTh = this.camTh === undefined ? th : this.camTh + angDiff(th, this.camTh) * Math.min(1, dt * 4);
    const [hx, hy] = this.pos(h);
    this.camX = hx - Math.cos(this.camTh) * CHASE_BACK * tw;
    this.camY = hy - Math.sin(this.camTh) * CHASE_BACK * tw;
  }
  introLine() {
    return [['RIDING WITH ', 0xd8d8e8], [this.hero.team.name, this.hero.team.col], ['.  FIVE LAPS. THE LAST PLACES ARE KNOCKED OUT EACH LAP.', 0xd8d8e8]];
  }

  // Random circuit: convex hull of random points, with some edges pulled in or
  // pushed out to make hairpins and chicanes, smoothed with a spline. Rejected
  // and retried if any two parts of the track come too close or a bend is too
  // tight for the track width.
  genTrack(W, H, tw, r) {
    const m = tw * 0.8 + 3 * this.u;
    const bw = W - 2 * m, bh = H - 2 * m;
    const aspect = bw / bh; // lay the track out in the screen's own proportions
    let fallback = null;
    for (let attempt = 0; attempt < 80; attempt++) {
      const pts = [];
      for (let i = 0, n = 8 + ((r() * 6) | 0); i < n; i++) pts.push([r() * aspect, r()]);
      const hull = convexHull(pts);
      if (hull.length < 4) continue;
      // two rounds of pulling edge midpoints in (or out): the first makes big
      // hairpins and bays, the second smaller kinks and chicanes
      let ctrl = hull;
      for (const [minLen, amt] of [[0.3, 0.5], [0.2, 0.26]]) {
        const next = [];
        for (let i = 0; i < ctrl.length; i++) {
          const a = ctrl[i], b = ctrl[(i + 1) % ctrl.length];
          next.push(a);
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len > minLen && r() < 0.85) {
            const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len; // inward for a CCW hull
            const k = (r() * 1.4 - 0.3) * len * amt;
            next.push([(a[0] + b[0]) / 2 + nx * k, (a[1] + b[1]) / 2 + ny * k]);
          }
        }
        ctrl = next;
      }
      softenCorners(ctrl);
      let curve = splineLoop(ctrl, 30);
      // scale evenly (no squashing) to fill the screen, centred
      const xs = curve.map(p => p[0]), ys = curve.map(p => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const k = Math.min(bw / (x1 - x0 || 1), bh / (y1 - y0 || 1));
      const ox = m + (bw - (x1 - x0) * k) / 2, oy = m + (bh - (y1 - y0) * k) / 2;
      curve = curve.map(([x, y]) => [ox + (x - x0) * k, oy + (y - y0) * k]);
      fallback = fallback || curve;
      if (this.trackOk(curve, tw)) return curve;
    }
    this.unchecked = true; // nothing passed; use the first attempt anyway
    return fallback;
  }
  trackOk(curve, tw) {
    // sample about every third of a track width
    const pts = [curve[0]];
    let acc = 0;
    for (let i = 1; i < curve.length; i++) {
      acc += Math.hypot(curve[i][0] - curve[i - 1][0], curve[i][1] - curve[i - 1][1]);
      if (acc >= tw / 3) { pts.push(curve[i]); acc = 0; }
    }
    const n = pts.length, sep = 7; // ignore neighbours within ~2 track widths along the loop
    for (let i = 0; i < n; i++) {
      for (let j = i + sep; j < n; j++) {
        if (n - (j - i) < sep) continue;
        if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) < tw * 1.45) return false;
      }
      const a = pts[(i - 2 + n) % n], b = pts[i], c = pts[(i + 2) % n];
      const turn = Math.abs(angDiff(Math.atan2(c[1] - b[1], c[0] - b[0]), Math.atan2(b[1] - a[1], b[0] - a[0])));
      if (turn > 1.25) return false; // hairpin tighter than the track can take
    }
    return true;
  }
  drawBackground(W, H, tw, u) {
    const th = this.theme, bg = new Raster(W, H), L = this.L;
    const stripe = 14 * u;
    for (let y = 0; y < H; y++) {
      for (let x = 0, i = y * W * 3; x < W; x++, i += 3) {
        const c = th.bg[Math.floor((x + y * 0.6) / stripe) & 1];
        bg.buf[i] = c >> 16; bg.buf[i + 1] = (c >> 8) & 255; bg.buf[i + 2] = c & 255;
      }
    }
    const K = Math.max(60, Math.round(L / (2 * u)));
    const seg = j => [this.at((j / K) * L), this.at(((j + 1) / K) * L), (j / K) * L];
    for (let j = 0; j < K; j++) { // kerbs only on the corners, like a real circuit
      const [p, q, a] = seg(j);
      if (this.profAt(a) <= 0.85) bg.line(p.x, p.y, q.x, q.y, 2 * this.hwAt(a) + 3 * u, th.kerb[Math.floor(a / (3 * u)) & 1]);
    }
    for (let j = 0; j < K; j++) { const [p, q, a] = seg(j); bg.line(p.x, p.y, q.x, q.y, 2 * this.hwAt(a), th.track); }
    for (const s of [-1, 1]) {
      for (let j = 0; j < K; j++) {
        const [p, q, a] = seg(j), o = s * (this.hwAt(a) - 0.9 * u);
        bg.line(p.x + p.nx * o, p.y + p.ny * o, q.x + q.nx * o, q.y + q.ny * o, Math.max(1, 0.45 * u), th.line, 0.85);
      }
    }
    for (const f of this.features) {
      if (f.kind === 'island') {
        for (let a = f.a0; a < f.a1; a += 2 * u) {
          const p = this.at(a), q = this.at(Math.min(f.a1, a + 2 * u));
          bg.line(p.x, p.y, q.x, q.y, 2 * f.w, th.kerb[Math.floor(a / (3 * u)) & 1]);
          bg.line(p.x, p.y, q.x, q.y, Math.max(1, 2 * f.w - 2 * u), scale(th.bg[0], 0.9));
        }
      } else if (f.kind === 'oil') {
        const p = this.at(f.ac);
        bg.disc(p.x + p.nx * f.lat, p.y + p.ny * f.lat, f.w, 0x0c0c14);
      } else {
        const l0 = f.lat - f.w, l1 = f.lat + f.w, p = this.at(f.a0), q = this.at(f.a1);
        bg.poly([[p.x + p.nx * l0, p.y + p.ny * l0], [p.x + p.nx * l1, p.y + p.ny * l1], [q.x + q.nx * l1, q.y + q.ny * l1], [q.x + q.nx * l0, q.y + q.ny * l0]],
          f.kind === 'ramp' ? 0xffc820 : 0x30e0ff);
      }
    }
    const wp = (a, lat) => { const p = this.at(a); return [p.x + p.nx * lat, p.y + p.ny * lat]; };
    for (const o of this.obs) {
      if (o.kind === 'bumpers') for (const b of o.list) { const [x, y] = wp(b.a, b.lat); bg.disc(x, y, o.r, 0xff4fa8); }
      else if (o.kind === 'item') for (const lat of o.lats) { const [x, y] = wp(o.a, lat); bg.disc(x, y, tw * 0.09, 0xfff06a); }
      else if (o.kind === 'rotor') { const [x1, y1] = wp(o.a, o.lat - o.len), [x2, y2] = wp(o.a, o.lat + o.len); bg.line(x1, y1, x2, y2, Math.max(1, tw * 0.08), 0xffd33a); }
      else if (o.kind === 'gate') { const [x1, y1] = wp(o.a, -this.hwAt(o.a)), [x2, y2] = wp(o.a, this.hwAt(o.a)); bg.line(x1, y1, x2, y2, Math.max(1, tw * 0.06), 0xd02828, 0.7); }
    }
    for (const ar of this.arches) {
      const p = this.at(ar.a), o = this.hwAt(ar.a) + tw * 0.25;
      bg.line(p.x - p.nx * o, p.y - p.ny * o, p.x + p.nx * o, p.y + p.ny * o, Math.max(1, tw * 0.08), ar.start ? 0xffffff : th.kerb[0]);
    }
    // chequered start/finish line
    const st = this.at(0), hw0 = this.hwAt(0), sq = (2 * hw0) / 8, tx = st.ny, ty = -st.nx;
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 2; j++) {
        const o = -hw0 + i * sq, a = j * sq - sq;
        const bx = st.x + st.nx * o + tx * a, by = st.y + st.ny * o + ty * a;
        bg.poly([[bx, by], [bx + st.nx * sq, by + st.ny * sq], [bx + st.nx * sq + tx * sq, by + st.ny * sq + ty * sq], [bx + tx * sq, by + ty * sq]],
          (i + j) & 1 ? 0xffffff : 0x111111);
      }
    }
    this.bg = bg.buf;
  }

  idx(d) { return Math.floor(((((d + this.d0) % this.L) + this.L) % this.L) / this.ds) % this.M; }
  profAt(d) { return this.prof[this.idx(d)]; }
  at(d) {
    const { M, L, xs, ys } = this;
    const f = (((((d + this.d0) % L) + L) % L) / L) * M;
    const i = Math.floor(f) % M, j = (i + 1) % M, fr = f - Math.floor(f);
    const x = xs[i] + (xs[j] - xs[i]) * fr, y = ys[i] + (ys[j] - ys[i]) * fr;
    const k = (i + 3) % M, h = (i - 3 + M) % M;
    let tx = xs[k] - xs[h], ty = ys[k] - ys[h];
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    return { x, y, nx: -ty, ny: tx };
  }
  pos(rc) {
    const p = this.at(rc.d);
    return [p.x + p.nx * rc.lat, p.y + p.ny * rc.lat];
  }

  // A racer takes a hit: slowed, maybe spun round. Shields soak it up.
  knock(rc, power, spin, why) {
    const show = this.show;
    if (rc.shield > 0) {
      rc.shield = 0;
      const [x, y] = this.pos(rc);
      show.parts.burst(x, y, ITEM_COL.SHIELD, 16, this.tw * 1.5, { life: 0.4, white: true });
      show.event(`${rc.team.name}'S SHIELD SAVES IT!`, rc.team.col, rc !== this.hero);
      return false;
    }
    rc.v *= 1 - 0.5 * power;
    rc.hitT = 0.4;
    if (show.rand() < spin) rc.wide = Math.max(rc.wide, 0.6 + 0.6 * power);
    if (why) show.event(why, rc.team.col, !this.onCamera(rc));
    if (rc === this.hero) show.shake(0.25 + 0.35 * power);
    return true;
  }
  // our racer, or someone just ahead of it (i.e. on screen)
  onCamera(rc) { const g = rc.d - this.hero.d; return rc === this.hero || (g > -this.tw * 0.5 && g < this.tw * 6); }

  update(dt) {
    const show = this.show, r = show.rand, tw = this.tw, rr = this.rr, L = this.L;
    this.t += dt;
    for (const o of this.obs) {
      if (o.kind === 'rotor') o.ang += o.spd * dt;
      else if (o.kind === 'gate') o.lat = Math.sin(this.t * o.spd + o.ph) * o.amp;
      else if (o.kind === 'bumpers') for (const b of o.list) b.flash = Math.max(0, b.flash - dt * 4);
      else if (o.kind === 'item') for (let i = 0; i < o.cd.length; i++) o.cd[i] -= dt;
    }
    this.updateBoulders(dt);
    for (const m of this.mines) m.t += dt;
    for (const e of this.effects) e.t += dt;
    this.effects = this.effects.filter(e => e.t < 0.6);
    const racing = this.racers.filter(x => !x.out && !x.done);

    for (const rc of this.racers) {
      if (rc.out) { rc.outT += dt; continue; }
      if (rc.done) { rc.v *= 1 - dt * 1.5; rc.d += rc.v * dt; continue; } // cool-down after the flag
      const k = this.idx(rc.d), pf = this.prof[k], here = ((rc.d % L) + L) % L;
      const hw = this.hwAt(rc.d), lim = Math.max(0, hw - rr * 1.1);
      rc.formT -= dt;
      if (rc.formT <= 0) { rc.formT = 1 + r() * 2; rc.form = 0.97 + r() * 0.06; }
      // corner speed depends on grip, straight-line speed on top speed
      const cf = clamp((pf - 0.55) / 0.4, 0, 1);
      let target = pf * (rc.grip + (rc.top - rc.grip) * cf * cf * (3 - 2 * cf)) * rc.form;

      let ahead = null, gap = Infinity;
      for (const o of racing) {
        if (o === rc) continue;
        const g = o.d - rc.d;
        if (g > 0 && g < gap) { gap = g; ahead = o; }
      }
      let latTarget = this.side[k] * hw * 0.45 * (1 - pf), dodge = null; // hug the inside of bends
      // read the road ahead: aim for pads and pickups, steer round trouble.
      // Each hazard gets a fresh ~85% chance per lap of being spotted in time.
      const lap = Math.floor(rc.d / L);
      const spotted = seed => { const v = Math.sin(seed * 12.9898 + lap * 78.233 + rc.alert * 437.58) * 43758.5453; return v - Math.floor(v) < 0.85; };
      const swerve = (cLat, half) => {
        let sgn = rc.lat >= cLat ? 1 : -1;
        if (Math.abs(cLat + sgn * (half + rr * 1.6)) > lim) sgn = -sgn; // go round the side with room
        return clamp(cLat + sgn * (half + rr * 1.6), -lim, lim);
      };
      for (const ft of this.features) {
        const da = (((ft.a0 - here) % L) + L) % L;
        if (ft.kind === 'pad' && da < tw * 3 && rc.greedy > 0.35) latTarget = ft.lat;
        else if (ft.kind === 'oil' && da < tw * 4 && spotted(ft.a0) && Math.abs(rc.lat - ft.lat) < ft.w + rr * 2) dodge = swerve(ft.lat, ft.w);
        else if (ft.kind === 'island' && da < tw * 3) {
          const lane = (hw + ft.w) / 2;
          dodge = (rc.lat >= 0 ? 1 : -1) * lane; // keep to whichever side we're already on
        }
      }
      for (const o of this.obs) {
        const da = (((o.a - here) % L) + L) % L;
        if (da > tw * 3.5) continue;
        if (o.kind === 'item' && !rc.item && rc.greedy > 0.2) {
          let bl = o.lats[0];
          for (let i = 0; i < o.lats.length; i++) if (o.cd[i] <= 0 && Math.abs(o.lats[i] - rc.lat) < Math.abs(bl - rc.lat)) bl = o.lats[i];
          latTarget = bl;
        } else if (o.kind === 'bumpers' && spotted(o.a)) {
          for (const b of o.list) if (Math.abs(rc.lat - b.lat) < o.r + rr * 1.6) dodge = swerve(b.lat, o.r);
        } else if (o.kind === 'rotor' && spotted(o.a) && Math.abs(rc.lat - o.lat) < o.len + rr) dodge = swerve(o.lat, o.len);
        else if (o.kind === 'gate' && spotted(o.a) && da < tw * 2.5 && Math.abs(rc.lat - o.lat) < o.half + rr) dodge = swerve(o.lat, o.half);
      }
      for (const b of this.boulders) {
        const da = this.along(b.d, here);
        if (da > 0 && da < tw * 4 && spotted(b.seed) && Math.abs(rc.lat - b.lat) < b.r + rr * 1.5) dodge = swerve(b.lat, b.r);
      }
      for (const m of this.mines) {
        const da = this.along(m.d, here);
        if (da > 0 && da < tw * 2.5 && m.owner !== rc && spotted(m.seed) && Math.abs(rc.lat - m.lat) < rr * 2.2) dodge = swerve(m.lat, rr * 0.6);
      }
      if (ahead && gap < rr * 9) {
        if (pf > 0.85 && gap < rr * 6) target *= 1.025; // slipstream on the straights
        if (gap < rr * 3 && Math.abs(ahead.lat - rc.lat) < rr * 1.6) {
          // stuck behind: pull out to the side with more room, and lift until clear
          const s = ahead.lat > 0 ? -1 : 1;
          latTarget = ahead.lat + s * rr * 2.2;
          target = Math.min(target, ahead.v / this.vs + 0.03);
        }
      }
      if (dodge !== null) latTarget = dodge; // seeing trouble beats everything else

      // what's under us right now
      const fid = this.featureAt(rc.d), feat = fid >= 0 ? this.features[fid] : null;
      if (feat && rc.h === 0) {
        if (feat.kind === 'pad' && Math.abs(rc.lat - feat.lat) < feat.w + rr * 0.4) {
          if (rc.boost < 0.3) show.event(`${rc.team.name} HITS THE BOOST!`, rc.team.col, true);
          rc.boost = 1.1;
        } else if (feat.kind === 'ramp' && rc.ramp !== fid) {
          rc.ramp = fid;
          rc.vh = (4 * RAMP_APEX * tw) / RAMP_AIR;
          if (rc === this.hero) show.event(`BIG AIR FOR ${rc.team.name}!`, rc.team.col);
        } else if (feat.kind === 'oil' && rc.wide <= 0 && Math.hypot(here - feat.ac, rc.lat - feat.lat) < feat.w + rr * 0.3) {
          rc.wide = 1.1;
          show.event(`${rc.team.name} SLIDES ON THE OIL!`, rc.team.col, !this.onCamera(rc));
          if (rc === this.hero) show.shake(0.4);
        }
      }
      if (!feat || feat.kind !== 'ramp') rc.ramp = -1;
      if (rc.h < tw * 0.3) this.hitObstacles(rc, here);

      if (rc.boost > 0) {
        rc.boost -= dt;
        target *= 1.5;
        const [x, y] = this.pos(rc);
        show.parts.burst(x, y, r() < 0.5 ? 0xff8a2a : 0xffd33a, 2, tw * 0.4, { life: 0.35, white: true, size: 0.9 });
      }
      if (rc.zapT > 0) { rc.zapT -= dt; target *= 0.5; }
      if (rc.shield > 0) rc.shield -= dt;
      rc.hitT = Math.max(0, rc.hitT - dt);
      if (rc.wide > 0) { rc.wide -= dt; rc.spinA += dt * 18; target *= 0.45; latTarget = -this.side[k] * lim; }
      if (rc.item) { rc.itemT -= dt; rc.itemHeld += dt; if (rc.itemT <= 0) this.useItem(rc, racing); }

      const want = target * this.vs;
      const accel = (want > rc.v ? (rc.boost > 0 ? 3 : 1.2) : 3) * this.vs;
      if (rc.h === 0 && rc.vh === 0) rc.v += clamp(want - rc.v, -accel * dt, accel * dt); // no grip in the air
      rc.d += rc.v * dt;
      if (rc.h > 0 || rc.vh > 0) {
        rc.vh -= ((8 * RAMP_APEX * tw) / (RAMP_AIR * RAMP_AIR)) * dt;
        rc.h += rc.vh * dt;
        if (rc.h <= 0) {
          rc.h = 0; rc.vh = 0;
          const [x, y] = this.pos(rc);
          show.parts.burst(x, y, 0xd0c8b8, 16, tw * 1.2, { life: 0.5 });
          if (rc === this.hero) show.shake(0.35);
        }
      } else {
        rc.lat += (clamp(latTarget, -lim, lim) - rc.lat) * Math.min(1, dt * (dodge !== null ? 7 : 4));
      }
      // the track squeezes everyone in where it narrows; dividers are solid
      rc.lat = clamp(rc.lat, -lim, lim);
      const f2 = this.features[this.featureAt(rc.d)];
      if (f2 && f2.kind === 'island' && Math.abs(rc.lat) < f2.w + rr) {
        if (rc.island !== f2 && Math.abs(rc.lat) < f2.w && rc.h === 0) this.knock(rc, 0.4, 0.3, `${rc.team.name} CLIPS THE DIVIDER!`);
        rc.lat = (rc.lat >= 0 ? 1 : -1) * (f2.w + rr);
      }
      rc.island = f2 && f2.kind === 'island' ? f2 : null;

      if (rc.d >= this.total) {
        rc.done = true; rc.time = this.t;
        this.finished.push(rc);
        const [x, y] = this.pos(rc);
        if (this.finished.length === 1) {
          show.event(`${rc.team.name} TAKES THE FLAG!`, rc.team.col, 'urgent');
          show.parts.burst(x, y, rc.team.col, 60, tw * 3, { life: 1, white: true });
          show.shake(0.6);
        } else if (this.finished.length === 2 && rc.time - this.finished[0].time < 0.3) {
          show.banner('PHOTO FINISH!', 0xffffff);
        }
      }
    }
    this.mines = this.mines.filter(m => !m.dead && m.t < 25);

    // contact: racers that touch shove each other apart; rear-enders lose
    // speed, and now and then someone gets spun round
    for (const rc of this.racers) rc.contactT -= dt;
    for (let i = 0; i < racing.length; i++) for (let j = i + 1; j < racing.length; j++) {
      const a = racing[i], b = racing[j];
      if (a.done || b.done || a.h > rr || b.h > rr) continue;
      const dd = b.d - a.d, dl = b.lat - a.lat;
      if (Math.abs(dd) > rr * 2 || Math.abs(dl) > rr * 2) continue;
      const dist = Math.hypot(dd, dl) || 0.01;
      if (dist >= rr * 2) continue;
      const ov = (rr * 2 - dist) / 2 + rr * 0.15, nd = dd / dist, nl = dl / dist;
      a.d -= nd * ov; b.d += nd * ov;
      const la = Math.max(0, this.hwAt(a.d) - rr * 1.1), lb = Math.max(0, this.hwAt(b.d) - rr * 1.1);
      a.lat = clamp(a.lat - nl * ov, -la, la); b.lat = clamp(b.lat + nl * ov, -lb, lb);
      const [rear, front] = dd > 0 ? [a, b] : [b, a];
      if (Math.abs(nd) > 0.6) { rear.v *= 0.9; front.v *= 1.03; }
      if (a.contactT <= 0 || b.contactT <= 0) {
        a.contactT = b.contactT = 0.8;
        const [x1, y1] = this.pos(a), [x2, y2] = this.pos(b), heroIn = a === this.hero || b === this.hero;
        show.parts.burst((x1 + x2) / 2, (y1 + y2) / 2, 0xfff0a0, 12, tw * 1.5, { life: 0.35, white: true });
        if (heroIn) show.shake(0.25);
        if (this.t > 3 && r() < 0.15) {
          const loser = r() < 0.5 ? a : b;
          if (loser.shield <= 0) { loser.wide = 1; show.event(`${loser.team.name} SPINS AFTER CONTACT!`, loser.team.col, !this.onCamera(loser)); }
        } else {
          show.event(`${rear.team.name} BUMPS ${front.team.name}!`, rear.team.col, true);
        }
      }
    }
    for (const rc of this.racers) {
      const [x, y] = this.pos(rc);
      rc.hist.push([x, y]);
      if (rc.hist.length > 12) rc.hist.shift();
    }

    // standings: racers still in, by distance; then those knocked out, most recent first
    const order = [...this.racers].sort((a, b) =>
      a.out !== b.out ? (a.out ? 1 : -1) : a.out ? b.outAt - a.outAt : a.done && b.done ? a.time - b.time : b.d - a.d);
    this.leadHold += dt; this.passHold += dt;
    if (!this.finished.length && this.t > 2) {
      if (order[0] !== this.leader && this.leadHold > 1) {
        show.event(`${order[0].team.name} TAKES THE LEAD!`, order[0].team.col, 'urgent');
        const [x, y] = this.pos(order[0]);
        show.parts.burst(x, y, order[0].team.col, 16, tw * 1.5, { life: 0.5 });
        this.leader = order[0]; this.leadHold = 0; this.passHold = 0;
      } else if (this.passHold > 1.2) {
        for (let i = 1; i < order.length && !order[i].out; i++) {
          const was = this.order.indexOf(order[i]);
          if (was > i && !this.order[i].out) { show.event(`${order[i].team.name} PASSES ${this.order[i].team.name}`, order[i].team.col, !this.onCamera(order[i])); this.passHold = 0; break; }
        }
      }
    }
    if (order[0] !== this.leader && this.leadHold > 1) { this.leader = order[0]; this.leadHold = 0; }
    this.order = order;

    // knockouts: as the leader starts each new lap, the backmarkers are out
    const lapIdx = Math.floor(order[0].d / L);
    if (lapIdx > this.lapDone && lapIdx < this.laps && !this.finished.length) {
      this.lapDone = lapIdx;
      const still = this.racers.filter(x => !x.out).sort((a, b) => a.d - b.d);
      const gone = [];
      for (let i = 0; i < (RACE_CUTS[lapIdx] || 0) && still.length - i > 2; i++) { this.knockOut(still[i]); gone.push(still[i]); }
      if (gone.length) show.event(gone.length > 1 ? `${gone.map(g => g.team.name).join(' AND ')} ARE KNOCKED OUT!` : `${gone[0].team.name} IS KNOCKED OUT!`, gone[0].team.col, 'urgent');
      const left = this.racers.filter(x => !x.out).length;
      if (left === 2) show.banner('FINAL DUEL!', 0xff5050);
      else if (lapIdx === this.laps - 1) show.banner('FINAL LAP!', 0xffd33a);
    }

    // who's currently in the knockout places for the end of this lap
    const cuts = this.finished.length ? 0 : RACE_CUTS[Math.floor(this.order[0].d / L) + 1] || 0;
    const still = this.order.filter(x => !x.out);
    this.danger = new Set(still.length - cuts >= 2 ? still.slice(still.length - cuts) : []);

    this.directCamera(dt);
    this.updateCamera(dt);
    if (this.finished.length) {
      this.endT += dt;
      if (this.endT > 1.4) return this.finished[0].team;
    }
    return null;
  }

  // Solid things on the track: bumpers, spinning bars, sliding gates,
  // pickups, boulders and mines.
  hitObstacles(rc, here) {
    const show = this.show, tw = this.tw, rr = this.rr, r = show.rand;
    for (const o of this.obs) {
      const sd = this.along(here, o.a);
      if (sd < -tw * 1.2 || sd > tw * 1.6) continue;
      if (o.kind === 'bumpers') {
        for (const b of o.list) {
          const bd = this.along(here, b.a), dl = rc.lat - b.lat, dist = Math.hypot(bd, dl);
          if (dist >= o.r + rr) continue;
          const nl = dl / (dist || 1);
          rc.lat = b.lat + nl * (o.r + rr) * (Math.abs(nl) > 0.3 ? 1 : 0) + (Math.abs(nl) > 0.3 ? 0 : (r() < 0.5 ? -1 : 1) * (o.r + rr));
          if (bd < 0) rc.v *= 0.75;
          b.flash = 1;
          if (rc.contactT <= 0) {
            rc.contactT = 0.5;
            const [x, y] = this.pos(rc);
            show.parts.burst(x, y, 0xff4fa8, 10, tw * 1.5, { life: 0.35, white: true });
            show.event(`${rc.team.name} PINBALLS OFF A BUMPER!`, rc.team.col, rc !== this.hero);
            if (rc === this.hero) show.shake(0.2);
          }
        }
      } else if (o.kind === 'rotor') {
        // distance from the racer to the spinning bar (along/lateral space)
        const ex = Math.cos(o.ang) * o.len, el = Math.sin(o.ang) * o.len;
        const px = sd + ex, py = rc.lat - (o.lat - el), vx = 2 * ex, vy = 2 * el;
        const t = clamp((px * vx + py * vy) / (vx * vx + vy * vy || 1), 0, 1);
        const qx = px - t * vx, qy = py - t * vy;
        if (Math.hypot(qx, qy) < rr + o.w && rc.contactT <= 0) {
          rc.contactT = 0.6;
          this.knock(rc, 0.6, 0.45, `${rc.team.name} IS SWATTED BY THE SPINNER!`);
          rc.lat += (qy >= 0 ? 1 : -1) * rr;
          const [x, y] = this.pos(rc);
          show.parts.burst(x, y, 0xffd33a, 14, tw * 1.8, { life: 0.4, white: true });
        }
      } else if (o.kind === 'gate') {
        if (Math.abs(sd) < rr + o.w && rc.lat > o.lat - o.half - rr && rc.lat < o.lat + o.half + rr && rc.contactT <= 0) {
          rc.contactT = 0.6;
          this.knock(rc, 0.85, 0.5, `${rc.team.name} SLAMS INTO THE GATE!`);
          rc.d -= rr * 0.6;
          const [x, y] = this.pos(rc);
          show.parts.burst(x, y, 0xd02828, 16, tw * 1.5, { life: 0.4, white: true });
        }
      } else if (o.kind === 'item' && !rc.item) {
        for (let i = 0; i < o.lats.length; i++) {
          if (o.cd[i] > 0 || Math.abs(sd) > rr + tw * 0.12 || Math.abs(rc.lat - o.lats[i]) > rr + tw * 0.12) continue;
          o.cd[i] = 3;
          // racers further back get the nastier pickups
          const rank = this.order.indexOf(rc) / Math.max(1, this.racers.length - 1);
          const roll = r() * 0.7 + rank * 0.3;
          rc.item = roll < 0.25 ? 'SHIELD' : roll < 0.45 ? 'MINE' : roll < 0.72 ? 'WAVE' : 'ZAP';
          rc.itemT = 0.4 + r() * 1.4; rc.itemHeld = 0;
          const [x, y] = this.pos(rc);
          show.parts.burst(x, y, ITEM_COL[rc.item], 14, tw, { life: 0.4, white: true });
          break;
        }
      }
    }
    for (const b of this.boulders) {
      const bd = this.along(b.d, here);
      if (b.life > 0 && Math.abs(bd) < b.r + rr && Math.hypot(bd, rc.lat - b.lat) < b.r + rr && rc.contactT <= 0) {
        rc.contactT = 0.8;
        this.knock(rc, 0.9, 0.7, `${rc.team.name} IS FLATTENED BY A BOULDER!`);
        rc.lat += (rc.lat >= b.lat ? 1 : -1) * rr;
        b.life = 0; // it shatters
        const [x, y] = this.pos(rc);
        show.parts.burst(x, y, 0xb09070, 30, tw * 2.2, { life: 0.6 });
      }
    }
    for (const m of this.mines) {
      if (m.dead || (m.owner === rc && m.t < 1)) continue;
      if (Math.hypot(this.along(m.d, here), rc.lat - m.lat) < rr + tw * 0.1) {
        m.dead = true;
        if (this.knock(rc, 0.7, 1, `${rc.team.name} HITS ${m.owner.team.name}'S MINE!`)) rc.vh = tw * 2.2;
        const [x, y] = this.pos(rc);
        show.parts.burst(x, y, 0xff5050, 26, tw * 2, { life: 0.5, white: true });
      }
    }
  }

  // Pickups get used when there's someone to use them on (or after a while).
  useItem(rc, racing) {
    const show = this.show, tw = this.tw, rr = this.rr, it = rc.item;
    const others = racing.filter(o => o !== rc);
    const name = rc.team.name, heroNear = Math.abs(this.hero.d - rc.d) < tw * 4;
    if (it === 'SHIELD') {
      rc.shield = 5;
      show.event(`${name} RAISES A SHIELD`, rc.team.col, true);
    } else if (it === 'WAVE') {
      const close = others.filter(o => Math.abs(o.d - rc.d) < tw * 1.7 && Math.abs(o.lat - rc.lat) < tw * 1.3);
      if (!close.length && rc.itemHeld < 5) return;
      const [x, y] = this.pos(rc);
      this.effects.push({ kind: 'wave', x, y, t: 0 });
      let hits = 0;
      for (const o of close) {
        if (!this.knock(o, 0.6, 0.35, null)) continue;
        const lo = Math.max(0, this.hwAt(o.d) - rr * 1.1);
        o.lat = clamp(o.lat + (o.lat >= rc.lat ? 1 : -1) * tw * 0.25, -lo, lo);
        hits++;
      }
      show.event(hits ? `${name}'S SHOCKWAVE HITS ${hits}!` : `${name} UNLEASHES A SHOCKWAVE`, rc.team.col, !hits || !this.onCamera(rc));
      if (heroNear) show.shake(0.3);
    } else if (it === 'ZAP') {
      let target = null;
      for (const o of others) { const g = o.d - rc.d; if (g > 0 && g < tw * 6 && (!target || g < target.d - rc.d)) target = o; }
      if (!target && rc.itemHeld < 5) return;
      if (target) {
        if (this.knock(target, 0.5, 0.3, null)) target.zapT = 1.2;
        rc.boost = Math.max(rc.boost, 0.8);
        this.effects.push({ kind: 'zap', from: rc, to: target, t: 0 });
        show.event(`${name} ZAPS ${target.team.name}!`, rc.team.col, !this.onCamera(rc) && !this.onCamera(target));
      }
    } else if (it === 'MINE') {
      const behind = others.some(o => rc.d - o.d > 0 && rc.d - o.d < tw * 3);
      if (!behind && rc.itemHeld < 4) return;
      this.mines.push({ d: rc.d - rr * 2.5, lat: rc.lat, owner: rc, t: 0, seed: show.rand() * 100 });
      show.event(`${name} DROPS A MINE`, rc.team.col, true);
    }
    rc.item = null;
  }

  // Boulders roll the wrong way down the track, usually towards the racer
  // we're riding with so they're on camera.
  updateBoulders(dt) {
    const show = this.show, r = show.rand, tw = this.tw;
    this.nextBoulder -= dt;
    if (this.nextBoulder <= 0 && this.t > 4 && !this.finished.length) {
      this.nextBoulder = 5 + r() * 4;
      const live = this.racers.filter(x => !x.out && !x.done);
      const target = r() < 0.65 ? this.hero : live[(r() * live.length) | 0] || this.hero;
      const d = target.d + tw * (7 + r() * 3), br = tw * 0.2, hw = this.hwAt(d);
      this.boulders.push({ d, lat: (r() * 2 - 1) * Math.max(0, hw - br) * 0.8, r: br, v: this.vs * 0.35, roll: 0, life: 14, seed: r() * 100 });
      show.event('BOULDER INCOMING!', 0xc8a070, target !== this.hero);
    }
    for (const b of this.boulders) {
      b.d -= b.v * dt; b.roll += (b.v * dt) / b.r; b.life -= dt;
      const lim = Math.max(0, this.hwAt(b.d) - b.r);
      b.lat = clamp(b.lat, -lim, lim);
    }
    this.boulders = this.boulders.filter(b => b.life > 0);
  }

  knockOut(rc) {
    const show = this.show;
    rc.out = true; rc.outT = 0; rc.outAt = this.t;
    const [x, y] = this.pos(rc);
    show.parts.burst(x, y, rc.team.col, 50, this.tw * 3, { life: 1, white: true });
    if (rc === this.hero) this.cutTo(this.closestBattle() || this.order.find(o => !o.out), 'CAMERA: NOW RIDING WITH');
  }
  closestBattle() {
    const live = this.racers.filter(o => !o.out && !o.done).sort((p, q) => q.d - p.d);
    let best = null, bestGap = this.tw * 2.5;
    for (let i = 1; i < live.length; i++) {
      const g = live[i - 1].d - live[i].d;
      if (g < bestGap && live[i] !== this.hero && live[i - 1] !== this.hero) { bestGap = g; best = live[i]; }
    }
    return best;
  }
  cutTo(rc, why) {
    if (!rc) return;
    this.hero = rc; this.camTh = undefined; this.camHold = 0; this.lonely = 0;
    this.show.event(`${why} ${rc.team.name}`, rc.team.col, 'urgent');
  }
  // camera director: if our racer is out on its own, cut to the tightest
  // battle on track and ride with the chaser instead
  directCamera(dt) {
    const tw = this.tw;
    this.camHold += dt;
    this.boostVis += ((this.hero.boost > 0 ? 1 : 0) - this.boostVis) * Math.min(1, dt * 5);
    if (this.finished.length || this.t < 4) return;
    const h = this.hero;
    let near = Infinity;
    for (const o of this.racers) if (o !== h && !o.done && !o.out) near = Math.min(near, Math.abs(o.d - h.d));
    this.lonely = near > tw * 3 ? this.lonely + dt : 0;
    if (this.lonely > 3.5 && this.camHold > 6) this.cutTo(this.closestBattle(), 'CAMERA: NOW RIDING WITH');
  }

  // The intro shows the whole circuit from above; once the lights go out the
  // camera drops in behind the hero.
  draw(rs) {
    if (this.show.phase === 'intro') this.drawOverview(rs);
    else { this.drawChase(rs); this.drawStandings(rs); this.drawMinimap(rs); }
  }
  drawParticles(rs, parts) {
    if (this.show.phase === 'intro') { parts.draw(rs); return; }
    const v = this.view, cap = this.rr * 0.3; // never bigger than a third of a ball at the same distance
    for (const p of parts.list) {
      const dx = p.x - this.camX, dy = p.y - this.camY, z = dx * v.fx + dy * v.fy;
      if (z < this.tw * 1.2) continue; // right in front of the lens: skip rather than blot out the view
      const k = v.f / z, f = Math.min(1, (p.life / p.max) * 1.6);
      const rad = Math.min(p.size * 0.5, cap) * k * (0.5 + 0.5 * f);
      rs.disc(v.cx + (dx * v.rx + dy * v.ry) * k, v.hy + v.camH * k - rad * 1.2, rad, p.col, f);
    }
  }
  drawChase(rs) {
    const { W, H, buf } = rs, th = this.theme, tw = this.tw, u = this.u, L = this.L;
    const hy = Math.round(H * 0.36), camH = tw * CHASE_HEIGHT, back = tw * CHASE_BACK;
    // the view widens a little while our racer is boosting
    const f = Math.min(W * 1.1, ((H * 0.84 - hy) * back) / camH) * (1 - 0.14 * this.boostVis);
    const fx = Math.cos(this.camTh), fy = Math.sin(this.camTh), rx = -fy, ry = fx;
    this.view = { hy, camH, f, fx, fy, rx, ry, cx: W / 2 };
    const fogc = th.sky[1], fr = fogc >> 16, fg = (fogc >> 8) & 255, fb = fogc & 255;

    // sky, stars, and hills on the horizon that swing round as we corner
    for (let y = 0; y < hy; y++) {
      const c = mix(th.sky[0], th.sky[1], Math.pow(y / hy, 1.4));
      for (let x = 0, i = y * W * 3; x < W; x++, i += 3) { buf[i] = c >> 16; buf[i + 1] = (c >> 8) & 255; buf[i + 2] = c & 255; }
    }
    if (th.stars) {
      for (const [a, h, b] of this.stars) {
        const da = angDiff(a, this.camTh);
        if (Math.abs(da) > 1.4) continue;
        rs.disc(W / 2 + Math.tan(da) * f, h * hy * 0.85, Math.max(0.5, 0.35 * u), 0xffffff, b * 0.8);
      }
    }
    const [p0, p1, p2] = this.hills, hill = th.hill;
    for (let x = 0; x < W; x++) {
      const a = this.camTh + Math.atan((x + 0.5 - W / 2) / f);
      const hgt = H * 0.045 * (1.3 + 0.5 * Math.sin(2 * a + p0) + 0.3 * Math.sin(5 * a + p1) + 0.15 * Math.sin(11 * a + p2));
      const top = Math.max(0, Math.round(hy - hgt));
      for (let y = top; y < hy; y++) {
        const c = mix(hill, fogc, 0.25 * (y - top) / Math.max(1, hy - top)), i = (y * W + x) * 3;
        buf[i] = c >> 16; buf[i + 1] = (c >> 8) & 255; buf[i + 2] = c & 255;
      }
    }

    // ground: one map lookup per pixel
    const FW = this.W, FH = this.H, FL = this.fl, FA = this.fa, prof = this.prof;
    const feats = this.features, featAt = this.featAt, hwS = this.hwS, M = this.M, ds = this.ds, d0 = this.d0, fieldR = this.fieldR;
    const lineW = Math.max(0.25, 0.25 * u), sq0 = tw / 8, stripe = 14 * u, kerbLen = 3 * u, band = 4 * u, dash = 3 * u;
    const track2 = scale(th.track, 1.05), verge = scale(th.bg[0], 0.85), islandC = scale(th.bg[0], 0.9);
    const dashC = mix(th.track, th.line, 0.55);
    const fogAt = z => clamp((z - tw * 5) / (tw * 18), 0, 0.94); // also hides shimmer far away
    for (let y = hy; y < H; y++) {
      const z = (camH * f) / (y + 0.5 - hy);
      const fog = fogAt(z);
      const sx = (rx * z) / f, sy = (ry * z) / f;
      let wx = this.camX + fx * z + sx * (0.5 - W / 2), wy = this.camY + fy * z + sy * (0.5 - W / 2);
      for (let x = 0, i = y * W * 3; x < W; x++, i += 3, wx += sx, wy += sy) {
        let c;
        const gx = wx - 0.5, gy = wy - 0.5, ix = Math.floor(gx), iy = Math.floor(gy);
        if (ix >= 0 && iy >= 0 && ix < FW - 1 && iy < FH - 1) {
          const tx = gx - ix, ty = gy - iy, j = iy * FW + ix;
          const lat = (FL[j] * (1 - tx) + FL[j + 1] * tx) * (1 - ty) + (FL[j + FW] * (1 - tx) + FL[j + FW + 1] * tx) * ty;
          const d = Math.abs(lat);
          if (d < fieldR) {
            // lap position, interpolated without tearing at the start line
            const a0 = FA[j];
            let a1 = FA[j + 1], a2 = FA[j + FW], a3 = FA[j + FW + 1];
            if (a1 - a0 > L / 2) a1 -= L; else if (a0 - a1 > L / 2) a1 += L;
            if (a2 - a0 > L / 2) a2 -= L; else if (a0 - a2 > L / 2) a2 += L;
            if (a3 - a0 > L / 2) a3 -= L; else if (a0 - a3 > L / 2) a3 += L;
            const arc = (a0 * (1 - tx) + a1 * tx) * (1 - ty) + (a2 * (1 - tx) + a3 * tx) * ty;
            const a = ((arc % L) + L) % L, aa = a > L / 2 ? a - L : a, s = Math.floor(a / ds) % M, hw = hwS[s];
            if (d < hw) {
              const fid = featAt[s];
              if (fid >= 0) {
                const F = feats[fid];
                if (F.kind === 'pad') {
                  const v = Math.abs(lat - F.lat);
                  if (v < F.w) { // chevrons that scroll forward
                    const ph = (a - F.a0 - v * 0.9) / (tw * 0.2) - this.t * 4;
                    c = ph - Math.floor(ph) < 0.5 ? 0x6ff8ff : 0x1a86b0;
                  }
                } else if (F.kind === 'ramp') { // hazard stripes, lighter towards the lip
                  const sr = (a - F.a0) / (F.a1 - F.a0);
                  c = Math.floor((a - F.a0 + lat * 0.8) / (tw * 0.1)) & 1 ? mix(0x2a2410, 0x605020, sr) : mix(0xc89a10, 0xffe060, sr);
                } else if (F.kind === 'island') { // a grassy divider edged with kerbs
                  if (d < F.w) c = F.w - d < 1.2 * u ? th.kerb[Math.floor(a / kerbLen) & 1] : islandC;
                } else {
                  const du = (a - F.ac) / F.w, dv = (lat - F.lat) / F.w, q = du * du + dv * dv;
                  if (q < 1) c = q > 0.5 && q < 0.68 ? 0x40306a : 0x0b0b12; // glossy slick
                }
              }
              if (c === undefined) {
                const k = Math.floor((((a + d0) % L) + L) % L / ds) % M, sq = (hw * sq0 * 2) / tw;
                if (aa > -sq && aa < sq) c = (Math.floor(aa / sq) + Math.floor(d / sq)) & 1 ? 0xf4f4f4 : 0x141414;
                else if (Math.abs(d - (hw - 0.9 * u)) < lineW) c = th.line;
                else if (d < lineW * 1.3 && Math.floor(a / dash) % 3 === 0 && prof[k] > 0.9 && !(fid >= 0 && feats[fid].kind === 'island')) c = dashC;
                else c = Math.floor(a / band) & 1 ? th.track : track2;
              }
            } else {
              const k = Math.floor((((a + d0) % L) + L) % L / ds) % M, corner = prof[k] < 0.85;
              if (d < hw + 1.6 * u) c = corner ? th.kerb[Math.floor(a / kerbLen) & 1] : verge;
            }
          }
        }
        if (c === undefined) c = th.bg[Math.floor((wx + wy * 0.6) / stripe) & 1];
        buf[i] = (c >> 16) + (fr - (c >> 16)) * fog;
        buf[i + 1] = ((c >> 8) & 255) + (fg - ((c >> 8) & 255)) * fog;
        buf[i + 2] = (c & 255) + (fb - (c & 255)) * fog;
      }
    }

    // everything standing on the track or beside it, far to near
    const rr = this.rr, leader = this.finished[0] || this.leader, far = tw * 24;
    const proj = (x, y) => {
      const dx = x - this.camX, dy = y - this.camY, z = dx * fx + dy * fy;
      if (z < tw * 0.35 || z > far) return null;
      const k = f / z;
      return { z, k, sx: W / 2 + (dx * rx + dy * ry) * k, gy: hy + camH * k, fog: fogAt(z) };
    };
    const wp = (a, lat) => { const p = this.at(a); return [p.x + p.nx * lat, p.y + p.ny * lat]; };
    const sprites = [];
    for (const rc of this.racers) {
      if (rc.out && rc.outT > 0.8) continue;
      const P = proj(...this.pos(rc));
      if (P) sprites.push([P.z, () => this.drawRacer(rs, rc, P, back, fogc, leader)]);
    }
    for (const ar of this.arches) {
      const hw = this.hwAt(ar.a) + tw * 0.25, A = proj(...wp(ar.a, -hw)), B = proj(...wp(ar.a, hw));
      // skip it once the camera is about to pass underneath, or it fills the screen
      if (A && B && Math.min(A.z, B.z) > back * 0.9) sprites.push([(A.z + B.z) / 2, () => this.drawArch(rs, A, B, ar, fogc)]);
    }
    for (const o of this.obs) {
      if (o.kind === 'bumpers') {
        for (const b of o.list) {
          const P = proj(...wp(b.a, b.lat));
          if (!P) continue;
          sprites.push([P.z, () => {
            const rad = o.r * P.k, hgt = tw * 0.16 * P.k, col = mix(mix(0xff4fa8, 0xffffff, b.flash), fogc, P.fog);
            rs.ellipse(P.sx, P.gy, rad * 1.2, rad * 0.4, 0x000000, 0.3);
            rs.rect(P.sx - rad, P.gy - hgt, P.sx + rad, P.gy, scale(col, 0.7));
            rs.ellipse(P.sx, P.gy - hgt, rad, rad * 0.38, col);
            if (b.flash > 0) rs.glow(P.sx, P.gy - hgt, rad * 3, 0xff4fa8, b.flash * 0.6);
          }]);
        }
      } else if (o.kind === 'rotor') {
        const ex = Math.cos(o.ang) * o.len, el = Math.sin(o.ang) * o.len;
        const C = proj(...wp(o.a, o.lat)), A = proj(...wp(o.a + ex, o.lat + el)), B = proj(...wp(o.a - ex, o.lat - el));
        if (!C || !A || !B) continue;
        sprites.push([C.z, () => {
          const hgt = tw * 0.22, bar = mix(0xffd33a, fogc, C.fog);
          rs.line(C.sx, C.gy, C.sx, C.gy - hgt * C.k, Math.max(1, tw * 0.05 * C.k), mix(0x6a7080, fogc, C.fog));
          rs.line(A.sx, A.gy - hgt * A.k, B.sx, B.gy - hgt * B.k, Math.max(1.5, tw * 0.12 * (A.k + B.k) / 2), bar);
          rs.line(A.sx, A.gy - hgt * A.k, B.sx, B.gy - hgt * B.k, Math.max(1, tw * 0.035 * (A.k + B.k) / 2), mix(0x202020, fogc, C.fog));
          rs.disc(C.sx, C.gy - hgt * C.k, Math.max(1, tw * 0.09 * C.k), mix(0xd02828, fogc, C.fog)); // hub
        }]);
      } else if (o.kind === 'gate') {
        const A = proj(...wp(o.a, o.lat - o.half)), B = proj(...wp(o.a, o.lat + o.half));
        if (!A || !B) continue;
        sprites.push([(A.z + B.z) / 2, () => {
          const hgt = tw * 0.32, n = 6;
          for (let i = 0; i < n; i++) {
            const t0 = i / n, t1 = (i + 1) / n;
            const x0 = A.sx + (B.sx - A.sx) * t0, x1 = A.sx + (B.sx - A.sx) * t1, g0 = A.gy + (B.gy - A.gy) * t0, g1 = A.gy + (B.gy - A.gy) * t1;
            const k0 = A.k + (B.k - A.k) * t0, k1 = A.k + (B.k - A.k) * t1;
            rs.poly([[x0, g0], [x1, g1], [x1, g1 - hgt * k1], [x0, g0 - hgt * k0]], mix(i & 1 ? 0xf0f0f0 : 0xd02828, fogc, A.fog));
          }
        }]);
      } else if (o.kind === 'item') {
        o.lats.forEach((lat, i) => {
          if (o.cd[i] > 0) return;
          const P = proj(...wp(o.a, lat));
          if (!P) return;
          sprites.push([P.z, () => {
            const sz = tw * 0.11 * P.k, cy = P.gy - tw * (0.3 + 0.04 * Math.sin(this.t * 4 + i)) * P.k, spin = Math.abs(Math.cos(this.t * 3 + i));
            const col = mix(hsv(this.t * 0.4 + i * 0.33, 0.55, 1), fogc, P.fog);
            rs.ellipse(P.sx, P.gy, sz * 0.8, sz * 0.25, 0x000000, 0.25);
            if (sz < 40 * u) rs.glow(P.sx, cy, sz * 2.5, col, 0.4 * (1 - P.fog));
            rs.poly([[P.sx, cy - sz], [P.sx + sz * Math.max(0.15, spin), cy], [P.sx, cy + sz], [P.sx - sz * Math.max(0.15, spin), cy]], col);
          }]);
        });
      }
    }
    for (const b of this.boulders) {
      const P = proj(...wp(b.d, b.lat));
      if (!P) continue;
      sprites.push([P.z, () => {
        const rad = b.r * P.k, cy = P.gy - rad, col = mix(0x8a7a68, fogc, P.fog);
        rs.ellipse(P.sx, P.gy, rad * 1.1, rad * 0.3, 0x000000, 0.35);
        rs.disc(P.sx, cy, rad, scale(col, 0.75));
        rs.disc(P.sx - rad * 0.1, cy - rad * 0.1, rad * 0.86, col);
        for (let i = 0; i < 3; i++) { // dark patches rolling towards us
          const ang = b.roll + i * 2.1;
          if (Math.cos(ang) > 0) rs.disc(P.sx + (i - 1) * rad * 0.35, cy + Math.sin(ang) * rad * 0.55, rad * 0.16, scale(col, 0.55));
        }
      }]);
    }
    for (const m of this.mines) {
      const P = proj(...wp(m.d, m.lat));
      if (!P) continue;
      sprites.push([P.z, () => {
        const rad = tw * 0.08 * P.k, on = Math.floor(this.t * 6) & 1;
        rs.ellipse(P.sx, P.gy, rad * 1.3, rad * 0.45, 0x1a1a1a);
        rs.disc(P.sx, P.gy - rad * 0.3, rad * 0.5, on ? 0xff3030 : 0x601010);
      }]);
    }
    sprites.sort((a, b) => b[0] - a[0]);
    // shockwave rings lie on the ground, under everything standing on it
    for (const e of this.effects) {
      if (e.kind !== 'wave') continue;
      const R = tw * (0.3 + e.t * 4.5), pts = [];
      for (let i = 0; i <= 28; i++) {
        const P = proj(e.x + Math.cos((i / 28) * TAU) * R, e.y + Math.sin((i / 28) * TAU) * R);
        pts.push(P);
      }
      for (let i = 1; i < pts.length; i++) {
        if (pts[i - 1] && pts[i]) rs.line(pts[i - 1].sx, pts[i - 1].gy, pts[i].sx, pts[i].gy, Math.max(1, tw * 0.06 * pts[i].k), ITEM_COL.WAVE, 1 - e.t / 0.6);
      }
    }
    for (const [, draw] of sprites) draw();
    // zaps crackle between the two racers
    for (const e of this.effects) {
      if (e.kind !== 'zap') continue;
      const A = proj(...this.pos(e.from)), B = proj(...this.pos(e.to));
      if (!A || !B) continue;
      const ay = A.gy - rr * A.k, by = B.gy - rr * B.k;
      let px = A.sx, py = ay;
      for (let i = 1; i <= 7; i++) {
        const t = i / 7, jit = i < 7 ? (Math.sin(this.t * 90 + i * 17) * 0.5) * 6 * u : 0;
        const nx = A.sx + (B.sx - A.sx) * t + jit, ny = ay + (by - ay) * t + jit * 0.5;
        rs.line(px, py, nx, ny, Math.max(1, 0.8 * u), ITEM_COL.ZAP, 1 - e.t / 0.6);
        px = nx; py = ny;
      }
    }

    // speed lines while our racer is boosting
    if (this.boostVis > 0.05) {
      const seed = Math.floor(this.t * 30);
      for (let i = 0; i < 12; i++) {
        const h1 = Math.sin((seed + i * 7.13) * 12.9898) * 43758.5453, rnd = h1 - Math.floor(h1);
        const h2 = Math.sin((seed * 3 + i) * 78.233) * 12345.678, rnd2 = h2 - Math.floor(h2);
        const ang = rnd * TAU, r1 = W * (0.22 + rnd2 * 0.25), r2 = r1 + W * 0.18;
        rs.line(W / 2 + Math.cos(ang) * r1, hy + Math.sin(ang) * r1 * 0.6, W / 2 + Math.cos(ang) * r2, hy + Math.sin(ang) * r2 * 0.6,
          Math.max(1, 0.35 * u), 0xffffff, 0.25 * this.boostVis);
      }
    }
  }
  drawRacer(rs, rc, P, back, fogc, leader) {
    const tw = this.tw, u = this.u, k = P.k, r = this.rr * k, fog = P.fog;
    let col = mix(rc.team.col, fogc, fog);
    if (rc.zapT > 0 && Math.floor(this.t * 20) & 1) col = mix(col, ITEM_COL.ZAP, 0.6);
    if (rc.hitT > 0) col = mix(col, 0xffffff, rc.hitT);
    // anyone between the camera and the hero is drawn as a ghost so they never
    // block the view; knocked-out racers fade away
    const a = (P.z < back * 0.8 ? 0.3 : 1) * (rc.out ? Math.max(0, 1 - rc.outT / 0.8) : 1);
    const cy = P.gy - r * (1.02 + 0.06 * Math.abs(Math.sin(rc.d / (tw * 0.25)))) - rc.h * k;
    const sh = 1 / (1 + rc.h / tw); // shadow shrinks as the ball flies
    if (rc === this.hero) rs.ellipse(P.sx, P.gy, r * 1.6 * sh, r * 0.5 * sh, 0xffffff, 0.22);
    if (this.danger.has(rc)) rs.ellipse(P.sx, P.gy, r * 1.8 * sh, r * 0.56 * sh, 0xff3030, (0.3 + 0.2 * Math.sin(this.t * 8)) * a);
    rs.ellipse(P.sx, P.gy, r * 1.15 * sh, r * 0.32 * sh, 0x000000, 0.35 * (1 - fog) * a);
    if (r < 25 * u) rs.glow(P.sx, cy, r * (rc.boost > 0 ? 3.2 : 2.4), rc.boost > 0 ? 0xffa040 : rc.team.col, (rc.boost > 0 ? 0.5 : 0.25) * (1 - fog) * a);
    rs.disc(P.sx, cy, r, scale(col, 0.55), a);
    rs.disc(P.sx - r * 0.1, cy - r * 0.1, r * 0.82, col, a);
    // the highlight whirls round while a ball is spinning out
    const ha = rc.wide > 0 ? rc.spinA : -2.3;
    rs.disc(P.sx + Math.cos(ha) * r * 0.5, cy + Math.sin(ha) * r * 0.5, r * 0.25, mix(col, 0xffffff, 0.75), 0.85 * a);
    if (rc.shield > 0) rs.ring(P.sx, cy, r * 1.45, Math.max(1, r * 0.12), ITEM_COL.SHIELD, 0.7 * a);
    if (rc.item) rs.disc(P.sx + r * 0.9, cy - r * 0.9, Math.max(0.8, r * 0.22), ITEM_COL[rc.item], a); // holding a pickup
    if (rc === leader) rs.disc(P.sx, cy - r * 1.55, Math.max(0.8, r * 0.22), 0xffe066, a);
    else if (this.danger.has(rc)) rs.disc(P.sx, cy - r * 1.55, Math.max(0.8, r * 0.22), 0xff3030, a * (0.6 + 0.4 * Math.sin(this.t * 8)));
  }
  drawArch(rs, A, B, ar, fogc) {
    const tw = this.tw, hgt = tw * 1.15, fog = (A.fog + B.fog) / 2;
    const t1 = A.gy - hgt * A.k, t2 = B.gy - hgt * B.k, post = mix(0x8a90a0, fogc, fog);
    rs.line(A.sx, A.gy, A.sx, t1, Math.max(1, tw * 0.06 * A.k), post);
    rs.line(B.sx, B.gy, B.sx, t2, Math.max(1, tw * 0.06 * B.k), post);
    // banner: chequered for start/finish, theme stripes otherwise
    const n = 10, bw = Math.max(1, tw * 0.16 * (A.k + B.k) / 2);
    for (let i = 0; i < n; i++) {
      const a = i / n, b = (i + 1) / n;
      const c = ar.start ? (i & 1 ? 0xf4f4f4 : 0x141414) : this.theme.kerb[i & 1];
      rs.line(A.sx + (B.sx - A.sx) * a, t1 + (t2 - t1) * a, A.sx + (B.sx - A.sx) * b, t1 + (t2 - t1) * b, bw, mix(c, fogc, fog));
    }
  }
  drawMinimap(rs) {
    const u = this.u, mw = Math.max(16, this.W * 0.22), s = mw / this.W, mh = this.H * s;
    const ox = rs.W - mw - 2 * u, oy = 2 * u, n = 160;
    rs.rect(ox - u, oy - u, ox + mw + u, oy + mh + u, 0x000000, 0.5);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * this.L, p = this.at(a), q = this.at(((k + 1) / n) * this.L);
      rs.line(ox + p.x * s, oy + p.y * s, ox + q.x * s, oy + q.y * s, Math.max(1, this.hwAt(a) * 2 * s * 0.7), 0xb0b0c0, 0.9);
    }
    const st = this.at(0);
    rs.disc(ox + st.x * s, oy + st.y * s, Math.max(1, 0.6 * u), 0xffffff);
    for (const rc of [...this.racers].sort((a, b) => a.d - b.d)) {
      if (rc.out) continue;
      const [x, y] = this.pos(rc);
      rs.disc(ox + x * s, oy + y * s, Math.max(1.2, 0.8 * u), rc.team.col);
      if (rc === this.hero) rs.ring(ox + x * s, oy + y * s, Math.max(2, 1.6 * u), Math.max(1, 0.35 * u), 0xffffff);
      else if (this.danger.has(rc)) rs.ring(ox + x * s, oy + y * s, Math.max(2, 1.4 * u), Math.max(1, 0.3 * u), 0xff3030);
    }
  }
  // Standings tower: race order top to bottom, our racer highlighted, the
  // knockout places in red, and those already out greyed at the bottom.
  drawStandings(rs) {
    const u = this.u, rowH = Math.max(4, 4.2 * u), rad = Math.max(1.2, 1.4 * u), x0 = 2 * u, y0 = 2 * u;
    const w = rad * 2 + 8 * u, size = rowH * 0.62;
    rs.rect(x0 - u, y0 - u, x0 + w, y0 + this.order.length * rowH + u, 0x000000, 0.45);
    this.order.forEach((rc, i) => {
      const y = y0 + i * rowH + rowH / 2, cx = x0 + 4.5 * u + rad;
      if (this.danger.has(rc)) rs.rect(x0 - u, y - rowH / 2, x0 + w, y + rowH / 2, 0xff3030, 0.28 + 0.12 * Math.sin(this.t * 8));
      if (rc === this.hero) rs.rect(x0 - u, y - rowH / 2, x0 + w, y + rowH / 2, 0xffffff, 0.16);
      if (size >= 5) rs.text(String(i + 1), x0 + 1.6 * u, y, size, rc.out ? 0x60606c : 0xffffff);
      rs.disc(cx, y, rad, rc.out ? 0x3a3a44 : rc.team.col);
      if (rc.out) rs.line(cx - rad * 1.3, y, cx + rad * 1.3, y, Math.max(1, 0.4 * u), 0x9090a0);
      else if (rc.item) rs.disc(cx + rad * 1.7, y, rad * 0.45, ITEM_COL[rc.item]); // holding a pickup
    });
  }
  drawOverview(rs) {
    rs.buf.set(this.bg);
    const rr = this.rr, u = this.u;
    const ranked = this.racers.filter(rc => !rc.out).sort((a, b) => a.d - b.d); // leader drawn last, on top
    for (const rc of ranked) {
      const h = rc.hist;
      for (let i = 1; i < h.length; i++) {
        const f = i / h.length;
        rs.line(h[i - 1][0], h[i - 1][1], h[i][0], h[i][1], rr * 1.4 * f, rc.team.col, 0.5 * f);
      }
    }
    for (const rc of ranked) {
      const [x, y] = this.pos(rc);
      rs.glow(x, y, rr * 3, rc.team.col, 0.3);
      rs.disc(x, y, rr, rc.team.col);
      rs.disc(x - rr * 0.3, y - rr * 0.3, rr * 0.35, mix(rc.team.col, 0xffffff, 0.7), 0.8);
    }
    const ld = this.finished[0] || this.leader;
    if (ld && !ld.out) {
      const [x, y] = this.pos(ld);
      rs.ring(x, y, rr * 1.9 + Math.sin(this.t * 8) * 0.3 * rr, Math.max(1, 0.5 * u), 0xffe066);
    }
  }
  hud() {
    const lap = clamp(Math.floor(this.order[0].d / this.L) + 1, 1, this.laps);
    const pos = this.order.indexOf(this.hero) + 1;
    const segs = [[`LAP ${lap}/${this.laps}  `, 0xffffff], ['● ', this.hero.team.col], [`P${pos}  `, 0xffffff]];
    let marked = false;
    for (const rc of this.order) {
      if (!marked && this.danger.has(rc)) { segs.push(['| ', 0xff5050]); marked = true; }
      segs.push(rc.out ? ['· ', 0x50505c] : ['● ', rc.team.col]);
    }
    return segs;
  }
}

// ESCAPE: balls bounce inside spinning rings. Slip through a ring's gap and
// it shatters. Whoever breaks the last ring escapes and wins.
class Escape {
  constructor(show) { this.show = show; }
  start(W, H, teams) {
    const r = this.show.rand, u = (this.u = this.show.u);
    this.W = W; this.H = H;
    this.cx = W / 2; this.cy = H / 2;
    const Rmax = Math.max(6 * u, Math.min(W / 2, H / 2) - 2 * u);
    const n = clamp(Math.floor((Rmax / u - 4) / 2.4), 3, 14);
    const R0 = Math.max(4 * u, Rmax * 0.26);
    this.rings = [];
    for (let k = 0; k < n; k++) {
      this.rings.push({
        R: R0 + ((Rmax - R0) * k) / (n - 1), th: r() * TAU,
        w: (r() < 0.5 ? -1 : 1) * (0.6 + 0.12 * k + r() * 0.4), gap: 0.45, alive: true, flash: 0,
        col: hsv(0.55 + (k / n) * 0.9, 0.75, 1),
      });
    }
    this.lw = Math.max(1, 0.9 * u);
    this.g = Rmax * 1.3;
    this.br = Math.max(1.2 * u, R0 * 0.16);
    this.minSp = Rmax * 0.9; this.maxSp = Rmax * 2.4;
    this.balls = teams.map(team => {
      const a = r() * TAU, d = r() * R0 * 0.4, va = r() * TAU, sp = R0 * 3;
      return { team, x: this.cx + Math.cos(a) * d, y: this.cy + Math.sin(a) * d, vx: Math.cos(va) * sp, vy: Math.sin(va) * sp, out: false, breaks: 0, hist: [] };
    });
    this.since = 0; this.winner = null; this.endT = 0;
  }
  update(dt) {
    const rand = this.show.rand;
    const sub = 6, h = dt / sub;
    this.since += dt;
    if (this.since > 3.5) for (const rg of this.rings) rg.gap = Math.min(1.5, rg.gap + 0.1 * dt); // stuck? widen the gaps
    for (const rg of this.rings) rg.flash = Math.max(0, rg.flash - dt * 4);
    for (let s = 0; s < sub; s++) {
      for (const rg of this.rings) rg.th += rg.w * h;
      const bi = this.rings.findIndex(rg => rg.alive);
      for (const b of this.balls) {
        b.vy += this.g * h;
        b.x += b.vx * h; b.y += b.vy * h;
        if (bi < 0 || b.out) continue;
        const rg = this.rings[bi];
        const dx = b.x - this.cx, dy = b.y - this.cy, d = Math.hypot(dx, dy) || 0.001;
        if (d + this.br <= rg.R) continue;
        const inGap = Math.abs(angDiff(Math.atan2(dy, dx), rg.th)) < rg.gap - (this.br / rg.R) * 0.5;
        if (inGap) {
          if (d - this.br > rg.R) this.breakRing(bi, b);
          continue;
        }
        const nx = dx / d, ny = dy / d, vn = b.vx * nx + b.vy * ny;
        if (vn > 0) {
          b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny;
          const kick = (rand() - 0.5) * 0.25, c = Math.cos(kick), sn = Math.sin(kick);
          [b.vx, b.vy] = [b.vx * c - b.vy * sn, b.vx * sn + b.vy * c];
          const sp = Math.hypot(b.vx, b.vy), want = clamp(sp * 1.03, this.minSp, this.maxSp);
          b.vx *= want / sp; b.vy *= want / sp;
          rg.flash = 1;
        }
        b.x = this.cx + nx * (rg.R - this.br); b.y = this.cy + ny * (rg.R - this.br);
      }
      // balls knock into each other
      for (let i = 0; i < this.balls.length; i++) for (let j = i + 1; j < this.balls.length; j++) {
        const a = this.balls[i], b = this.balls[j];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d === 0 || d >= this.br * 2) continue;
        const nx = dx / d, ny = dy / d, rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (rel > 0) { a.vx -= rel * nx; a.vy -= rel * ny; b.vx += rel * nx; b.vy += rel * ny; }
        const push = (this.br * 2 - d) / 2;
        a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
      }
    }
    for (const b of this.balls) { b.hist.push([b.x, b.y]); if (b.hist.length > 10) b.hist.shift(); }
    if (this.winner) { this.endT += dt; if (this.endT > 1.2) return this.winner; }
    return null;
  }
  breakRing(i, b) {
    const show = this.show, rg = this.rings[i];
    rg.alive = false;
    b.breaks++;
    this.since = 0;
    for (let k = 0; k < 80; k++) {
      const a = (k / 80) * TAU;
      show.parts.burst(this.cx + Math.cos(a) * rg.R, this.cy + Math.sin(a) * rg.R, rg.col, 1, rg.R * 0.8, { dir: a, spread: 1, life: 0.9 });
    }
    show.shake(0.3 + 0.4 * (i / this.rings.length));
    const left = this.rings.filter(x => x.alive).length;
    if (!left) {
      b.out = true;
      this.winner = b.team;
      show.event(`${b.team.name} BREAKS FREE!`, b.team.col, 'urgent');
      show.parts.burst(b.x, b.y, b.team.col, 70, rg.R, { life: 1.2, white: true });
      show.shake(1);
    } else {
      show.event(`${b.team.name} SMASHES A RING!  ${left} LEFT`, b.team.col);
      if (left === 1) show.banner('LAST RING!', 0xffd33a);
    }
  }
  draw(rs) {
    rs.clear(0x07070d);
    for (const rg of this.rings) {
      if (!rg.alive) continue;
      const col = mix(rg.col, 0xffffff, rg.flash * 0.6);
      rs.ring(this.cx, this.cy, rg.R, this.lw * 2.6, col, 0.16 + rg.flash * 0.2, rg.th, rg.gap);
      rs.ring(this.cx, this.cy, rg.R, this.lw, col, 1, rg.th, rg.gap);
    }
    const br = this.br;
    for (const b of this.balls) {
      const h = b.hist;
      for (let i = 1; i < h.length; i++) {
        const f = i / h.length;
        rs.line(h[i - 1][0], h[i - 1][1], h[i][0], h[i][1], br * 1.4 * f, b.team.col, 0.5 * f);
      }
      rs.glow(b.x, b.y, br * 3.5, b.team.col, 0.35);
      rs.disc(b.x, b.y, br, b.team.col);
      rs.disc(b.x - br * 0.3, b.y - br * 0.3, br * 0.35, mix(b.team.col, 0xffffff, 0.7), 0.8);
    }
  }
  hud() {
    const left = this.rings.filter(x => x.alive).length;
    return [[`RINGS ${left}  `, 0xffffff], ...this.balls.flatMap(b => [['● ', b.team.col], [`${b.breaks}  `, 0xc8c8d8]])];
  }
}

// WAR: each colour's balls paint enemy territory they bounce off. Power-ups
// split balls, drop bombs and add turbo. Last colour on the board wins.
// To make sure it always ends: bigger territory earns more balls (the rich
// get richer), a colour squeezed below 5% collapses (that bar rises in
// overtime), balls speed up in overtime, and after 2.5 minutes sudden death
// knocks out the smallest colour.
class War {
  constructor(show) { this.show = show; }
  start(W, H, teams) {
    const r = this.show.rand;
    // ~320 chunky cells whatever the screen shape, so every bounce visibly
    // bites into the enemy and rounds take about the same time
    const cs = (this.cs = Math.max(2, Math.round(Math.sqrt((W * H) / 320))));
    const gw = (this.gw = Math.max(4, Math.floor(W / cs))), gh = (this.gh = Math.max(4, Math.floor(H / cs)));
    this.ox = Math.floor((W - gw * cs) / 2); this.oy = Math.floor((H - gh * cs) / 2);
    this.teams = teams;
    const n = teams.length;
    this.own = new Uint8Array(gw * gh);
    this.flash = new Float32Array(gw * gh);
    const region = (x, y) => n === 4 ? (x < gw / 2 ? 0 : 1) + (y < gh / 2 ? 0 : 2) : Math.min(n - 1, Math.floor((x / gw) * n));
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) this.own[y * gw + x] = region(x, y);
    this.count = new Array(n).fill(0);
    for (const o of this.own) this.count[o]++;
    this.sp = Math.max(gw, gh) * 0.85;
    this.balls = [];
    for (let i = 0; i < n; i++) {
      let sx = 0, sy = 0, c = 0;
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (this.own[y * gw + x] === i) { sx += x; sy += y; c++; }
      for (let k = 0; k < 2; k++) {
        this.addBall(i, sx / c + 0.5 + (k - 0.5), sy / c + 0.5, Math.PI / 4 + Math.floor(r() * 4) * Math.PI / 2 + (r() - 0.5) * 0.5, Infinity);
      }
    }
    this.turbo = new Array(n).fill(0);
    this.powers = []; this.nextPower = 2 + r() * 2;
    this.t = 0; this.leader = -1; this.leadHold = 0;
    this.budget = 2 * n; this.nextBalance = 2;
    this.overtime = false; this.suddenT = 0;
    this.out = new Array(n).fill(false);
    this.ropes = new Array(n).fill(false);
    this.dom = new Array(n).fill(0); // highest "controls X%" callout made per team
    this.finalTwo = n <= 2;
  }
  randomCell(team) {
    const r = this.show.rand;
    for (let k = 0; k < 400; k++) {
      const i = (r() * this.own.length) | 0;
      if (this.own[i] === team) return i;
    }
    return this.own.indexOf(team);
  }
  // Scale each colour's ball count with its territory (squared, so a lead
  // snowballs). Every colour still alive keeps at least one ball, so nobody
  // sits there defenceless while the leader slowly mops up.
  rebalance() {
    const r = this.show.rand, total = this.gw * this.gh;
    const w = this.count.map((c, i) => (this.out[i] ? 0 : (c / total) ** 2));
    const sw = w.reduce((a, b) => a + b, 0) || 1;
    for (let i = 0; i < this.teams.length; i++) {
      if (this.out[i]) continue;
      const want = Math.max(1, Math.round((this.budget * w[i]) / sw));
      const mine = this.balls.filter(b => b.team === i).sort((a, b) => a.life - b.life);
      for (let k = mine.length; k < want; k++) {
        const c = this.randomCell(i);
        if (c < 0) break;
        const x = (c % this.gw) + 0.5, y = Math.floor(c / this.gw) + 0.5;
        this.addBall(i, x, y, Math.PI / 4 + Math.floor(r() * 4) * Math.PI / 2 + (r() - 0.5) * 0.5, Infinity);
        const [px, py] = this.toPx(x, y);
        this.show.parts.burst(px, py, this.teams[i].col, 14, this.cs * 4, { life: 0.5, white: true });
      }
      for (let k = want; k < mine.length; k++) mine[k - want].life = 0;
    }
    this.balls = this.balls.filter(b => b.life > 0);
  }
  // Knock a colour out: its leftover cells go to whoever borders them.
  wipe(i) {
    const { gw, gh, own } = this, show = this.show;
    this.out[i] = true;
    this.balls = this.balls.filter(b => b.team !== i);
    for (let pass = 0; pass < gw + gh && this.count[i] > 0; pass++) {
      for (let c = 0; c < own.length; c++) {
        if (own[c] !== i) continue;
        const x = c % gw, y = (c / gw) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const o = own[ny * gw + nx];
          if (o !== i && !this.out[o]) { this.convert(c, o); break; }
        }
      }
    }
    const t = this.teams[i];
    show.event(`${t.name} COLLAPSES!`, t.col, 'urgent');
    show.shake(0.7);
    show.parts.burst(this.ox + (gw * this.cs) / 2, this.oy + (gh * this.cs) / 2, t.col, 80, this.cs * 12, { life: 1 });
  }
  addBall(team, x, y, a, life) {
    this.balls.push({ team, x, y, vx: Math.cos(a), vy: Math.sin(a), life, hist: [] });
  }
  convert(i, team) {
    const was = this.own[i];
    if (was === team) return;
    this.own[i] = team; this.flash[i] = 1;
    this.count[was]--; this.count[team]++;
  }
  update(dt) {
    const show = this.show, r = show.rand, { gw, gh, own } = this;
    this.t += dt;
    for (let i = 0; i < this.flash.length; i++) if (this.flash[i] > 0) this.flash[i] = Math.max(0, this.flash[i] - dt * 3);
    for (let i = 0; i < this.turbo.length; i++) this.turbo[i] -= dt;
    if (!this.overtime && this.t > 45) { this.overtime = true; show.banner('OVERTIME!', 0xff5050); }
    const rush = 1 + clamp((this.t - 45) * 0.012, 0, 1); // overtime speed-up, up to 2x

    const rad = 0.42;
    for (const b of this.balls) {
      b.life -= dt;
      const sp = this.sp * rush * (this.turbo[b.team] > 0 ? 1.7 : 1);
      const steps = Math.max(1, Math.ceil((sp * dt) / 0.35)), h = (sp * dt) / steps;
      for (let s = 0; s < steps; s++) {
        const nx = b.x + b.vx * h;
        const cx = Math.floor(nx + Math.sign(b.vx) * rad), cy = Math.floor(b.y);
        if (cx < 0 || cx >= gw) b.vx = -b.vx;
        else if (cy >= 0 && cy < gh && own[cy * gw + cx] !== b.team) { this.convert(cy * gw + cx, b.team); b.vx = -b.vx; }
        else b.x = nx;
        const ny = b.y + b.vy * h;
        const cx2 = Math.floor(b.x), cy2 = Math.floor(ny + Math.sign(b.vy) * rad);
        if (cy2 < 0 || cy2 >= gh) b.vy = -b.vy;
        else if (cx2 >= 0 && cx2 < gw && own[cy2 * gw + cx2] !== b.team) { this.convert(cy2 * gw + cx2, b.team); b.vy = -b.vy; }
        else b.y = ny;
        const here = clamp(Math.floor(b.y), 0, gh - 1) * gw + clamp(Math.floor(b.x), 0, gw - 1);
        if (own[here] !== b.team) this.convert(here, b.team);
      }
      b.hist.push([b.x, b.y]); if (b.hist.length > 7) b.hist.shift();
    }
    this.balls = this.balls.filter(b => b.life > 0);

    // power-ups
    this.nextPower -= dt;
    if (this.nextPower <= 0) {
      this.nextPower = (2 + r() * 2) / rush;
      this.powers.push({ x: 2 + r() * (gw - 4), y: 2 + r() * (gh - 4), kind: ['SPLIT', 'BOMB', 'TURBO'][(r() * 3) | 0], t: 0 });
    }
    for (const p of this.powers) {
      p.t += dt;
      const b = this.balls.find(bb => Math.hypot(bb.x - p.x, bb.y - p.y) < 1.6);
      if (!b) continue;
      p.taken = true;
      const team = this.teams[b.team], [px, py] = this.toPx(p.x, p.y);
      show.parts.burst(px, py, team.col, 40, this.cs * 9, { life: 0.8, white: true });
      if (p.kind === 'SPLIT') {
        const a = Math.atan2(b.vy, b.vx);
        this.addBall(b.team, b.x, b.y, a + 2.1, 8);
        this.addBall(b.team, b.x, b.y, a - 2.1, 8);
        show.event(`${team.name} SPLITS INTO THREE!`, team.col);
      } else if (p.kind === 'BOMB') {
        const R = Math.max(3, Math.min(gw, gh) * 0.14);
        for (let y = Math.floor(p.y - R); y <= p.y + R; y++) for (let x = Math.floor(p.x - R); x <= p.x + R; x++) {
          if (x >= 0 && y >= 0 && x < gw && y < gh && Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) <= R) this.convert(y * gw + x, b.team);
        }
        show.parts.burst(px, py, team.col, 60, this.cs * R * 3, { life: 0.7 });
        show.shake(0.7);
        show.event(`${team.name} DROPS A BOMB!`, team.col);
      } else {
        this.turbo[b.team] = 5;
        show.event(`${team.name} GOES TURBO!`, team.col);
      }
    }
    this.powers = this.powers.filter(p => !p.taken);

    const total = gw * gh;
    // a colour squeezed below this share collapses; the bar rises in overtime
    const collapse = 0.05 + clamp((this.t - 45) * 0.002, 0, 0.2);
    for (let i = 0; i < this.teams.length; i++) {
      if (this.out[i]) continue;
      const share = this.count[i] / total, t = this.teams[i];
      if (!this.ropes[i] && share < collapse + 0.05) { this.ropes[i] = true; show.event(`${t.name} IS ON THE ROPES!`, t.col); }
      if (share > collapse + 0.1) this.ropes[i] = false;
      if (share < collapse && this.out.filter(o => !o).length > 1) this.wipe(i);
      for (const mark of [50, 75, 90]) {
        if (share * 100 >= mark && this.dom[i] < mark) {
          this.dom[i] = mark;
          if (this.t > 2) show.event(`${t.name} CONTROLS ${mark}% OF THE BOARD!`, t.col);
        }
      }
    }
    // sudden death: past 2.5 minutes, the smallest colour goes every 8 seconds
    if (this.t > 150) {
      this.suddenT -= dt;
      if (this.suddenT <= 0) {
        this.suddenT = 8;
        let lo = -1;
        for (let i = 0; i < this.count.length; i++) if (!this.out[i] && (lo < 0 || this.count[i] < this.count[lo])) lo = i;
        show.banner('SUDDEN DEATH!', 0xff5050);
        this.wipe(lo);
      }
    }
    this.nextBalance -= dt;
    if (this.nextBalance <= 0) { this.nextBalance = 2; this.rebalance(); }

    let best = -1;
    for (let i = 0; i < this.count.length; i++) if (!this.out[i] && (best < 0 || this.count[i] > this.count[best])) best = i;
    this.leadHold += dt;
    if (best !== this.leader) {
      if (this.leader >= 0 && this.leadHold > 0.8) show.event(`${this.teams[best].name} TAKES THE LEAD!`, this.teams[best].col);
      this.leader = best; this.leadHold = 0;
    }
    const alive = this.out.filter(o => !o).length;
    if (!this.finalTwo && alive === 2) { this.finalTwo = true; show.banner('FINAL TWO!', 0xffd33a); }
    if (alive === 1) return this.teams[best];
    return null;
  }
  toPx(x, y) { return [this.ox + x * this.cs, this.oy + y * this.cs]; }
  draw(rs) {
    rs.clear(0x06060b);
    const { gw, gh, cs, ox, oy, own, flash } = this;
    const gap = cs >= 6 ? Math.max(1, Math.round(cs * 0.06)) : 0;
    const base = this.teams.map(t => [scale(t.col, 0.36), scale(t.col, 0.31)]);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const i = y * gw + x, t = own[i];
      let c = base[t][(x + y) & 1];
      if (flash[i] > 0) c = mix(c, mix(this.teams[t].col, 0xffffff, 0.3), flash[i]);
      rs.rect(ox + x * cs + gap, oy + y * cs + gap, ox + (x + 1) * cs, oy + (y + 1) * cs, c);
    }
    for (const p of this.powers) {
      const [px, py] = this.toPx(p.x, p.y);
      const pulse = 0.5 + 0.5 * Math.sin(p.t * 10);
      rs.glow(px, py, cs * 2.5, 0xffd33a, 0.5 + 0.3 * pulse);
      rs.disc(px, py, cs * 0.45, mix(0xffd33a, 0xffffff, pulse));
      rs.ring(px, py, cs * (1 + 0.3 * pulse), Math.max(1, cs * 0.1), 0xffd33a);
    }
    for (const b of this.balls) {
      const col = this.teams[b.team].col, bright = mix(col, 0xffffff, 0.35);
      const h = b.hist;
      for (let i = 1; i < h.length; i++) {
        const [ax, ay] = this.toPx(h[i - 1][0], h[i - 1][1]), [bx, by] = this.toPx(h[i][0], h[i][1]);
        rs.line(ax, ay, bx, by, cs * 0.6 * (i / h.length), bright, 0.4 * (i / h.length));
      }
      const [px, py] = this.toPx(b.x, b.y);
      rs.glow(px, py, cs * 1.4, col, 0.45);
      rs.disc(px, py, cs * 0.42, bright);
      if (this.turbo[b.team] > 0) rs.ring(px, py, cs * 0.75, Math.max(1, cs * 0.08), 0xffffff);
    }
  }
  hud() {
    const total = this.gw * this.gh, s = Math.floor(this.t);
    const segs = [[`${this.overtime ? 'OVERTIME ' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}  `, this.overtime ? 0xff7070 : 0xffffff]];
    this.teams.forEach((t, i) => segs.push(['● ', this.out[i] ? 0x50505c : t.col], [this.out[i] ? 'OUT  ' : `${Math.round((this.count[i] / total) * 100)}%  `, 0xc8c8d8]));
    return segs;
  }
}

// HUNT: blobs of five colours roam an arena. Contact between rivals costs
// both of them (each loses mass in proportion to the other's size), so the
// bigger one wins the exchange but pays for it, and fights only make sense
// with a real size advantage. Blobs grow by swallowing grey neutral drifters
// whole, plus food and golden orbs; from 15 s a closing zone herds everyone
// together and drains anyone caught outside. Last colour left, or the most
// mass when time runs out, wins.
class Hunt {
  constructor(show) { this.show = show; }
  start(W, H, teams) {
    const r = this.show.rand, u = (this.u = this.show.u);
    this.W = W; this.H = H; this.teams = teams;
    this.k = Math.max(0.6, Math.min(W, H) * 0.02);
    this.speed = Math.min(W, H) * 0.45;
    this.zone = { x: W / 2, y: H / 2, r0: Math.hypot(W, H) / 2 + 2 * u, rMin: Math.min(W, H) * 0.12 };
    this.zone.r = this.zone.r0;
    this.blobs = [];
    const per = (W * H) / (u * u) > 6000 ? 4 : 3;
    teams.forEach((team, ti) => {
      for (let i = 0; i < per; i++) {
        this.blobs.push({
          team, ti, x: 3 * u + r() * (W - 6 * u), y: 3 * u + r() * (H - 6 * u), vx: 0, vy: 0,
          m: 2 + r() * 1.5, alive: true, wander: r() * TAU, hit: 0, drainT: 0, drainBy: null, clashT: 0, prey: null, chase: 0,
        });
      }
    });
    this.pellets = [];
    this.maxPellets = clamp(Math.round((W * H) / (70 * u * u)), 15, 260);
    for (let i = 0; i < this.maxPellets; i++) this.addPellet();
    this.orbs = []; this.nextOrb = 4;
    this.neutrals = [];
    this.maxNeutrals = clamp(Math.round((W * H) / (480 * u * u)), 8, 26);
    for (let i = 0; i < this.maxNeutrals; i++) this.addNeutral();
    this.time = 60; this.lastSec = 99; this.t = 0; this.zoneOn = false;
    this.out = new Set();
  }
  inZone(x, y, margin = 0) { return Math.hypot(x - this.zone.x, y - this.zone.y) < this.zone.r - margin; }
  spawnPoint(margin) {
    const r = this.show.rand, u = this.u;
    for (let k = 0; k < 40; k++) {
      const x = u + r() * (this.W - 2 * u), y = u + r() * (this.H - 2 * u);
      if (this.inZone(x, y, margin)) return [x, y];
    }
    const a = r() * TAU, d = r() * Math.max(0, this.zone.r - margin);
    return [this.zone.x + Math.cos(a) * d, this.zone.y + Math.sin(a) * d];
  }
  addPellet() {
    const [x, y] = this.spawnPoint(this.u);
    this.pellets.push({ x, y, ph: this.show.rand() * TAU });
  }
  addNeutral() {
    const r = this.show.rand, [x, y] = this.spawnPoint(3 * this.u);
    this.neutrals.push({ x, y, vx: 0, vy: 0, m: 0.8 + r() * 1.8, wander: r() * TAU, ph: r() * TAU });
  }
  rad(b) { return Math.sqrt(b.m) * this.k; }
  update(dt) {
    const show = this.show, r = show.rand, u = this.u, z = this.zone;
    this.t += dt;
    this.time -= dt;
    if (this.t > 15) {
      if (!this.zoneOn) { this.zoneOn = true; show.banner('ZONE CLOSING!', 0xff4060); }
      z.r = z.r0 + (z.rMin - z.r0) * smooth01((this.t - 15) / 27);
    }
    this.pellets = this.pellets.filter(p => this.inZone(p.x, p.y));
    if (this.pellets.length < this.maxPellets && r() < dt * 10) this.addPellet();
    this.nextOrb -= dt;
    if (this.nextOrb <= 0 && this.time > 4) {
      this.nextOrb = 5 + r() * 3;
      const [x, y] = this.spawnPoint(4 * u);
      this.orbs.push({ x, y, t: 0 });
      show.event('A GOLDEN ORB APPEARS!', 0xffd33a);
    }
    for (const o of this.orbs) o.t += dt;

    const live = this.blobs.filter(b => b.alive);
    const sense = Math.min(this.W, this.H) * 0.45;
    // neutral drifters wander, edge away from anything big enough to eat them,
    // and keep inside the zone
    if (this.neutrals.length < this.maxNeutrals && r() < dt * 2.5) this.addNeutral();
    for (const n of this.neutrals) {
      n.wander += (r() - 0.5) * dt * 2;
      let ax = Math.cos(n.wander), ay = Math.sin(n.wander);
      for (const b of live) {
        const d = Math.hypot(n.x - b.x, n.y - b.y) || 1;
        if (b.m > n.m * 1.1 && d < sense * 0.35) { ax += ((n.x - b.x) / d) * 2; ay += ((n.y - b.y) / d) * 2; }
      }
      const zd = Math.hypot(n.x - z.x, n.y - z.y) || 1;
      if (zd > z.r - 4 * u) { ax += ((z.x - n.x) / zd) * 3; ay += ((z.y - n.y) / zd) * 3; }
      const al = Math.hypot(ax, ay) || 1, vmax = (this.speed * 0.55) / (1 + 0.3 * Math.sqrt(n.m));
      n.vx += ((ax / al) * vmax - n.vx) * Math.min(1, dt * 2);
      n.vy += ((ay / al) * vmax - n.vy) * Math.min(1, dt * 2);
      n.x = clamp(n.x + n.vx * dt, 0, this.W); n.y = clamp(n.y + n.vy * dt, 0, this.H);
    }
    for (const b of live) {
      b.hit = Math.max(0, b.hit - dt * 4);
      b.clashT -= dt;
      // The bigger blob always wins a contact fight, so anything we outweigh is
      // fair game, and we only run from rivals that are clearly bigger (and
      // close), not ones that merely look about our size.
      let threat = null, prey = null, td = Infinity, pd = Infinity, best = null, bestScore = 0;
      for (const o of live) {
        if (o.ti === b.ti) continue;
        const d = Math.hypot(o.x - b.x, o.y - b.y);
        if (d > sense) continue;
        if (o.m > b.m * 1.6 && d < td) { td = d; threat = o; }
        if (b.m > o.m * 1.1) {
          const edge = Math.min(2, b.m / o.m - 1) + 0.4;
          let s = (o.m * 3 * edge) / (d + u);
          if (o === b.prey) s *= 1.6; // stay committed to a chase already under way
          if (s > bestScore) { bestScore = s; best = o; prey = o; pd = d; }
        }
      }
      for (const n of this.neutrals) {
        if (b.m <= n.m * 1.1) continue;
        const s = (n.m * 1.5) / (Math.hypot(n.x - b.x, n.y - b.y) + u);
        if (s > bestScore) { bestScore = s; best = n; prey = null; }
      }
      for (const o of this.orbs) { const s = 8 / (Math.hypot(o.x - b.x, o.y - b.y) + u); if (s > bestScore) { bestScore = s; best = o; prey = null; } }
      let near = null, nd = Infinity;
      for (const p of this.pellets) { const d = Math.abs(p.x - b.x) + Math.abs(p.y - b.y); if (d < nd) { nd = d; near = p; } }
      if (near && 0.3 / (nd + u) > bestScore) { best = near; prey = null; }

      let ax, ay;
      // flee only from a clearly bigger rival that's close, and not when our own
      // prey is right in front of us
      if (threat && td < sense * 0.35 && !(prey && pd < td * 0.6)) {
        ax = b.x - threat.x; ay = b.y - threat.y;
        const m = 4 * u, push = 6 * u; // slide along walls rather than into them
        if (b.x < m) ax += push; if (b.x > this.W - m) ax -= push;
        if (b.y < m) ay += push; if (b.y > this.H - m) ay -= push;
      } else if (best) { ax = best.x - b.x; ay = best.y - b.y; }
      else { b.wander += (r() - 0.5) * dt * 3; ax = Math.cos(b.wander); ay = Math.sin(b.wander); }
      let al = Math.hypot(ax, ay) || 1;
      ax /= al; ay /= al;
      // the zone always wins: get back inside
      const zd = Math.hypot(b.x - z.x, b.y - z.y);
      if (zd > z.r - 3 * u) {
        const pull = clamp((zd - (z.r - 3 * u)) / (3 * u), 0, 2);
        ax += ((z.x - b.x) / zd) * pull; ay += ((z.y - b.y) / zd) * pull;
        al = Math.hypot(ax, ay) || 1; ax /= al; ay /= al;
      }
      // remember chases so escapes can be called out
      if (prey && prey === b.prey) b.chase += dt;
      else {
        if (b.prey && b.prey.alive && b.chase > 2.5) show.event(`${b.prey.team.name} OUTRUNS ${b.team.name}!`, b.prey.team.col, true);
        b.prey = prey; b.chase = 0;
      }
      // size only costs a little speed, and hunters lunge when they get close
      let vmax = (this.speed * 1.5) / (1 + 0.15 * Math.sqrt(b.m));
      if (prey && pd < this.rad(b) * 3) vmax *= 1.3;
      b.vx += (ax * vmax - b.vx) * Math.min(1, dt * 3);
      b.vy += (ay * vmax - b.vy) * Math.min(1, dt * 3);
      b.x += b.vx * dt; b.y += b.vy * dt;
      const rr = this.rad(b);
      if (b.x < rr) { b.x = rr; b.vx = Math.abs(b.vx); }
      if (b.x > this.W - rr) { b.x = this.W - rr; b.vx = -Math.abs(b.vx); }
      if (b.y < rr) { b.y = rr; b.vy = Math.abs(b.vy); }
      if (b.y > this.H - rr) { b.y = this.H - rr; b.vy = -Math.abs(b.vy); }
      if (!this.inZone(b.x, b.y)) {
        b.m -= dt * 1.2;
        if (r() < dt * 8) show.parts.burst(b.x, b.y, 0xff4060, 1, this.speed * 0.3, { life: 0.4 });
      }
      if (b.m > 10) b.m -= b.m * 0.01 * dt;
      this.pellets = this.pellets.filter(p => {
        if (Math.hypot(p.x - b.x, p.y - b.y) > rr + 0.6 * u) return true;
        b.m += 0.25;
        return false;
      });
      this.orbs = this.orbs.filter(o => {
        if (Math.hypot(o.x - b.x, o.y - b.y) > rr + u) return true;
        b.m += 6;
        show.event(`${b.team.name} GRABS THE GOLD!`, b.team.col);
        show.parts.burst(o.x, o.y, 0xffd33a, 40, this.speed, { life: 0.8, white: true });
        return false;
      });
      this.neutrals = this.neutrals.filter(n => {
        const d = Math.hypot(n.x - b.x, n.y - b.y);
        if (d > rr) return true;
        if (b.m <= n.m * 1.1) { // too small to swallow it: bounce off
          b.vx += ((b.x - n.x) / (d || 1)) * this.speed * 0.5;
          b.vy += ((b.y - n.y) / (d || 1)) * this.speed * 0.5;
          return true;
        }
        b.m += n.m;
        show.parts.burst(n.x, n.y, 0xc8ccd8, 14, this.speed * 0.6, { life: 0.5 });
        if (n.m > 2) show.event(`${b.team.name} SWALLOWS A BIG DRIFTER!`, b.team.col, true);
        return false;
      });
    }

    // fights: contact costs both blobs, each in proportion to the other's
    // size. Bits of both fly off; nobody gains anything from a fight.
    const touching = new Set();
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      if (!a.alive || !b.alive || a.ti === b.ti) continue;
      const ra = this.rad(a), rb = this.rad(b), dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01;
      if (d > ra + rb * 0.6 && d > rb + ra * 0.6) continue;
      a.m -= dt * (0.5 + 0.35 * b.m); b.m -= dt * (0.5 + 0.35 * a.m);
      a.hit = b.hit = 1;
      const nx = dx / d, ny = dy / d;
      for (const [o, sgn] of [[a, -1], [b, 1]]) {
        if (show.rand() < 0.6) show.parts.burst(o.x, o.y, o.team.col, 1, this.speed * 0.7, { dir: Math.atan2(ny * sgn, nx * sgn), spread: 1.6, life: 0.4 });
      }
      const even = Math.max(a.m, b.m) < Math.min(a.m, b.m) * 1.25;
      const kick = this.speed * (even ? 0.8 : 0.15); // evenly matched blobs bounce apart
      a.vx -= nx * kick; a.vy -= ny * kick; b.vx += nx * kick; b.vy += ny * kick;
      const small = a.m < b.m ? a : b;
      small.drainT += dt; small.drainBy = small === a ? b : a; touching.add(small);
      if (even && a.clashT <= 0 && b.clashT <= 0) {
        a.clashT = b.clashT = 2;
        show.event(`${a.team.name} AND ${b.team.name} CLASH!`, 0xffffff, true);
        show.parts.burst((a.x + b.x) / 2, (a.y + b.y) / 2, 0xffffff, 16, this.speed, { life: 0.4 });
      }
      if (a.m < 0.6) this.pop(b, a);
      if (b.m < 0.6 && b.alive) this.pop(a, b);
    }
    for (const b of live) {
      if (b.alive && b.drainT > 0.8 && !touching.has(b)) {
        show.event(`${b.team.name} BREAKS FREE FROM ${b.drainBy.team.name}!`, b.team.col, true);
      }
      if (!touching.has(b)) { b.drainT = 0; b.drainBy = null; }
      if (b.alive && b.m < 0.6) this.pop(null, b); // shrank away in the zone
    }

    const sec = Math.ceil(this.time);
    if (sec <= 5 && sec >= 1 && sec !== this.lastSec) { this.lastSec = sec; show.banner(String(sec), 0xffffff, 0.8); }
    const alive = this.teams.filter((_, i) => !this.out.has(i));
    if (alive.length === 1) return alive[0];
    if (this.time <= 0) {
      let best = null, bm = -1;
      this.teams.forEach((t, i) => { const m = this.mass(i); if (m > bm) { bm = m; best = t; } });
      return best;
    }
    return null;
  }
  pop(by, b) {
    const show = this.show;
    b.alive = false;
    show.parts.burst(b.x, b.y, b.team.col, 30, this.speed, { life: 0.6, white: true });
    if (!this.blobs.some(o => o.alive && o.ti === b.ti)) {
      this.out.add(b.ti);
      show.event(`${b.team.name} IS ELIMINATED!`, b.team.col, 'urgent');
      show.shake(0.6);
    } else {
      show.event(by ? `${by.team.name} POPS ${b.team.name}!` : `${b.team.name} FADES IN THE ZONE`, by ? by.team.col : b.team.col);
      show.shake(0.2);
    }
  }
  mass(ti) { return this.blobs.reduce((s, b) => s + (b.alive && b.ti === ti ? b.m : 0), 0); }
  draw(rs) {
    const u = this.u, z = this.zone;
    rs.clear(0x090b12);
    const step = 8 * u;
    for (let y = step / 2; y < this.H; y += step) for (let x = step / 2; x < this.W; x += step) rs.disc(x, y, 0.35 * u, 0x1a1f2e);
    for (const p of this.pellets) rs.disc(p.x, p.y, 0.5 * u, hsv(p.ph / TAU, 0.45, 1), 0.55 + 0.35 * Math.sin(this.t * 3 + p.ph));
    for (const o of this.orbs) {
      const pulse = 0.5 + 0.5 * Math.sin(o.t * 8);
      rs.glow(o.x, o.y, 5 * u, 0xffd33a, 0.5 + 0.3 * pulse);
      rs.disc(o.x, o.y, 1.3 * u, mix(0xffd33a, 0xffffff, pulse * 0.6));
      rs.ring(o.x, o.y, (2 + pulse) * u, Math.max(1, 0.3 * u), 0xffd33a, 0.8);
    }
    for (const n of this.neutrals) {
      const rr = this.rad(n), wob = 1 + 0.06 * Math.sin(this.t * 3 + n.ph);
      rs.disc(n.x, n.y, rr * wob, 0x767c92);
      rs.disc(n.x, n.y, rr * 0.82 * wob, 0xc4cadc);
      rs.disc(n.x - rr * 0.3, n.y - rr * 0.3, rr * 0.25, 0xe8ecf8, 0.6);
    }
    const live = this.blobs.filter(b => b.alive).sort((a, b) => a.m - b.m);
    for (const b of live) {
      const rr = this.rad(b), col = mix(b.team.col, 0xffffff, b.hit * 0.5);
      rs.glow(b.x, b.y, rr * 2, b.team.col, 0.18);
      rs.disc(b.x, b.y, rr, scale(col, 0.62));
      rs.disc(b.x, b.y, rr * 0.84, col);
      rs.disc(b.x - rr * 0.3, b.y - rr * 0.3, rr * 0.3, mix(col, 0xffffff, 0.7), 0.7);
    }
    const big = live[live.length - 1];
    if (big) rs.ring(big.x, big.y, this.rad(big) + 1.5 * u + Math.sin(this.t * 6) * 0.4 * u, Math.max(1, 0.45 * u), 0xffe066);
    if (this.zoneOn) {
      // darken everything outside the zone and draw its glowing edge
      const buf = rs.buf, W = this.W, H = this.H, r2 = z.r * z.r;
      for (let y = 0; y < H; y++) {
        const dy = y + 0.5 - z.y;
        for (let x = 0, i = y * W * 3; x < W; x++, i += 3) {
          const dx = x + 0.5 - z.x;
          if (dx * dx + dy * dy > r2) { buf[i] = buf[i] * 0.45 + 18; buf[i + 1] *= 0.4; buf[i + 2] = buf[i + 2] * 0.45 + 8; }
        }
      }
      rs.ring(z.x, z.y, z.r, Math.max(1, 2.5 * u), 0xff4060, 0.25);
      rs.ring(z.x, z.y, z.r, Math.max(1, 0.7 * u), 0xff6080);
    }
  }
  hud() {
    const segs = [[`${this.zoneOn ? 'ZONE  ' : ''}0:${String(Math.max(0, Math.ceil(this.time))).padStart(2, '0')}  `, this.zoneOn ? 0xff8090 : 0xffffff]];
    this.teams.forEach((t, i) => segs.push(['● ', this.out.has(i) ? 0x50505c : t.col], [this.out.has(i) ? 'OUT  ' : `${Math.round(this.mass(i))}  `, 0xc8c8d8]));
    return segs;
  }
}
function smooth01(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }

const ROUNDS = {
  race: { cls: Race, title: 'RACE', sub: 'FIVE LAPS. THE LAST PLACES ARE KNOCKED OUT EACH LAP.', teams: 8 },
  escape: { cls: Escape, title: 'ESCAPE', sub: 'SMASH THROUGH THE GAPS. LAST RING OUT WINS.', teams: 4 },
  war: { cls: War, title: 'COLOR WAR', sub: 'TAKE OVER THE WHOLE BOARD TO WIN.', teams: 4 },
  hunt: { cls: Hunt, title: 'HUNT', sub: 'CONTACT HURTS BOTH. SWALLOW THE GREY DRIFTERS TO GROW.', teams: 5 },
};

// ───────────────────────────── the show ─────────────────────────────

class Show {
  constructor(seed, only) {
    this.rand = mulberry32(seed);
    this.only = only;
    this.parts = new Particles(this.rand); // in the round's world (the race projects these into 3D)
    this.fx = new Particles(this.rand);    // flat on the screen (confetti)
    this.wins = new Map();
    this.queue = [];
    this.ticker = null; this.big = null;
    this.shakeT = 0;
    this.t = 0;
  }
  // Callouts are paced so they can be read: minor ones only show when the
  // ticker has been quiet for a while, normal ones never replace a callout
  // that's barely appeared, and urgent ones (knockouts, lead changes, winners)
  // always show.
  event(text, col, level = false) {
    const age = this.ticker ? 2.8 - this.ticker.t : Infinity;
    if (level === true && age < 1.4) return;
    if (level === false && age < 0.7) return;
    this.ticker = { text, col, t: 2.8 };
  }
  banner(text, col, dur = 1.3) { this.big = { text, col, t: dur, dur }; }
  shake(a) { this.shakeT = Math.max(this.shakeT, a); }
  resize(W, H) {
    this.W = W; this.H = H;
    this.u = Math.max(0.5, Math.min(W, H * 1.6) / 100);
    this.parts.u = this.fx.u = this.u;
    this.next(this.kind);
  }
  next(kind) {
    if (!kind) {
      if (this.only) kind = this.only;
      else {
        if (!this.queue.length) {
          const keys = Object.keys(ROUNDS);
          for (let i = keys.length - 1; i > 0; i--) { const j = (this.rand() * (i + 1)) | 0; [keys[i], keys[j]] = [keys[j], keys[i]]; }
          if (keys[0] === this.kind) keys.push(keys.shift());
          this.queue = keys;
        }
        kind = this.queue.shift();
      }
    }
    this.kind = kind;
    const spec = ROUNDS[kind];
    const pool = [...TEAMS];
    for (let i = pool.length - 1; i > 0; i--) { const j = (this.rand() * (i + 1)) | 0; [pool[i], pool[j]] = [pool[j], pool[i]]; }
    this.round = new spec.cls(this);
    this.round.start(this.W, this.H, pool.slice(0, spec.teams));
    this.parts.list = [];
    this.fx.list = [];
    this.phase = 'intro'; this.phaseT = 0; this.winner = null;
    this.ticker = null; this.big = null;
  }
  update(dt) {
    this.t += dt;
    this.phaseT += dt;
    if (this.phase === 'intro') {
      if (this.phaseT > 2.2) { this.phase = 'play'; this.phaseT = 0; this.banner('GO!', 0x9cff7a, 0.7); }
    } else if (this.phase === 'play') {
      const w = this.round.update(dt);
      if (w) {
        this.phase = 'outro'; this.phaseT = 0; this.winner = w;
        this.wins.set(w, (this.wins.get(w) || 0) + 1);
        this.big = null;
        this.shake(0.5);
        for (let i = 0; i < 140; i++) {
          this.fx.burst(this.rand() * this.W, this.rand() * this.H * 0.05, this.rand() < 0.6 ? w.col : 0xffffff, 1, this.H * 0.4,
            { dir: Math.PI / 2, spread: 1.2, life: 2.5, g: this.H * 0.4, size: 0.8 });
        }
      }
    } else if (this.phaseT > 4) {
      this.next();
    }
    this.parts.update(dt);
    this.fx.update(dt);
    if (this.ticker && (this.ticker.t -= dt) <= 0) this.ticker = null;
    if (this.big && (this.big.t -= dt) <= 0) this.big = null;
    this.shakeT = Math.max(0, this.shakeT - dt * 2.5);
  }
  draw(rs) {
    const m = this.shakeT * 2.5 * this.u;
    rs.ox = this.shakeT > 0 ? (this.rand() - 0.5) * m * 2 : 0;
    rs.oy = this.shakeT > 0 ? (this.rand() - 0.5) * m : 0;
    this.round.draw(rs);
    if (this.round.drawParticles) this.round.drawParticles(rs, this.parts);
    else this.parts.draw(rs);
    this.fx.draw(rs);
    rs.ox = rs.oy = 0;
    const { W, H } = this;
    if (this.phase === 'intro') {
      rs.tint(0x000000, 0.5);
      const t = ROUNDS[this.kind].title;
      rs.text(t, W / 2, H * 0.45, Raster.textSize(t, W * 0.8, H * 0.22), 0xffffff);
    } else if (this.phase === 'outro') {
      const t = `${this.winner.name} WINS!`;
      rs.text(t, W / 2, H * 0.45, Raster.textSize(t, W * 0.9, H * 0.2), this.winner.col);
    } else if (this.big) {
      const age = this.big.dur - this.big.t;
      const pop = 1 + 0.25 * Math.max(0, 1 - age / 0.15);
      rs.text(this.big.text, W / 2, H * 0.3, Raster.textSize(this.big.text, W * 0.8, H * 0.16) * pop, this.big.col);
    }
  }
  // status line: overall tally on the left, round status on the right
  topLine() {
    const tally = [...this.wins].sort((a, b) => b[1] - a[1]);
    const left = [['WINS  ', 0x9090a8]];
    for (const [t, n] of tally) left.push(['● ', t.col], [`${n}  `, 0xe0e0f0]);
    if (!tally.length) left.push(['-', 0x9090a8]);
    return { left, right: this.round.hud() };
  }
  bottomLine() {
    if (this.phase === 'intro') return this.round.introLine ? this.round.introLine() : [[ROUNDS[this.kind].sub, 0xd8d8e8]];
    if (this.phase === 'outro') {
      const n = this.wins.get(this.winner);
      return [[n > 1 ? `${this.winner.name} HAS ${n} WINS` : `FIRST WIN FOR ${this.winner.name}`, this.winner.col]];
    }
    return this.ticker ? [[this.ticker.text, this.ticker.col]] : [];
  }
}

// ───────────────────────────── terminal output ─────────────────────────────
// The top and bottom rows are plain terminal text (crisp at any size); the
// picture fills the rows in between, using whichever backend fits.

const CUBE = [0, 95, 135, 175, 215, 255];
function cubeIdx(v) { return v < 48 ? 0 : v < 115 ? 1 : Math.min(5, ((v - 35) / 40) | 0); }
function to256(c) {
  const r = c >> 16, g = (c >> 8) & 255, b = c & 255;
  const qr = cubeIdx(r), qg = cubeIdx(g), qb = cubeIdx(b);
  const dc = (CUBE[qr] - r) ** 2 + (CUBE[qg] - g) ** 2 + (CUBE[qb] - b) ** 2;
  const gi = Math.max(0, Math.min(23, Math.round(((r + g + b) / 3 - 8) / 10)));
  const gv = 8 + gi * 10;
  const dg = (gv - r) ** 2 + (gv - g) ** 2 + (gv - b) ** 2;
  return dg < dc ? 232 + gi : 16 + 36 * qr + 6 * qg + qb;
}
function makeColorCodes(truecolor) {
  const fg = new Map(), bg = new Map();
  const code = (map, base, c) => {
    let s = map.get(c);
    if (s === undefined) {
      if (map.size > 50000) map.clear();
      s = truecolor ? `\x1b[${base};2;${c >> 16};${(c >> 8) & 255};${c & 255}m` : `\x1b[${base};5;${to256(c)}m`;
      map.set(c, s);
    }
    return s;
  };
  return { fg: c => code(fg, 38, c), bg: c => code(bg, 48, c) };
}

// Fallback: anti-aliased half blocks. Renders at 2x2 supersampling per
// half-block pixel, averages down, and only redraws changed cells.
class TextOut {
  constructor(codes) { this.codes = codes; this.S = 2; }
  layout(cols, rows) {
    this.cols = cols; this.rows = Math.max(1, rows - 2);
    this.fb = new Uint32Array(cols * this.rows * 2);
    this.prev = null;
    return [cols * this.S, this.rows * 2 * this.S];
  }
  frame(rs) {
    const { cols, rows, fb, S, codes } = this, W = cols, H = rows * 2, sw = rs.W, buf = rs.buf, n = S * S;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < S; j++) for (let i = 0, o = ((y * S + j) * sw + x * S) * 3; i < S; i++, o += 3) { r += buf[o]; g += buf[o + 1]; b += buf[o + 2]; }
      fb[y * W + x] = (((r / n) | 0) << 16) | (((g / n) | 0) << 8) | ((b / n) | 0);
    }
    let out = '', fgCur = -1, bgCur = -1;
    const prev = this.prev;
    for (let r = 0; r < rows; r++) {
      const t0 = 2 * r * W, b0 = t0 + W;
      let needPos = true;
      for (let c = 0; c < cols; c++) {
        const t = fb[t0 + c], b = fb[b0 + c];
        if (prev && prev[t0 + c] === t && prev[b0 + c] === b) { needPos = true; continue; }
        if (needPos) { out += `\x1b[${r + 2};${c + 1}H`; needPos = false; }
        if (t === b) {
          if (t !== bgCur) { out += codes.bg(t); bgCur = t; }
          out += ' ';
        } else {
          if (t !== fgCur) { out += codes.fg(t); fgCur = t; }
          if (b !== bgCur) { out += codes.bg(b); bgCur = b; }
          out += '▀';
        }
      }
    }
    if (!this.prev) this.prev = new Uint32Array(fb.length);
    this.prev.set(fb);
    return out + '\x1b[0m';
  }
}

// Size of the picture in real pixels; graphics backends render at most
// `budget` pixels and let the terminal (or integer upscaling) fill the rest.
function pixelArea(cols, rows, cell) {
  return [cols * cell.w, Math.max(1, rows - 2) * cell.h];
}

// Sixel: palette of up to 256 colours per frame (ordered dither into a 4-bit
// per channel histogram), run-length encoded, integer-upscaled by f.
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
class SixelOut {
  constructor(cell) { this.cell = cell; }
  layout(cols, rows) {
    const [pw, ph0] = pixelArea(cols, rows, this.cell);
    const ph = Math.max(6, Math.floor(ph0 / 6) * 6);
    this.f = Math.max(1, Math.ceil(Math.sqrt((pw * ph) / 300000)));
    const W = Math.floor(pw / this.f), H = Math.floor(ph / this.f);
    this.codes = new Uint16Array(W * H);
    this.masks = new Uint8Array(256 * W);
    this.hist = new Uint32Array(32768);
    this.map = new Uint8Array(32768);
    return [W, H];
  }
  frame(rs) {
    const { W, H, buf } = rs, f = this.f, codes = this.codes;
    // 1. reduce to 15-bit colour codes and histogram them. Dithering is
    // reserved for terminals that render fast enough to afford the noise:
    // it breaks up the long runs that make sixel output small.
    const hist = this.hist.fill(0), dither = this.dither ? 8.2 / 16 : 0;
    for (let y = 0, p = 0; y < H; y++) {
      for (let x = 0; x < W; x++, p++) {
        const d = (BAYER4[((y & 3) << 2) | (x & 3)] - 7.5) * dither, o = p * 3;
        const r = Math.min(31, Math.max(0, Math.round((buf[o] + d) / 8.226)));
        const g = Math.min(31, Math.max(0, Math.round((buf[o + 1] + d) / 8.226)));
        const b = Math.min(31, Math.max(0, Math.round((buf[o + 2] + d) / 8.226)));
        const c = (r << 10) | (g << 5) | b;
        codes[p] = c; hist[c]++;
      }
    }
    // 2. palette: the 256 most common codes; everything else maps to its nearest
    const used = [];
    for (let c = 0; c < 32768; c++) if (hist[c]) used.push(c);
    used.sort((a, b) => hist[b] - hist[a]);
    const pal = used.slice(0, 256);
    const map = this.map;
    pal.forEach((c, i) => { map[c] = i; });
    for (let u = 256; u < used.length; u++) {
      const c = used[u];
      let best = 0, bd = Infinity;
      for (let i = 0; i < pal.length; i++) {
        const p = pal[i];
        const dr = (c >> 10) - (p >> 10), dg = ((c >> 5) & 31) - ((p >> 5) & 31), db = (c & 31) - (p & 31);
        const dd = dr * dr * 3 + dg * dg * 4 + db * db * 2;
        if (dd < bd) { bd = dd; best = i; }
      }
      map[c] = best;
    }
    const pct = v => Math.round((v * 100) / 31);
    const parts = [`\x1bP0;1;0q"1;1;${W * f};${H * f}`];
    pal.forEach((c, i) => parts.push(`#${i};2;${pct(c >> 10)};${pct((c >> 5) & 31)};${pct(c & 31)}`));
    // 3. six pixel rows per band; one pass per colour present in the band
    const masks = this.masks, minX = new Int32Array(256), maxX = new Int32Array(256), inBand = new Uint8Array(256);
    const OH = H * f;
    for (let oy = 0; oy < OH; oy += 6) {
      const band = [];
      for (let k = 0; k < 6 && oy + k < OH; k++) {
        const row = Math.floor((oy + k) / f) * W, bit = 1 << k;
        for (let x = 0; x < W; x++) {
          const ci = map[codes[row + x]];
          if (!inBand[ci]) { inBand[ci] = 1; band.push(ci); minX[ci] = x; maxX[ci] = x; }
          else if (x < minX[ci]) minX[ci] = x;
          else if (x > maxX[ci]) maxX[ci] = x;
          masks[ci * W + x] |= bit;
        }
      }
      for (const ci of band) inBand[ci] = 0;
      let line = '';
      for (let bi = 0; bi < band.length; bi++) {
        const ci = band[bi], base = ci * W;
        line += `#${ci}`;
        if (minX[ci] > 0) line += `!${minX[ci] * f}?`;
        let run = 0, prevCh = -1;
        for (let x = minX[ci]; x <= maxX[ci]; x++) {
          const ch = masks[base + x];
          masks[base + x] = 0;
          if (ch === prevCh) run += f;
          else {
            if (run) line += run > 3 ? `!${run}${String.fromCharCode(63 + prevCh)}` : String.fromCharCode(63 + prevCh).repeat(run);
            prevCh = ch; run = f;
          }
        }
        if (run) line += run > 3 ? `!${run}${String.fromCharCode(63 + prevCh)}` : String.fromCharCode(63 + prevCh).repeat(run);
        line += bi < band.length - 1 ? '$' : '';
      }
      parts.push(line + '-');
    }
    parts.push('\x1b\\');
    return '\x1b[2;1H' + parts.join('');
  }
}

// Kitty graphics protocol: zlib-compressed RGB, scaled by the terminal to
// fill the picture area. Alternates image ids so there's never a blank frame.
class KittyOut {
  constructor(cell) { this.cell = cell; this.id = 1; }
  layout(cols, rows) {
    this.cols = cols; this.rows = Math.max(1, rows - 2);
    const [pw, ph] = pixelArea(cols, rows, this.cell);
    const k = Math.min(1, Math.sqrt(450000 / (pw * ph)));
    return [Math.round(pw * k), Math.round(ph * k)];
  }
  frame(rs) {
    const data = zlib.deflateSync(Buffer.from(rs.buf.buffer, rs.buf.byteOffset, rs.buf.length), { level: 1 }).toString('base64');
    const old = this.id;
    this.id = old === 1 ? 2 : 1;
    let out = '\x1b[2;1H';
    for (let i = 0; i < data.length; i += 4096) {
      const more = i + 4096 < data.length ? 1 : 0, chunk = data.slice(i, i + 4096);
      out += i === 0
        ? `\x1b_Ga=T,q=2,f=24,o=z,s=${rs.W},v=${rs.H},i=${this.id},p=1,c=${this.cols},r=${this.rows},C=1,z=-1,m=${more};${chunk}\x1b\\`
        : `\x1b_Gm=${more};${chunk}\x1b\\`;
    }
    return out + `\x1b_Ga=d,d=I,i=${old},q=2\x1b\\`;
  }
}

// iTerm2 inline images: a PNG per frame, scaled by the terminal.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(W, H, rgbBuf) {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    raw.set(rgbBuf.subarray(y * W * 3, (y + 1) * W * 3), y * (W * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 1 })), pngChunk('IEND', Buffer.alloc(0))]);
}
class ItermOut {
  constructor(cell) { this.cell = cell; }
  layout(cols, rows) {
    this.cols = cols; this.rows = Math.max(1, rows - 2);
    const [pw, ph] = pixelArea(cols, rows, this.cell);
    const k = Math.min(1, Math.sqrt(450000 / (pw * ph)));
    return [Math.round(pw * k), Math.round(ph * k)];
  }
  frame(rs) {
    const png = encodePng(rs.W, rs.H, rs.buf);
    return `\x1b[2;1H\x1b]1337;File=inline=1;width=${this.cols};height=${this.rows};preserveAspectRatio=0;size=${png.length}:${png.toString('base64')}\x07`;
  }
}

function statusRow(row, cols, left, right, codes, center) {
  const len = segs => segs.reduce((s, [str]) => s + str.length, 0);
  const paint = segs => segs.map(([s, c]) => codes.fg(c) + s).join('');
  let out = `\x1b[${row};1H${codes.bg(0x0b0b12)}\x1b[2K`;
  if (center) {
    const n = len(center);
    if (n <= cols) out += `\x1b[${row};${Math.floor((cols - n) / 2) + 1}H` + paint(center);
  } else {
    const rl = len(right), ll = len(left);
    if (rl + 1 <= cols) out += `\x1b[${row};${cols - rl}H` + paint(right);
    if (ll + rl + 4 <= cols) out += `\x1b[${row};2H` + paint(left);
  }
  return out + '\x1b[0m';
}

// ───────────────────────────── main ─────────────────────────────

const USAGE = `SHOWDOWN: endless little contests between coloured dots.

usage: node showdown.js [options]

  --round <name>     only play one kind of round: ${Object.keys(ROUNDS).join(', ')}
  --gfx <mode>       auto | sixel | kitty | iterm | text   (default auto)
  --fps <n>          target frame rate (default 30)
  --colors <mode>    text mode colours: auto | truecolor | 256 (default auto)
  -h, --help         show this help

keys: Space / N next round,  P pause,  Q / Esc quit`;

function parseArgs(argv) {
  const opts = { round: null, gfx: 'auto', fps: 30, colors: 'auto', help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--round') opts.round = argv[++i];
    else if (a === '--gfx') opts.gfx = argv[++i];
    else if (a === '--fps') opts.fps = Math.max(5, Math.min(120, Number(argv[++i]) || 30));
    else if (a === '--colors') opts.colors = argv[++i];
    else { opts.help = true; opts.bad = a; }
  }
  if (opts.round !== null && !ROUNDS[opts.round]) { opts.help = true; opts.bad = `--round ${opts.round}`; }
  if (!['auto', 'sixel', 'kitty', 'iterm', 'text'].includes(opts.gfx)) { opts.help = true; opts.bad = `--gfx ${opts.gfx}`; }
  if (!['auto', 'truecolor', '256'].includes(opts.colors)) { opts.help = true; opts.bad = `--colors ${opts.colors}`; }
  return opts;
}

// Ask the terminal what it can do: primary device attributes (a "4" means
// sixel) and the cell size in pixels. Resolves with whatever came back.
function queryTerminal(inp, out, ms = 700) {
  return new Promise(resolve => {
    let data = '';
    const finish = () => { clearTimeout(timer); inp.off('data', onData); resolve(data); };
    const onData = d => { data += d; if (/\x1b\[\?[\d;]*c/.test(data)) finish(); };
    const timer = setTimeout(finish, ms);
    inp.on('data', onData);
    out.write('\x1b[16t\x1b[c');
  });
}

function pickGfx(opts, reply) {
  const env = process.env;
  const da = reply.match(/\x1b\[\?([\d;]*)c/);
  const sixel = !!da && da[1].split(';').includes('4');
  const cs = reply.match(/\x1b\[6;(\d+);(\d+)t/);
  const cell = cs && +cs[1] > 0 && +cs[2] > 0 ? { w: +cs[2], h: +cs[1] } : { w: 10, h: 20 };
  let mode = opts.gfx;
  if (mode === 'auto') {
    if (env.TMUX || /^screen/.test(env.TERM || '')) mode = 'text'; // multiplexers mangle image escapes
    else if (env.KITTY_WINDOW_ID || /kitty|ghostty/i.test(env.TERM || '') || env.TERM_PROGRAM === 'ghostty') mode = 'kitty';
    else if (env.TERM_PROGRAM === 'iTerm.app' || env.TERM_PROGRAM === 'WezTerm') mode = 'iterm';
    else if (sixel) mode = 'sixel';
    else if (env.WT_SESSION && !da) mode = 'sixel'; // Windows Terminal 1.22+ does sixel; its reply may not reach us
    else mode = 'text';
  }
  // Windows Terminal maps sixel pixels onto a virtual 10x20 cell
  if (mode === 'sixel' && env.WT_SESSION && !cs) { cell.w = 10; cell.h = 20; }
  return { mode, cell };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    if (opts.bad) console.error(`unknown option: ${opts.bad}\n`);
    console.log(USAGE);
    process.exitCode = opts.bad ? 2 : 0;
    return;
  }
  const out = process.stdout, inp = process.stdin;
  if (!out.isTTY) {
    console.error('showdown needs to run in an interactive terminal.');
    process.exitCode = 1;
    return;
  }

  let quitting = false;
  const RESET = '\x1b[0m\x1b[2J\x1b[?7h\x1b[?25h\x1b[?1049l';
  function quit(code = 0) {
    if (quitting) return;
    quitting = true;
    if (inp.isTTY) inp.setRawMode(false);
    inp.pause();
    out.write(RESET, () => process.exit(code));
  }
  if (inp.isTTY) inp.setRawMode(true);
  inp.setEncoding('utf8');
  inp.resume();
  process.on('SIGINT', () => quit(0));
  process.on('SIGTERM', () => quit(0));
  process.on('uncaughtException', err => {
    try { if (inp.isTTY) inp.setRawMode(false); } catch (_) { /* already restored */ }
    require('fs').writeSync(1, RESET);
    console.error(err);
    process.exit(1);
  });

  const { mode, cell } = pickGfx(opts, await queryTerminal(inp, out));
  const truecolor = mode !== 'text' || opts.colors === 'truecolor' ||
    (opts.colors === 'auto' && typeof out.getColorDepth === 'function' && out.getColorDepth() >= 24);
  const codes = makeColorCodes(truecolor);
  const backend = mode === 'sixel' ? new SixelOut(cell) : mode === 'kitty' ? new KittyOut(cell) : mode === 'iterm' ? new ItermOut(cell) : new TextOut(codes);

  const show = new Show((Math.random() * 1e9) | 0, opts.round);
  let rs, cols, rows, lastTop = '', lastBottom = '';
  const fit = () => {
    cols = Math.max(10, out.columns || 80);
    rows = Math.max(4, out.rows || 24);
    const [W, H] = backend.layout(cols, rows);
    rs = new Raster(W, H);
    show.resize(rs.W, rs.H);
    lastTop = lastBottom = '';
  };
  fit();

  let keys = '';
  let resizeAt = 0, paused = false, waiting = false;
  inp.on('data', d => { keys += d; });
  out.on('resize', () => { resizeAt = performance.now() + 250; }); // wait for the drag to settle
  out.write('\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[0m\x1b[2J');

  const frameMs = 1000 / opts.fps;
  let last = performance.now();
  function tick() {
    if (quitting) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    // drop terminal replies (CSI / APC / OSC / DCS) so they don't read as key presses
    const k = keys.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b[_P\]][\s\S]*?(\x1b\\|\x07)/g, '').toLowerCase();
    keys = '';
    if (/[q\x03\x1b]/.test(k)) return quit(0);
    if (k.includes('p')) paused = !paused;
    if (/[ n]/.test(k)) show.next();
    if (resizeAt && now >= resizeAt) {
      resizeAt = 0;
      fit();
      out.write('\x1b[0m\x1b[2J');
    }
    if (!paused) show.update(dt);
    if (!waiting && !paused) {
      show.draw(rs);
      let frame = '\x1b[?2026h' + backend.frame(rs);
      const { left, right } = show.topLine();
      const top = statusRow(1, cols, left, right, codes);
      const bottom = statusRow(rows, cols, null, null, codes, show.bottomLine());
      if (top !== lastTop) { frame += top; lastTop = top; }
      if (bottom !== lastBottom) { frame += bottom; lastBottom = bottom; }
      if (!out.write(frame + '\x1b[?2026l')) {
        waiting = true;
        out.once('drain', () => { waiting = false; });
      }
    }
    setTimeout(tick, Math.max(1, frameMs - (performance.now() - now)));
  }
  tick();
}

if (require.main === module) main();
else module.exports = { Show, Raster, ROUNDS, TextOut, SixelOut, KittyOut, ItermOut, encodePng, pickGfx, makeColorCodes };
