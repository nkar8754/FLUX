// FLUX level generator (run offline, never on the server: it is too slow for a Worker's CPU limit).
// Levels are built backwards from a solved board, scrambled, then verified by exhaustive search,
// so every level is solvable, par is exact, and the number of distinct solutions is known.
import { sim, N } from "../public/engine.js";
const DIRS = [[-1,0],[0,1],[1,0],[0,-1]], SL = [1,0,3,2];
const key = (r, c) => r + "," + c;
const inb = (r, c) => r >= 0 && r < N && c >= 0 && c < N;

// Difficulty band: every level of the day is built from this same recipe.
// S splitters (S+1 targets), M mirrors, K = exact optimal moves, W walls, UNIQ = max distinct solutions.
export const BAND = { S: 3, M: 8, K: 6, W: 3, UNIQ: 2 };

function hash(s){ let h = 2166136261; for (const ch of s){ h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a){ return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Exhaustive search over all 2^M mirror states.
function analyse(L){
  const m = L.mir.length, proj = new Set(); let opt = Infinity;
  for (let x = 0; x < 1 << m; x++){
    const o = L.mir.map((_, i) => !!(x >> i & 1)), r = sim(L, o);
    if (!r.win) continue;
    const flips = o.reduce((a, v, i) => a + (v !== !!L.mir[i][2]), 0);
    if (flips < opt) opt = flips;
    proj.add(L.mir.map((mm, i) => r.lit.has(key(mm[0], mm[1])) ? (o[i] ? 1 : 0) : "x").join(""));
  }
  return { opt, uniq: proj.size };
}

function build(rnd, { S, M, K, W }){
  const ri = n => Math.floor(rnd() * n);
  const c0 = ri(N), src = { r: N - 1, c: c0 };
  const occ = new Set([key(src.r, src.c)]), pth = new Set();
  const mir = [], spl = [], tg = [];
  const beams = [{ r: src.r - 1, c: c0, d: 0 }];
  const free = (r, c) => inb(r, c) && !occ.has(key(r, c));
  // advance a beam len cells; the component goes on the cell reached
  function walk(b, len){
    let { r, c, d } = b; const cells = [];
    for (let i = 0; i < len; i++){ if (!free(r, c)) return null; cells.push(key(r, c)); r += DIRS[d][0]; c += DIRS[d][1]; }
    if (!free(r, c) || pth.has(key(r, c)) || cells.includes(key(r, c))) return null;
    return { r, c, d, cells };
  }
  const pendingAt = (r, c, skip) => beams.some((b, i) => i !== skip && b.r === r && b.c === c);
  let sLeft = S, mLeft = M, guard = 0;
  while (sLeft > 0 || mLeft > 0){
    if (++guard > 300) return null;
    const bi = ri(beams.length), w = walk(beams[bi], ri(3));
    if (!w || pendingAt(w.r, w.c, bi)) continue;
    const { r, c, d } = w, opts = [];
    if (mLeft > 0) opts.push("m");
    if (sLeft > 0) opts.push("s");
    if (opts[ri(opts.length)] === "m"){
      const nd = rnd() < .5 ? (d + 1) % 4 : (d + 3) % 4, nr = r + DIRS[nd][0], nc = c + DIRS[nd][1];
      if (!inb(nr, nc)) continue;
      w.cells.forEach(k => pth.add(k)); occ.add(key(r, c));
      mir.push([r, c, SL[d] === nd ? 1 : 0]); mLeft--;
      beams[bi] = { r: nr, c: nc, d: nd };
    } else {
      const ld = (d + 3) % 4, sr = r + DIRS[d][0], sc = c + DIRS[d][1], lr = r + DIRS[ld][0], lc = c + DIRS[ld][1];
      if (!inb(sr, sc) || !inb(lr, lc)) continue;
      w.cells.forEach(k => pth.add(k)); occ.add(key(r, c));
      spl.push([r, c]); sLeft--;
      beams[bi] = { r: sr, c: sc, d };
      beams.push({ r: lr, c: lc, d: ld });
    }
  }
  // end every remaining beam in a target
  for (let i = 0; i < beams.length; i++){
    let ok = false;
    for (let t = 0; t < 12 && !ok; t++){
      const w = walk(beams[i], ri(4));
      if (!w || pendingAt(w.r, w.c, i)) continue;
      w.cells.forEach(k => pth.add(k)); occ.add(key(w.r, w.c)); tg.push([w.r, w.c]); ok = true;
    }
    if (!ok) return null;
  }
  // walls sit beside the beam paths, where a wrong mirror would otherwise send light
  const used = new Set([...occ, ...pth]), cand = [];
  for (const k of used){
    const [r, c] = k.split(",").map(Number);
    for (const [dr, dc] of DIRS){
      const kk = key(r + dr, c + dc);
      if (inb(r + dr, c + dc) && !used.has(kk) && !cand.includes(kk)) cand.push(kk);
    }
  }
  if (cand.length < W) return null;
  const walls = [];
  for (let i = 0; i < W; i++) walls.push(cand.splice(ri(cand.length), 1)[0].split(",").map(Number));
  const L = { src, spl, tg, walls, mir };
  if (!sim(L, mir.map(m => !!m[2])).win) return null;       // the solved board must win
  // scramble exactly K mirrors
  const idx = mir.map((_, i) => i);
  for (let i = 0; i < K; i++){ const j = i + ri(idx.length - i); [idx[i], idx[j]] = [idx[j], idx[i]]; mir[idx[i]][2] ^= 1; }
  return L;
}

// The salt is private to whoever runs the seeding: without it nobody can predict future days.
export function makeLevel(date, i, salt, band = BAND){
  const rnd = mulberry32(hash(`flux:${salt}:${date}:${i}`));
  for (let a = 1; a <= 20000; a++){
    const L = build(rnd, band);
    if (!L) continue;
    if (sim(L, L.mir.map(m => !!m[2])).win) continue;
    const { opt, uniq } = analyse(L);
    if (opt === band.K && uniq <= band.UNIQ) return { L: { ...L, par: opt }, stats: { opt, uniq, attempts: a } };
  }
  throw new Error(`no level for ${date} #${i}`);
}
