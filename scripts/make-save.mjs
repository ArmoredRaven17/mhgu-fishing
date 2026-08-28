// make-save.mjs — writes a save at a named point in the campaign.
//
// Generated rather than hand-written so it cannot go stale. Every id it uses is
// read out of the real data and the real game layer, so a new fish, ore, bait,
// armor line or monster part lands in the save the next time this is run instead
// of quietly going missing from it.
//
//   node scripts/make-save.mjs [stage] [outfile]
//
//   endgame   HR13, G Rank+, everything unlocked, forged and stocked  (default)
//   lowrank   HR3, the end of Low Rank with the promotion not yet earned
//
// Load the result with Open in the app's save menu.
//
// Three fields have shapes that are easy to get inside out, and getting one wrong
// produces a save that LOADS but shows nothing:
//
//   caught    variantId -> count              (a number, not a flag)
//   caughtAt  localeId  -> { fishId: count }  keyed by LOCALE, not by variant
//   visited   hr        -> { localeId: true } keyed by HR, not by locale
//
// The Locales screen is built entirely from caughtAt, so inverting it leaves that
// screen blank however much else is unlocked.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = (process.argv[2] || 'endgame').toLowerCase();
const OUT = process.argv[3] || join(REPO, `mhgu-fishing-${STAGE}.json`);

globalThis.window = globalThis;
for (const f of ['data/ores.js', 'data/fish.js', 'data/locales.js', 'data/meals.js',
                 'data/canteen.js', 'data/armorlines.js', 'game.js', 'roll.js']) {
  new Function(readFileSync(join(REPO, 'docs', f), 'utf8')).call(globalThis);
}

const G = globalThis.MF_GAME;
const FISH = globalThis.MF_FISH;
const ORES = globalThis.CF_ORES;
const LOCALES = globalThis.MF_LOCALES;
const CANTEEN = globalThis.MF_CANTEEN;
const R = globalThis.MF_ROLL;
const RANKS = ['Low', 'High', 'G'];

const every = (list, val, key = i => i.id) =>
  Object.fromEntries(list.map(i => [key(i), typeof val === 'function' ? val(i) : val]));

// ── What each stage is ──────────────────────────────────────────────────────
//
// `hr` is where you stand. `ranks` is which table ranks you have read. `holdBack`
// names locales on your current rung you have NOT finished — the whole point of
// the lowrank save is that the promotion is still in front of you, and fishing
// every rung locale is exactly what earns it.
const STAGES = {
  endgame: {
    hr: G.MAX_LADDER_HR, rank: 'Gplus', ranks: RANKS,
    zenny: 500000, holdBack: [],
    gearLevel: () => G.ARMOR_LEVELS, ownAllGear: true, cartLevel: G.TRADE_CART_MAX,
    stock: id => Math.min(G.STOCK_CAP, G.ownCap(id)),
    parts: 30,
    stats: { trips: 250, carts: 12, casts: 9000, landed: 7400, lost: 1600, bosses: 180, pests: 900 },
    // Nakarkos landed, which is the only thing that puts you at HR13 at all.
    beatFinal: true,
  },
  lowrank: {
    hr: 3, rank: 'Low', ranks: ['Low'],
    zenny: 14500, holdBack: ['misty_peaks'],
    gearLevel: () => 2, ownAllGear: false, cartLevel: 0,
    // A Low Rank pouch is a working pouch, not a warehouse.
    stock: id => Math.min(G.ownCap(id), 12),
    parts: 4,
    stats: { trips: 22, carts: 3, casts: 620, landed: 470, lost: 150, bosses: 9, pests: 74 },
  },
};

const S = STAGES[STAGE];
if (!S) {
  console.error(`unknown stage "${STAGE}". Known: ${Object.keys(STAGES).join(', ')}`);
  process.exit(1);
}

const rankOK = r => S.ranks.includes(r);
const hrOK = n => n <= S.hr;

// ── Where you have actually been ────────────────────────────────────────────
//
// Only locales on a rung you have reached, minus whatever is held back. Reading
// "every locale that happens to hold a Low Rank fish" instead credits a Low Rank
// angler with water on the G ladder they have never seen.
const beenTo = new Set();
for (let hr = 1; hr <= S.hr; hr++)
  for (const id of G.localesAtHR(hr) || [])
    if (!S.holdBack.includes(id)) beenTo.add(id);
// Wyvern's End is on no rung, so the loop above cannot reach it. A stage that has
// finished the ladder has been there, by definition — it is the only way to be
// standing at HR13 at all.
const clearedFinal = !!S.beatFinal;
if (clearedFinal) beenTo.add(G.FINAL_LOCALE);

// ── What you have caught ────────────────────────────────────────────────────
const ores = ORES.list.filter(o => G.oreUnlockHR(o) <= S.hr);
const fish = FISH.fish.filter(f => G.fishUnlockHR(f) <= S.hr);

const caught = {};
for (const f of fish) for (const o of ores) caught[G.variantId(f, o)] = 1;

// Credited to the locales that genuinely hold each fish, read from the real
// per-rank species tables. Crediting a fish to water it does not live in would
// make the Locales screen lie about the game's own data.
const caughtAt = {};
for (const loc of LOCALES) {
  if (!beenTo.has(loc.id)) continue;
  const per = R.speciesByRank(loc.id);
  const here = [...new Set(S.ranks.flatMap(r => per[r] || []))]
    .filter(id => fish.some(f => f.id === id));
  if (!here.length) continue;
  caughtAt[loc.id] = Object.fromEntries(here.map((f, i) => [f, 1 + (i % 4)]));
}

// Visited at every rung up to where you stand, minus whatever is held back.
const visited = {};
for (let hr = 1; hr <= S.hr; hr++) {
  const rung = (G.localesAtHR(hr) || []).filter(id => !S.holdBack.includes(id));
  if (rung.length) visited[hr] = Object.fromEntries(rung.map(id => [id, true]));
}
// ...and the clear mark for the arena, recorded at the rung it is actually fished
// on — your own, since it belongs to none.
if (clearedFinal) {
  visited[S.hr] = { ...(visited[S.hr] || {}), [G.FINAL_LOCALE]: true };
}

// ...and which tables you have read where.
const readHere = {};
for (const l of LOCALES) {
  if (!beenTo.has(l.id)) continue;
  const seen = {};
  for (const r of S.ranks) seen[r] = true;
  readHere[l.id] = seen;
}

// ── Gear ────────────────────────────────────────────────────────────────────
const rods = G.RODS.filter(r => rankOK(r.rank));
const armors = G.ARMORS.filter(a => a.forgeable && rankOK(a.rank));
const gearOwned = { rod_old: 0 };
for (const r of rods) gearOwned[r.id] = S.gearLevel();
// At Low Rank you have forged the set whose monster you have actually been
// meeting, not all four of them.
const armorOwned = S.ownAllGear ? armors : armors.filter(a => a.line === 'cephalos');
for (const a of armorOwned) gearOwned[a.id] = S.gearLevel();

const bestRod = rods[rods.length - 1] || G.RODS[0];
// A worn SET now, one slot at a time. Picking the best piece per slot from the
// best line available is what a player at this stage would actually be wearing,
// and keeping all three on ONE line means these saves exercise the set bonus
// rather than always testing the mixed case.
const wornLine = S.ownAllGear ? 'lavasioth' : 'cephalos';
const bestPieces = {};
for (const slot of G.PIECE_SLOTS) {
  const forSlot = armorOwned.filter(a => a.slot === slot && a.line === wornLine);
  bestPieces[slot] = forSlot[forSlot.length - 1]
    || armorOwned.filter(a => a.slot === slot).pop() || null;
}

// Parts you would plausibly be holding: only from monsters you can actually meet.
const mats = {};
for (const m of G.MONSTER_MATS) {
  if (!rankOK(m.rank)) continue;
  const boss = Object.values(G.BOSS).find(b => b.line === m.line);
  if (boss && !G.bossMeetableAt(boss.name, m.rank)) continue;
  mats[m.id] = S.parts;
}

// ── The monster log ─────────────────────────────────────────────────────────
const monsters = {};
for (const [name, b] of Object.entries(G.BOSS)) {
  const ranks = {};
  for (const r of S.ranks) if (G.bossMeetableAt(name, r)) ranks[r] = true;
  if (!Object.keys(ranks).length) continue;       // never met, so no entry at all
  const met = S.ownAllGear ? 12 + Math.round(b.tier * 10) : 2 + Math.round(b.tier * 3);
  monsters[name] = { met, landed: Math.round(met * (S.ownAllGear ? 0.65 : 0.5)), ranks };
}

const state = {
  hr: S.hr,
  cartLevel: S.cartLevel || 0,
  rank: S.rank,
  xp: 0,
  zenny: S.zenny,

  visited,
  fishedAt: readHere,
  caught,
  caughtAt,

  pantry: every(CANTEEN.ingredients.filter(i => hrOK(G.RANK_HR[i.rank])), true),
  freshOrder: [],

  owned: every(G.buildBaits().filter(b => b.id !== 'no_bait' && hrOK(G.baitUnlockHR(b))),
               b => S.stock(b.id)),
  pouch: every(G.pouchItems().filter(p => hrOK(G.itemUnlockHR(p))), p => S.stock(p.id)),
  matsSeen: every(G.MATERIALS.filter(m => hrOK(G.itemUnlockHR(G.pouchItemById.get(m.id) || {}))), true),

  monsters,
  mats,
  gearOwned,
  gear: {
    rod: { id: bestRod.id, lvl: gearOwned[bestRod.id] || 0 },
    ...Object.fromEntries(G.PIECE_SLOTS.map(slot => [slot, bestPieces[slot]
      ? { id: bestPieces[slot].id, lvl: gearOwned[bestPieces[slot].id] || 0 } : null])),
  },
  // The four retired sliders, left at zero so the refund migration has nothing to
  // pay out — these saves were never on the old system.
  upgrades: { vitality: 0, endurance: 0, line: 0, lure: 0 },

  palicos: S.ownAllGear ? G.PALICO.max : 1,
  hired: S.ownAllGear,
  spaceToCast: true,
  tradeItem: '',

  localeId: S.holdBack[0] || 'deserted_island',
  questHR: S.hr,
  baitId: 'no_bait',
  mealId: 'none',
  plan: {},
  tackle: {},

  stats: S.stats,
};

writeFileSync(OUT, JSON.stringify({
  app: 'mhgu-fishing', version: 1, savedAt: new Date().toISOString(), state,
}, null, 1) + '\n', 'utf8');

console.log(`wrote ${OUT}`);
console.log(`  stage ${STAGE} — HR ${state.hr} (${G.rankAt(state.hr).name}), ${state.zenny.toLocaleString()}z`);
console.log(`  ${Object.keys(caught).length} of ${FISH.fish.length * ORES.list.length} variants, ` +
            `${Object.keys(state.pantry).length} of ${CANTEEN.ingredients.length} ingredients`);
console.log(`  ${Object.keys(caughtAt).length} locales fished, ${Object.keys(visited).length} rungs visited` +
            (S.holdBack.length ? `, still to do: ${S.holdBack.join(', ')}` : ''));
console.log(`  ${Object.keys(state.owned).length} baits, ${Object.keys(state.pouch).length} pouch items`);
console.log(`  ${Object.keys(gearOwned).length} gear pieces, ${Object.keys(mats).length} monster parts, ` +
            `${Object.keys(monsters).length} monsters met`);
if (clearedFinal) console.log(`  ${G.FINAL_BOSS} landed — ${G.FINAL_LOCALE} cleared`);
console.log(`  wearing ${bestRod.name}` + (G.PIECE_SLOTS.some(sl => bestPieces[sl])
  ? ` and ${G.PIECE_SLOTS.map(sl => bestPieces[sl] ? bestPieces[sl].name : '—').join(' / ')}` : ''));
