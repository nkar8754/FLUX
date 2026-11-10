// Shared FLUX rules. The page, the level generator and the server's score validation all import this file,
// so they can never disagree about what a board does.
export const N = 6;
const DIRS = [[-1,0],[0,1],[1,0],[0,-1]], SL = [1,0,3,2], BS = [3,2,1,0];
const key = (r, c) => r + "," + c;

// L = { src:{r,c}, spl:[[r,c]], tg:[[r,c]], walls:[[r,c]], mir:[[r,c,startsAsSlash]] }, o = mirror states (true = slash)
export function sim(L, o){
  const T = new Set(L.tg.map(t => key(t[0], t[1]))), S = new Set(L.spl.map(t => key(t[0], t[1]))), W = new Set(L.walls.map(t => key(t[0], t[1])));
  const SRC = key(L.src.r, L.src.c), MI = new Map(L.mir.map((m, i) => [key(m[0], m[1]), i]));
  const qu = [{ r: L.src.r - 1, c: L.src.c, d: 0 }], vis = new Set(), hits = new Set(), lit = new Set(), inc = {}, segs = new Set([SRC + ":0"]);
  while (qu.length){
    const s = qu.shift(), k = key(s.r, s.c), st = k + ":" + s.d;
    if (s.r < 0 || s.r >= N || s.c < 0 || s.c >= N || vis.has(st)) continue;
    vis.add(st);
    if (W.has(k) || k === SRC) continue;
    lit.add(k);
    segs.add(k + ":" + (s.d + 2) % 4);               // beam enters from the opposite side
    if (T.has(k)){ hits.add(k); continue; }
    let out = [s.d];
    if (S.has(k)){ out = [s.d, (s.d + 3) % 4]; if (inc[k] === undefined) inc[k] = s.d; }   // straight + 90deg left
    else if (MI.has(k)) out = [(o[MI.get(k)] ? SL : BS)[s.d]];
    for (const d of out){ segs.add(k + ":" + d); qu.push({ r: s.r + DIRS[d][0], c: s.c + DIRS[d][1], d }); }
  }
  return { hits, lit, segs, inc, win: hits.size === L.tg.length };
}

export const startBoard = L => L.mir.map(m => !!m[2]);

// A move log is a list of events: a mirror index (rotate), "u" (undo) or "r" (reset).
// A valid log solves the board on its very last event. Moves = rotations; undo and reset never refund them.
export function replay(L, log){
  if (!Array.isArray(log)) return { ok: false, error: "log must be a list" };
  const M0 = startBoard(L); let M = M0.slice(), hist = [], moves = 0;
  for (let i = 0; i < log.length; i++){
    const e = log[i];
    if (Number.isInteger(e) && e >= 0 && e < M.length){
      hist.push(M.slice()); M[e] = !M[e]; moves++;
      if (sim(L, M).win) return i === log.length - 1 ? { ok: true, moves } : { ok: false, error: "events after the solve" };
    } else if (e === "u"){ if (hist.length) M = hist.pop(); }
    else if (e === "r"){ M = M0.slice(); hist = []; }
    else return { ok: false, error: "bad event" };
  }
  return { ok: false, error: "board not solved" };
}
