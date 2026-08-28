// ingest-armor.mjs — copy Raven's armor board into the game.
//
//   node scripts/ingest-armor.mjs
//
// The path is: armor bench (tools/armor.html) -> export -> paste into
// tools/armor-assignment.mjs -> this -> docs/game.js. One copy of the data
// exists at a time, so the board he designs against and the board the game plays
// cannot drift. That drift has already cost us twice on other files.
//
// Refuses to run if scripts/check-armor.mjs would fail, because a board with a
// full set over the cap is not a board worth shipping.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(REPO, 'tools', 'armor-assignment.mjs');
const DST = join(REPO, 'docs', 'game.js');
const START = '  // >>> ARMOR_PIECES START';
const END = '  // <<< ARMOR_PIECES END';

const check = execFileSync(process.execPath, [join(REPO, 'scripts', 'check-armor.mjs')],
  { encoding: 'utf8' });
const overs = (check.match(/^OVER /gm) || []).length;
const problems = /(\d+) PROBLEMS/.exec(check);
if (overs || problems) {
  console.error(check);
  console.error(`refusing to ingest: ${overs} full sets over the cap, ` +
    `${problems ? problems[1] : 0} structural problems`);
  process.exit(1);
}

// Take the literal verbatim rather than JSON.stringify-ing the parsed object:
// the source is hand-maintained and its one-rank-per-line shape is what makes it
// readable. Re-serialising would explode it to thousands of lines.
const src = readFileSync(SRC, 'utf8');
const open = src.indexOf('export const ARMOR_PIECES = {');
const body = src.slice(src.indexOf('{', open), src.lastIndexOf('};') + 2);
// Re-indent from the module's two spaces to game.js's IIFE two-space body.
const literal = '  const ARMOR_PIECES = ' + body.trimEnd().replace(/\n/g, '\n') + '';

const dst = readFileSync(DST, 'utf8');
const a = dst.indexOf(START), b = dst.indexOf(END);
if (a < 0 || b < 0) { console.error('markers missing in docs/game.js'); process.exit(1); }
const out = dst.slice(0, a + START.length) + '\n' + literal + '\n' + dst.slice(b);
writeFileSync(DST, out);

const lines = (literal.match(/^  [a-z_]+: \{/gm) || []).length;
console.log(`ingested ${lines} armor lines into docs/game.js`);
