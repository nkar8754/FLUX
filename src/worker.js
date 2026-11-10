// FLUX API on Cloudflare Workers + D1.
//   GET  /api/daily                      today's 5 levels (only today's, never future days)
//   POST /api/submit {date,player,logs,ms}  validates by replaying the move logs, records one score per player per day
//   GET  /api/result?date=&player=       your result and the day's distribution (only after you have submitted)
import { replay } from "../public/engine.js";

const json = (o, status = 200, headers = {}) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

// The server decides what "today" is; the player's clock is never trusted.
const dayIn = (tz, t = Date.now()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));

const DATE = /^\d{4}-\d{2}-\d{2}$/, PLAYER = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_BODY = 40000, MAX_EVENTS = 600, MAX_MS = 6 * 3600 * 1000;

async function result(env, date, player, row) {
  const [rankQ, totalQ, worseQ, histQ] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) c FROM scores WHERE date=? AND (moves<? OR (moves=? AND ms<?))").bind(date, row.moves, row.moves, row.ms),
    env.DB.prepare("SELECT COUNT(*) c FROM scores WHERE date=?").bind(date),
    env.DB.prepare("SELECT COUNT(*) c FROM scores WHERE date=? AND moves>?").bind(date, row.moves),
    env.DB.prepare("SELECT moves, COUNT(*) c FROM scores WHERE date=? GROUP BY moves ORDER BY moves").bind(date),
  ]);
  const players = totalQ.results[0].c, worse = worseQ.results[0].c;
  const day = await env.DB.prepare("SELECT par_total FROM days WHERE date=?").bind(date).first();
  return {
    date, moves: row.moves, ms: row.ms, perLevel: JSON.parse(row.per_level), par: day ? day.par_total : null,
    rank: rankQ.results[0].c + 1, players, beat: players ? Math.round(100 * worse / players) : 0,
    histogram: histQ.results.map(r => [r.moves, r.c]),
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), tz = env.ROLLOVER_TZ || "America/New_York";
    try {
      if (url.pathname === "/api/daily" && request.method === "GET") {
        const date = dayIn(tz);
        const row = await env.DB.prepare("SELECT num, levels FROM days WHERE date=?").bind(date).first();
        if (!row) return json({ error: "No puzzle for today yet." }, 503);
        return json({ date, num: row.num, levels: JSON.parse(row.levels) }, 200, { "cache-control": "public, max-age=60" });
      }

      if (url.pathname === "/api/result" && request.method === "GET") {
        const date = url.searchParams.get("date") || "", player = url.searchParams.get("player") || "";
        if (!DATE.test(date) || !PLAYER.test(player)) return json({ error: "bad request" }, 400);
        const row = await env.DB.prepare("SELECT moves, ms, per_level FROM scores WHERE date=? AND player=?").bind(date, player).first();
        if (!row) return json({ error: "No score yet." }, 404);
        return json(await result(env, date, player, row));
      }

      if (url.pathname === "/api/submit" && request.method === "POST") {
        const text = await request.text();
        if (text.length > MAX_BODY) return json({ error: "too large" }, 413);
        let b; try { b = JSON.parse(text); } catch { return json({ error: "bad json" }, 400); }
        const { date, player, logs } = b || {}, ms = Math.round(Number(b && b.ms));
        if (!DATE.test(date || "") || !PLAYER.test(player || "")) return json({ error: "bad date or player" }, 400);
        if (!Array.isArray(logs) || logs.length !== 5 || logs.some(l => !Array.isArray(l) || l.length > MAX_EVENTS)) return json({ error: "bad logs" }, 400);
        if (!Number.isFinite(ms) || ms < 0) return json({ error: "bad time" }, 400);
        // only today's puzzle, or yesterday's for someone who started before midnight
        if (date > dayIn(tz) || date < dayIn(tz, Date.now() - 864e5)) return json({ error: "That day is closed." }, 400);

        const day = await env.DB.prepare("SELECT levels FROM days WHERE date=?").bind(date).first();
        if (!day) return json({ error: "unknown day" }, 404);
        const levels = JSON.parse(day.levels), per = [];
        for (let i = 0; i < 5; i++) {
          const r = replay(levels[i], logs[i]);
          if (!r.ok) return json({ error: `grid ${i + 1}: ${r.error}` }, 422);
          per.push(r.moves);
        }
        const total = per.reduce((a, v) => a + v, 0);
        // first scored attempt counts; resubmitting returns the stored score instead
        await env.DB.prepare("INSERT OR IGNORE INTO scores (date, player, moves, ms, per_level, created) VALUES (?,?,?,?,?,?)")
          .bind(date, player, total, Math.min(ms, MAX_MS), JSON.stringify(per), Date.now()).run();
        const row = await env.DB.prepare("SELECT moves, ms, per_level FROM scores WHERE date=? AND player=?").bind(date, player).first();
        return json(await result(env, date, player, row));
      }
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: "server error" }, 500);
    }
  },
};
