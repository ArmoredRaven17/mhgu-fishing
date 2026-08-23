// simulate.mjs — balance harness. Run it before believing any number.
//
//   node scripts/simulate.mjs [trips]
//
// Charm Farm's lesson applies here: a cost curve is a feedback loop, not a dial.
// Always re-simulate, never extrapolate.
//
// The unit of measurement is a TRIP, not a cast. Measuring per-cast hides the
// entire risk model: stamina bounds the trip, and a cart wipes the haul, so the
// value of a locale is what you actually carry home, averaged over trips that
// sometimes end with nothing.

import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(REPO, 'docs');

global.window = {};
for (const f of [['data', 'ores.js'], ['data', 'fish.js'], ['data', 'locales.js'],
                 ['data', 'meals.js'], ['game.js'], ['roll.js']])
  require(join(DOCS, ...f));

const { MF_GAME: G, MF_ROLL: R, MF_FISH: F, MF_LOCALES: L, CF_ORES: O } = global.window;
const TRIPS = Number(process.argv[2]) || 4000;

const baits = G.buildBaits();
const baitBy = new Map(baits.map(b => [b.id, b]));
const prepBy = new Map(F.prep.map(p => [p.id, p]));
const pct = (n, d) => d ? (100 * n / d).toFixed(1) + '%' : '—';
const line = t => console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 68 - t.length)));

// ── Shape ───────────────────────────────────────────────────────────────────
line('Guide');
const guide = R.fullGuide();
console.log(`fish ${F.fish.length}  x  ores ${O.list.length}  =  ${guide.length} guide entries`);
console.log(`baits ${baits.length}: ` +
  ['none', 'species', 'ore', 'boss']
    .map(f => `${f} ${baits.filter(b => b.family === f).length}`).join(', '));

// ── Rank widening ───────────────────────────────────────────────────────────
line('What each rank opens up');
// The LAST rung of each rank, so the figures show what a rank fully opens rather
// than what its first rung happens to have.
for (const hr of [3, 6, 12, 13]) {
  const rank = G.rankAt(hr);
  const ores = G.oresAt(hr);
  const fish = new Set();
  for (const loc of L)
    for (const e of R.basePool(loc.id, hr, baitBy.get('no_bait')))
      fish.add(e.fish.id);
  const locales = L.filter(l => R.isOpen(l.id, hr)).length;
  console.log(`HR${String(hr).padEnd(3)} ${rank.name.padEnd(10)} tables ${G.tableRanksAt(hr).join('/').padEnd(12)}` +
    ` locales ${String(locales).padStart(2)}  fish ${String(fish.size).padStart(2)}  ores ${String(ores.length).padStart(2)}` +
    `  reachable ${String(fish.size * ores.length).padStart(3)}/${guide.length}`);
}

// ── Bait bias ───────────────────────────────────────────────────────────────
const SPOT = { localeId: 'marshlands', hr: 12 };
const shareOf = (baitId, key, want, n = 100000) => {
  const bait = baitBy.get(baitId);
  let hit = 0;
  for (let i = 0; i < n; i++) {
    const c = R.rollCatch({ ...SPOT, bait });
    if (c && c[key].id === want) hit++;
  }
  return hit / n;
};

line('Bait swaps the school (Marshlands, HR12)');
console.log('species bait — share of the targeted fish:');
for (const [id, target] of [['no_bait', 'scatterfish'], ['bait_scatterfish', 'scatterfish'],
                            ['no_bait', 'silverfish'], ['bait_silverfish', 'silverfish']])
  console.log(`  ${baitBy.get(id).name.padEnd(20)} -> ${target.padEnd(14)} ${pct(shareOf(id, 'fish', target) * 100, 100)}`);
console.log('ore bait — share of the targeted ore:');
for (const [id, target] of [['no_bait', 'machalite'], ['bait_ore_machalite', 'machalite'],
                            ['no_bait', 'purecrystal'], ['bait_ore_purecrystal', 'purecrystal']])
  console.log(`  ${baitBy.get(id).name.padEnd(20)} -> ${target.padEnd(14)} ${pct(shareOf(id, 'ore', target) * 100, 100)}`);

line('Bait stocks, never conjures');
{
  const bait = baitBy.get('bait_speartuna');   // Speartuna does not live in Marshlands
  let seen = 0;
  for (let i = 0; i < 50000; i++)
    if (R.rollCatch({ ...SPOT, bait })?.fish.id === 'speartuna') seen++;
  console.log(`Speartuna Bait in Marshlands -> ${seen} Speartuna in 50,000 casts ` +
    `(${seen === 0 ? 'correct, it does not live there' : 'BUG: bait conjured a fish'})`);
}

// ── Trip model ──────────────────────────────────────────────────────────────
//
// A trip runs until stamina or HP runs out. Stamina ending is soft: you go home
// with the haul. HP ending is a cart: the haul is gone. Consumables are used
// reactively, the way a player actually uses them.

function makeLoadout(spec = {}) {
  return {
    meal: G.MEALS.find(m => m.id === spec.meal) || pickMeal(spec.meal),
    potions: spec.potions ?? 5,
    rations: spec.rations ?? 5,
    coolDrinks: spec.coolDrinks ?? 3,
    hotDrinks: spec.hotDrinks ?? 3,
    upgrades: spec.upgrades ?? { vitality: 0, endurance: 0, line: 0, lure: 0 },
    baitId: spec.baitId || 'no_bait',
    hired: spec.hired ?? false,
  };
}

const cost = id => G.priceOf(prepBy.get(id));
// The hire is priced by the locale, so it cannot be folded into a flat loadout
// cost the way the consumables can — it is added per locale where it is charged.
const loadoutCost = lo =>
  lo.meal.cost
  + lo.potions * cost('potion')
  + lo.rations * cost('ration')
  + lo.coolDrinks * cost('cool_drink')
  + lo.hotDrinks * cost('hot_drink');
const tripCost = (lo, localeId, hr) =>
  loadoutCost(lo) + (lo.hired ? R.hireCost(localeId, hr) : 0);
// What a trip actually cost: the meal and the hire are paid whatever happens,
// everything else only when it is drunk.
const spentOn = (lo, localeId, hr, used) =>
  lo.meal.cost + (lo.hired ? R.hireCost(localeId, hr) : 0)
  + used.potions * cost('potion') + used.rations * cost('ration')
  + used.drinks * cost(G.climateOf(localeId) === 'hot' ? 'cool_drink' : 'hot_drink');

// Meals are real items now, so the sim picks representative ones by effect
// rather than by an invented tier name.
const mealsByTotal = [...G.MEALS].sort((a, b) => (a.hp + a.stamina) - (b.hp + b.stamina));
const pickMeal = want => {
  if (want === 'none') return G.MEALS[0];
  if (want === 'best') return mealsByTotal[mealsByTotal.length - 1];
  return mealsByTotal[Math.floor(mealsByTotal.length * 0.6)];   // a solid mid meal
};

const DRINK_SECONDS = G.DRINK_SECONDS;   // one drink covers this much fight time
const SUPPLY_EACH = G.SUPPLY_EACH;   // free supply items, Low Rank only
const SUPPLY_HEAL = 20;     // First-aid Med
const SUPPLY_STAMINA = 25;  // Ration

// A boss fight resolved statistically. Under the pond's reel model the tell is
// how wide the stretch you have to hold the line in is, against how fast it sinks
// out of that stretch when you are not pulling.
const bossWinChance = (boss, lineLvl) => {
  const f = boss.fight;
  const grace = (f.band * 2) / f.sinkPerSec;    // seconds of slack before you fall out
  return Math.min(0.9, Math.max(0.1, 0.10 + grace * 0.85 + lineLvl * 0.03));
};

function runTrip(localeId, lo, hr) {
  if (!R.isOpen(localeId, hr)) return null;
  const bait = baitBy.get(lo.baitId);
  const climate = G.climateOf(localeId);
  const rates = G.CLIMATE_RATES[climate];
  const up = lo.upgrades;

  const maxHP = G.BASE_MAX_HP + lo.meal.hp + up.vitality * 5;
  const maxSta = G.BASE_MAX_STAMINA + lo.meal.stamina + up.endurance * 8;
  let hp = maxHP, sta = maxSta;
  let potions = lo.potions, rations = lo.rations;
  // Camp hands you a supply box every trip, exactly as quest.js does. Leaving it
  // out made the sim measure a harsher game than the one that ships: 3 free
  // First-aid Med is 60 HP, which is most of a Volcano trip's heat damage.
  // Only Low Rank is handed a supply box, so above HR4 there is none.
  const supplied = G.rankAt(hr).id === G.SUPPLY_RANK;   // not a hardcoded HR
  let supplyHeals = supplied ? SUPPLY_EACH : 0;
  let supplyRations = supplied ? SUPPLY_EACH : 0;
  let drinks = climate === 'hot' ? lo.coolDrinks : climate === 'cold' ? lo.hotDrinks : 0;
  let drinkLeft = 0;

  let haul = 0, casts = 0, bosses = 0, bossWins = 0, landed = 0, pests = 0;
  // Consumables are charged when they are DRUNK, not when they are packed.
  // Carrying a potion you never need costs nothing but a pouch slot, so pricing
  // the pack made every loadout look equally expensive and hid what the pests —
  // and the hire that turns them away — actually cost you.
  const used = { potions: 0, rations: 0, drinks: 0 };

  while (sta > 0 && hp > 0 && casts < 500) {
    casts++;

    const enc = R.rollEncounter(localeId, bait);
    if (enc) {
      bosses++;
      const secs = enc.durationMs / 1000;
      sta -= G.STAMINA_COST.cast + secs * G.STAMINA_COST.reelTick * rates.staminaMult;
      if (Math.random() < bossWinChance(enc, up.line)) { haul += enc.reward; bossWins++; }
      else hp -= G.bossLossDamage(G.openedAtHR(localeId, hr));   // costs HP, not the trip
      if (hp <= 0) return { haul: 0, casts, landed, carted: true, bosses, bossWins, pests, used };
      continue;
    }

    const c = R.rollCatch({ localeId, bait, hr, lureLevel: up.lure });
    if (!c) break;
    const fight = G.fightFor(c.fish, c.ore, up.line);
    const secs = fight.durationMs / 1000;

    haul += c.value;
    landed++;

    // Climate first, so a drink taken now counts for this cast — the order the
    // app uses. A drink cancels whichever penalty the locale applies, which the
    // old `if (rates.hpPerTick)` gate never did for cold: it skipped the whole
    // block, so a Hot Drink was never drunk and cold trips were measured
    // unprotected regardless of loadout.
    if (climate !== 'temperate') {
      drinkLeft -= secs;
      if (drinkLeft <= 0 && drinks > 0) { drinks--; used.drinks++; drinkLeft = DRINK_SECONDS; }
      if (rates.hpPerTick && drinkLeft <= 0) hp -= rates.hpPerTick * secs;
    }
    const mult = (climate === 'cold' && drinkLeft > 0) ? 1 : rates.staminaMult;
    sta -= G.STAMINA_COST.cast + secs * G.STAMINA_COST.reelTick * mult;

    // Something small has a go at you. Rolled per ordinary cast, exactly as
    // quest.js does it, and the only thing that touches HP outside a hot locale.
    const pest = R.rollPest(localeId, hr, lo.hired);
    if (pest) { hp -= pest.damage; pests++; }

    // Bought items first, then the supply box — the order quest.js uses.
    if (hp < maxHP * 0.4) {
      if (potions > 0) { potions--; used.potions++; hp = Math.min(maxHP, hp + 30); }
      else if (supplyHeals > 0) { supplyHeals--; hp = Math.min(maxHP, hp + SUPPLY_HEAL); }
    }
    if (sta < maxSta * 0.25) {
      if (rations > 0) { rations--; used.rations++; sta = Math.min(maxSta, sta + 25); }
      else if (supplyRations > 0) { supplyRations--; sta = Math.min(maxSta, sta + SUPPLY_STAMINA); }
    }
  }
  return { haul, casts, landed, carted: hp <= 0, bosses, bossWins, pests, used };
}

function profile(localeId, lo, hr, trips = TRIPS) {
  let haul = 0, carts = 0, casts = 0, ran = 0, bosses = 0, landedTot = 0, pests = 0;
  let spent = 0, potionsUsed = 0;
  for (let i = 0; i < trips; i++) {
    const t = runTrip(localeId, lo, hr);
    if (!t) return null;
    ran++; haul += t.haul; casts += t.casts; bosses += t.bosses; landedTot += t.landed;
    pests += t.pests; spent += spentOn(lo, localeId, hr, t.used); potionsUsed += t.used.potions;
    if (t.carted) carts++;
  }
  const cost = spent / ran;
  return {
    perTrip: haul / ran, cost, net: haul / ran - cost, landed: landedTot / ran,
    cartRate: carts / ran, casts: casts / ran, bosses: bosses / ran, pests: pests / ran,
    potions: potionsUsed / ran,
  };
}

line(`Trip value at HR12 — hearty meal, 5 potions, 5 rations, 3 of each drink (${TRIPS} trips each)`);
const lo = makeLoadout();
console.log(`loadout cost ${loadoutCost(lo).toLocaleString()}z per trip\n`);
console.log('locale               climate      casts   gross z    net z   cart%   note');
const rows = [];
for (const loc of L) {
  const p = profile(loc.id, lo, 12);
  if (!p) continue;
  rows.push({ name: loc.name, climate: G.climateOf(loc.id), designed: !loc.hasFishing, ...p });
}
rows.sort((a, b) => b.net - a.net);
for (const r of rows)
  console.log(`${r.name.padEnd(20)} ${r.climate.padEnd(10)} ${r.casts.toFixed(0).padStart(6)}` +
    ` ${r.perTrip.toFixed(0).padStart(9)} ${r.net.toFixed(0).padStart(8)}` +
    `  ${(r.cartRate * 100).toFixed(1).padStart(5)}%   ${r.designed ? 'designed' : ''}`);

line('Is a Hunter for Hire worth it?');
{
  console.log('locale               price   | unhired casts   net z cart%  hits  pots' +
    '  | hired casts   net z cart%  hits  pots');
  for (const loc of L) {
    if (!loc.hasFishing || !loc.pests.length) continue;
    const hr = loc.rank === 'Low' ? 4 : loc.rank === 'High' ? 7 : 12;
    // Both sides carry plenty, so the comparison measures what the trip NEEDED
    // rather than where the pouch ran dry.
    const off = profile(loc.id, makeLoadout({ hired: false, potions: 10 }), hr, Math.min(TRIPS, 1500));
    const on = profile(loc.id, makeLoadout({ hired: true, potions: 10 }), hr, Math.min(TRIPS, 1500));
    if (!off || !on) continue;
    const better = on.net > off.net ? ' <-' : '';
    console.log(loc.name.padEnd(20) + String(R.hireCost(loc.id, hr)).padStart(6) + 'z  |' +
      off.casts.toFixed(0).padStart(8) + off.net.toFixed(0).padStart(8) +
      (off.cartRate * 100).toFixed(1).padStart(6) + '%' + off.pests.toFixed(1).padStart(6) +
      off.potions.toFixed(1).padStart(6) + '  |' +
      on.casts.toFixed(0).padStart(7) + on.net.toFixed(0).padStart(8) +
      (on.cartRate * 100).toFixed(1).padStart(6) + '%' + on.pests.toFixed(1).padStart(6) +
      on.potions.toFixed(1).padStart(6) + better);
  }
  console.log();
  console.log('  <- marks where paying for the watch actually nets you more.');
}

line('Is Volcanic Hollow worth the heat?');
{
  // The old Volcano locale has no fishing table and is hidden, so the hot-and-
  // expensive question now belongs to Volcanic Hollow, which players can reach.
  const v = rows.find(r => r.name === 'Volcanic Hollow');
  const temperate = rows.filter(r => r.climate === 'temperate' && !r.designed);
  const avg = temperate.reduce((a, r) => a + r.net, 0) / temperate.length;
  console.log(`Volcanic Hollow net${v.net.toFixed(0).padStart(9)}z/trip   cart ${(v.cartRate * 100).toFixed(1)}%  casts ${v.casts.toFixed(0)}`);
  console.log(`temperate average  ${avg.toFixed(0).padStart(9)}z/trip`);
  const ratio = v.net / avg;
  console.log(`ratio              ${ratio.toFixed(2).padStart(9)}x`);
  console.log(ratio > 3 ? '  -> TOO STRONG. Lower the ore boost or the pool.'
    : ratio < 0.6 ? '  -> TOO WEAK. The heat costs more than the water is worth.'
      : '  -> in band.');

  // What the heat actually costs, isolated. Compare GROSS haul: charging 99
  // drinks against net would just measure their price, not the protection.
  const p0 = profile('volcanic_hollow', { ...lo, coolDrinks: 0 }, 12);
  const p9 = profile('volcanic_hollow', { ...lo, coolDrinks: 99 }, 12);
  console.log();
  console.log('heat, isolated (gross haul, drinks not charged):');
  const heat = (label, p) => console.log(`  ${label.padEnd(20)} ${p.perTrip.toFixed(0).padStart(8)}z` +
    `  casts ${p.casts.toFixed(0).padStart(3)}  cart ${(p.cartRate * 100).toFixed(1)}%`);
  heat('no Cool Drinks', p0);
  heat('3 Cool Drinks', v);
  heat('unlimited', p9);
}

line('Does a meal pay for itself? (Misty Peaks, HR12)');
const sampleMeals = [G.MEALS[0], mealsByTotal[Math.floor(mealsByTotal.length * 0.25)],
  mealsByTotal[Math.floor(mealsByTotal.length * 0.6)], mealsByTotal[mealsByTotal.length - 1]];
for (const m of sampleMeals) {
  const p = profile('misty_peaks', makeLoadout({ meal: m.id }), 12, Math.min(TRIPS, 2000));
  console.log(`${m.name.padEnd(28)} cost ${String(m.cost).padStart(5)}z  casts ${p.casts.toFixed(0).padStart(3)}` +
    `  gross ${p.perTrip.toFixed(0).padStart(7)}z  net ${p.net.toFixed(0).padStart(7)}z`);
}

line('The long pole — how many trips to fill the guide?');
{
  const found = new Set();
  let trips = 0, casts = 0;
  const open = id => R.isOpen(id, 13);
  const locs = L.filter(l => open(l.id));
  const l2 = makeLoadout({ meal: 'best' });
  while (found.size < guide.length && trips < 200000) {
    const loc = locs[(Math.random() * locs.length) | 0];
    trips++;
    for (let i = 0; i < 25; i++) {
      const c = R.rollCatch({ localeId: loc.id, bait: baitBy.get(l2.baitId), hr: 13 });
      casts++;
      if (c) found.add(c.id);
    }
  }
  console.log(`HR13, random locale, No Bait: ${found.size}/${guide.length} variants after ` +
    `${trips.toLocaleString()} trips (${casts.toLocaleString()} casts)`);
  const missing = guide.filter(g => !found.has(g.id));
  if (missing.length) console.log(`missing ${missing.length}: ${missing.slice(0, 8).map(m => m.name).join(', ')}`);
}
console.log();
