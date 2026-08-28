// check-armor.mjs — validates tools/armor-assignment.mjs before it is ingested.
//
//   node scripts/check-armor.mjs
//
// The bench has its own checks, but they only see what is on screen. This sees
// the whole board at once, and it is the gate: a full set now SUMS across three
// pieces and clamps at 5, so a total of 6 is not an error anywhere -- it is a
// level the player pays for and never receives.

import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARMOR_PIECES } from '../tools/armor-assignment.mjs';

const require = createRequire(import.meta.url);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(REPO, 'docs');

global.window = {};
for (const f of [['data', 'ores.js'], ['data', 'fish.js'], ['data', 'locales.js'],
                 ['data', 'meals.js'], ['data', 'canteen.js'], ['game.js']])
  require(join(DOCS, ...f));
require(join(REPO, 'tools', 'skills-data.js'));

const G = global.window.MF_GAME, SK = global.window.MF_SKILLS;
const RANKS = ['Low', 'High', 'G'];
const PIECES = ['helm', 'chest', 'waist'];
const CAP = 5;
const lines = Object.entries(ARMOR_PIECES);

const say = (tag, msg) => console.log(tag.padEnd(9) + msg);
let problems = 0;
const bad = m => { problems++; say('PROBLEM', m); };

console.log('=== ' + lines.length + ' lines ===');

// 1. Every key must be a skill the bench knows, and every level within 1..5.
const unknown = new Set(), used = new Map();
for (const [id, L] of lines)
  for (const r of RANKS)
    for (const p of PIECES)
      for (const e of (L[r]?.[p] ?? [])) {
        if (!SK.byKey[e.k]) unknown.add(e.k);
        if (!(e.lvl >= 1 && e.lvl <= CAP)) bad(id + ' ' + r + ' ' + p + ': ' + e.k + ' lvl ' + e.lvl);
        used.set(e.k, (used.get(e.k) ?? 0) + 1);
      }
if (unknown.size) bad('skill keys nothing knows: ' + [...unknown].join(', '));

// 2. Which of the used keys the game cannot yet read.
const missing = [...used.keys()].filter(k => !G.EFFECTS[k]).sort();
console.log('\n--- ' + missing.length + ' skills used but NOT in EFFECTS ---');
console.log(missing.map(k => k + ' (' + SK.nameOf(k) + ')').join(', ') || 'none');

// 3. Skills in the list that nothing carries.
const unusedSkills = SK.list.filter(s => !used.has(s.k)).map(s => s.k);
console.log('\n--- ' + unusedSkills.length + ' skills carried by nothing ---');
console.log(unusedSkills.join(', ') || 'none');

// 4. A rank block that exists below its own floor, or is missing at or above it.
console.log('\n--- rank coverage ---');
for (const [id, L] of lines) {
  const from = RANKS.indexOf(L.floor);
  if (from < 0) { bad(id + ': floor "' + L.floor + '" is not a rank'); continue; }
  for (let i = 0; i < RANKS.length; i++) {
    const r = RANKS[i], has = !!L[r];
    if (i < from && has) bad(id + ': has a ' + r + ' block below its ' + L.floor + ' floor');
    if (i >= from && !has) bad(id + ': floor is ' + L.floor + ' but ' + r + ' is missing');
  }
}

// 5. Full-set totals. This is the check the bench cannot do across ranks.
console.log('\n--- full-set totals over the cap of ' + CAP + ' ---');
const totalAt = (L, r) => {
  const t = {};
  for (const p of PIECES) for (const e of (L[r]?.[p] ?? [])) t[e.k] = (t[e.k] ?? 0) + e.lvl;
  return t;
};
let overs = 0;
for (const [id, L] of lines)
  for (const r of RANKS) {
    if (!L[r]) continue;
    for (const [k, v] of Object.entries(totalAt(L, r)))
      if (v > CAP) { overs++; say('OVER', id + ' ' + r + ': ' + SK.nameOf(k) + ' ' + v + ' -> clamps to ' + CAP + ' (' + (v - CAP) + ' wasted)'); }
  }
if (!overs) console.log('none');

// 6. A skill that goes BACKWARDS as rank climbs -- a G set worse than its High.
console.log('\n--- a full set losing ground at a higher rank ---');
let drops = 0;
for (const [id, L] of lines) {
  const t = Object.fromEntries(RANKS.filter(r => L[r]).map(r => [r, totalAt(L, r)]));
  const present = RANKS.filter(r => L[r]);
  for (let i = 1; i < present.length; i++) {
    const lo = present[i - 1], hi = present[i];
    for (const k of Object.keys(t[lo]))
      if ((t[hi][k] ?? 0) < t[lo][k]) { drops++; say('DROP', id + ': ' + SK.nameOf(k) + ' ' + t[lo][k] + ' at ' + lo + ' -> ' + (t[hi][k] ?? 0) + ' at ' + hi); }
  }
}
if (!drops) console.log('none');

// 7. Identical rank blocks -- forging the G set buys literally nothing.
console.log('\n--- a higher rank identical to the one below it ---');
let sames = 0;
for (const [id, L] of lines) {
  const present = RANKS.filter(r => L[r]);
  for (let i = 1; i < present.length; i++)
    if (JSON.stringify(L[present[i - 1]]) === JSON.stringify(L[present[i]])) {
      sames++; say('SAME', id + ': ' + present[i] + ' is identical to ' + present[i - 1]);
    }
}
if (!sames) console.log('none');

// 8. Empty pieces.
console.log('\n--- empty pieces ---');
const emptyLines = [], emptyPieces = [];
for (const [id, L] of lines) {
  let any = 0, blanks = [];
  for (const r of RANKS) for (const p of PIECES) {
    if (!L[r]) continue;
    if ((L[r][p] ?? []).length) any++; else blanks.push(r + '/' + p);
  }
  if (!any) emptyLines.push(id); else if (blanks.length) emptyPieces.push(id + ': ' + blanks.join(', '));
}
console.log(emptyLines.length + ' lines entirely empty: ' + (emptyLines.join(', ') || 'none'));
console.log(emptyPieces.length + ' lines with some blank pieces');
for (const e of emptyPieces) say('BLANK', e);

// 9. Same skill twice in one piece -- the bench allows it, the merge would not.
console.log('\n--- a skill listed twice on one piece ---');
let dupes = 0;
for (const [id, L] of lines)
  for (const r of RANKS) for (const p of PIECES) {
    const ks = (L[r]?.[p] ?? []).map(e => e.k);
    if (new Set(ks).size !== ks.length) { dupes++; say('DUPE', id + ' ' + r + ' ' + p); }
  }
if (!dupes) console.log('none');

// 10. How many forge entries this becomes.
let entries = 0;
for (const [, L] of lines) for (const r of RANKS) if (L[r]) entries += PIECES.length;
console.log('\n--- size ---');
console.log(entries + ' forgeable pieces (' + lines.length + ' lines x ranks x 3)');
console.log(lines.filter(([, L]) => L.setBonus).length + ' set bonuses assigned');

console.log('\n' + (problems ? problems + ' PROBLEMS' : 'no structural problems'));
