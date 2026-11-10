// Run with: npm test   (Node 22+). Exercises the engine, the generator and the real Worker code against an in-memory SQLite standing in for D1.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { sim, replay, startBoard } from "../public/engine.js";
import { makeLevel } from "../tools/generator.js";
import worker from "../src/worker.js";

let passed = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log("ok  ", name); }, e => { console.error("FAIL", name, "\n", e); process.exitCode = 1; });

// brute force: best flip set and the log that plays it
function solution(L){
  const m = L.mir.length, M0 = startBoard(L); let best = null;
  for (let x = 0; x < 1 << m; x++){
    const o = M0.map((v, i) => (x >> i & 1) ? !v : v);
    if (sim(L, o).win){ const flips = M0.flatMap((_, i) => o[i] !== M0[i] ? [i] : []); if (!best || flips.length < best.length) best = flips; }
  }
  return best;
}

// minimal D1 shim over node:sqlite
function makeD1(){
  const db = new DatabaseSync(":memory:"); db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => { db.prepare(sql).run(...args); return { success: true }; },
    all: async () => ({ results: db.prepare(sql).all(...args) }),
  });
  return { prepare: sql => stmt(sql), batch: async list => Promise.all(list.map(s => s.all())), raw: db };
}

const SALT = "test-salt", today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const levels = Array.from({ length: 5 }, (_, i) => makeLevel(today, i, SALT).L);
const sols = levels.map(solution);

await ok("every generated level is solvable at exactly par, with the shared engine", () => {
  levels.forEach((L, i) => { assert.equal(sols[i].length, L.par); assert.equal(replay(L, sols[i]).moves, L.par); });
});
await ok("generation is deterministic per salt and differs between salts", () => {
  const again = makeLevel(today, 0, SALT).L, other = makeLevel(today, 0, "other").L;
  assert.deepEqual(again, levels[0]); assert.notDeepEqual(other, levels[0]);
});
await ok("replay rejects unsolved, over-long, malformed logs and does not refund undo/reset", () => {
  const L = levels[0], s = sols[0];
  assert.equal(replay(L, s.slice(0, -1)).ok, false);
  assert.equal(replay(L, [...s, s[0]]).ok, false);
  assert.equal(replay(L, [99, ...s]).ok, false);
  const noisy = [s[0], "u", "r", ...s];                        // 1 + 6 rotations, undo and reset keep the count
  assert.deepEqual(replay(L, noisy), { ok: true, moves: s.length + 1 });
});

// ---- the Worker, end to end ----
const env = { DB: makeD1(), ROLLOVER_TZ: "America/New_York" };
const q = s => s.replace(/'/g, "''");
env.DB.raw.exec(`INSERT INTO days (date,num,levels,par_total) VALUES ('${today}',1,'${q(JSON.stringify(levels))}',${levels.reduce((a, l) => a + l.par, 0)})`);
const call = (path, body) => worker.fetch(new Request("http://x" + path, body ? { method: "POST", body: JSON.stringify(body) } : {}), env);
const pid = n => "player-" + String(n).padStart(12, "0");
const logsFor = extra => sols.map((s, i) => i === 0 && extra ? [...extra, ...s] : s);

await ok("GET /api/daily serves today's levels", async () => {
  const r = await call("/api/daily"), j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.date, today); assert.equal(j.levels.length, 5); assert.deepEqual(j.levels[0], levels[0]);
});
await ok("valid submission is scored by the server and ranked", async () => {
  const r = await call("/api/submit", { date: today, player: pid(1), logs: logsFor(), ms: 120000 }), j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.moves, 30); assert.equal(j.par, 30); assert.equal(j.rank, 1); assert.equal(j.players, 1);
});
await ok("tiebreak by time, worse scores rank lower, percentile counts strictly worse players", async () => {
  await call("/api/submit", { date: today, player: pid(2), logs: logsFor(), ms: 90000 });          // same moves, faster -> rank 1
  await call("/api/submit", { date: today, player: pid(3), logs: logsFor([0, "u", 1, "r"]), ms: 50000 }); // 2 extra moves -> 32
  const j = await (await call(`/api/result?date=${today}&player=${pid(1)}`)).json();
  assert.equal(j.rank, 2); assert.equal(j.players, 3); assert.equal(j.beat, 33);
  assert.deepEqual(j.histogram, [[30, 2], [32, 1]]);
  const w = await (await call(`/api/result?date=${today}&player=${pid(3)}`)).json();
  assert.equal(w.moves, 32); assert.equal(w.rank, 3); assert.equal(w.beat, 0);
});
await ok("resubmitting never changes the stored score (first attempt counts)", async () => {
  const j = await (await call("/api/submit", { date: today, player: pid(3), logs: logsFor(), ms: 1000 })).json();
  assert.equal(j.moves, 32); assert.equal(j.players, 3);
});
await ok("forged or broken submissions are refused", async () => {
  const fake = logsFor(); fake[2] = [0];
  assert.equal((await call("/api/submit", { date: today, player: pid(9), logs: fake, ms: 1 })).status, 422);
  assert.equal((await call("/api/submit", { date: today, player: pid(9), logs: logsFor().slice(0, 4), ms: 1 })).status, 400);
  assert.equal((await call("/api/submit", { date: today, player: "x", logs: logsFor(), ms: 1 })).status, 400);
  assert.equal((await call("/api/submit", { date: "2020-01-01", player: pid(9), logs: logsFor(), ms: 1 })).status, 400);
  assert.equal((await call("/api/submit", { date: today, player: pid(9), logs: logsFor(), ms: -5 })).status, 400);
  assert.equal((await call(`/api/result?date=${today}&player=${pid(9)}`)).status, 404);
});
await ok("a day with no seeded puzzle returns 503 instead of crashing", async () => {
  env.DB.raw.exec("DELETE FROM days");
  assert.equal((await call("/api/daily")).status, 503);
});
console.log(`\n${passed} checks passed`);
