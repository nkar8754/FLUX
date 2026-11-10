#!/usr/bin/env node
// Prints SQL that loads upcoming days into the database.
//   SEED_SALT=your-long-secret node tools/seed.js 2026-11-09 60 > seed.sql
// Keep seed.sql private (it contains future puzzles) and keep the salt secret.
import { makeLevel } from "./generator.js";
const EPOCH = "2026-11-09";                       // day #1; never change once players exist
const args = process.argv.slice(2).filter(a => !a.startsWith("--"));
const salt = process.env.SEED_SALT || (process.argv.find(a => a.startsWith("--salt=")) || "").slice(7);
if (!salt){ console.error("Set SEED_SALT (a long random secret) first."); process.exit(1); }
const start = args[0], n = +args[1] || 30;
if (!/^\d{4}-\d{2}-\d{2}$/.test(start || "")){ console.error("Usage: node tools/seed.js START_DATE [DAYS]"); process.exit(1); }
const q = s => "'" + s.replace(/'/g, "''") + "'";
for (let d = 0; d < n; d++){
  const date = new Date(Date.parse(start + "T00:00:00Z") + d * 864e5).toISOString().slice(0, 10);
  const levels = Array.from({ length: 5 }, (_, i) => makeLevel(date, i, salt).L);
  const num = Math.round((Date.parse(date) - Date.parse(EPOCH)) / 864e5) + 1;
  const par = levels.reduce((a, l) => a + l.par, 0);
  console.log(`INSERT OR IGNORE INTO days (date, num, levels, par_total) VALUES (${q(date)}, ${num}, ${q(JSON.stringify(levels))}, ${par});`);
}
