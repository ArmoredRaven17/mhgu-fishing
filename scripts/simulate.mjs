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
                 ['data', 'meals.js'], ['data', 'canteen.js'], ['game.js'], ['roll.js']])
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
//
// Measured over SCHOOLS, not single catches. A bait no longer decides any one
// roll — it guarantees a share of the school and leaves the rest to the water —
// so asking rollCatch about it shows nothing at all.
const SPOT = { localeId: 'marshlands', hr: 12 };
const schoolShare = (baitId, key, want, n = 4000) => {
  const bait = baitBy.get(baitId);
  let hit = 0, tot = 0, drawn = 0;
  for (let i = 0; i < n; i++)
    for (const c of R.rollSchool({ ...SPOT, bait })) {
      tot++;
      if (c[key].id === want) hit++;
      if (c.matches) drawn++;
    }
  return { share: hit / tot, drawn: drawn / tot };
};

line('Bait salts the school (Marshlands, HR12)');
console.log('species bait — share of the school that is the targeted fish:');
for (const [id, target] of [['no_bait', 'scatterfish'], ['bait_scatterfish', 'scatterfish'],
                            ['no_bait', 'silverfish'], ['bait_silverfish', 'silverfish']]) {
  const r = schoolShare(id, 'fish', target);
  console.log(`  ${baitBy.get(id).name.padEnd(20)} -> ${target.padEnd(14)} ${(r.share * 100).toFixed(1).padStart(5)}%` +
    `   drawn to the bobber ${(r.drawn * 100).toFixed(0)}%`);
}
console.log('ore bait — share of the school that is the targeted ore:');
for (const [id, target] of [['no_bait', 'machalite'], ['bait_ore_machalite', 'machalite'],
                            ['no_bait', 'purecrystal'], ['bait_ore_purecrystal', 'purecrystal']]) {
  const r = schoolShare(id, 'ore', target);
  console.log(`  ${baitBy.get(id).name.padEnd(20)} -> ${target.padEnd(14)} ${(r.share * 100).toFixed(1).padStart(5)}%` +
    `   drawn to the bobber ${(r.drawn * 100).toFixed(0)}%`);
}

// The rest of the pool must survive the bait, or a locale's table stops meaning
// anything the moment you buy one.
{
  const bait = baitBy.get('bait_scatterfish');
  const seen = new Set();
  for (let i = 0; i < 2000; i++)
    for (const c of R.rollSchool({ ...SPOT, bait })) seen.add(c.fish.id);
  console.log();
  console.log(`  distinct species still turning up with Scatterfish Bait: ${seen.size}`);
}

line('Bait stocks, never conjures');
{
  const bait = baitBy.get('bait_speartuna');   // Speartuna does not live in Marshlands
  let seen = 0, fish = 0;
  for (let i = 0; i < 8000; i++)
    for (const c of R.rollSchool({ ...SPOT, bait })) { fish++; if (c.fish.id === 'speartuna') seen++; }
  console.log(`Speartuna Bait in Marshlands -> ${seen} Speartuna across ${fish.toLocaleString()} fish ` +
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

function runTrip(localeId, lo, hr, retireAt = Infinity, bailBelowHP = 0) {
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
    // Walking away is always available, and it is the whole decision: what you
    // are carrying is only yours once you are home. A real player does not decide
    // this on a cast count — they look at the HP bar, which is the information a
    // blind "retire at N" policy throws away.
    if (casts >= retireAt) break;
    if (hp <= bailBelowHP && potions <= 0 && supplyHeals <= 0) break;
    casts++;

    const enc = R.rollEncounter(localeId, bait, hr);
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
    const fight = G.fightFor(c.fish, c.ore, up.line, hr);
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
      // The GAME no longer drinks for you — the sim still does, because it models
      // a player who reaches for the pouch the moment the last one lapses. These
      // figures are therefore the best case for climate protection, not the
      // average one.
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

line('Is staying worth the risk?');
//
// The push-your-luck spine: retiring banks what you have, staying earns more but
// puts ALL of it on a cart. The question is whether walking away is ever right.
//
// Measured two ways, because they answer different things. A BLIND policy retires
// after N casts whatever is happening. An INFORMED one watches the HP bar and
// leaves when it is low and there is nothing left to heal with — which is what a
// player at the screen actually does.
{
  const where = [['ruined_pinnacle', 12, 'G Rank, Danger'],
                 ['marshlands', 9, 'G Rank, safe']];
  const runs = Math.min(TRIPS, 1500);
  const avg = (id, hr, at, bail) => {
    let take = 0, carts = 0;
    for (let i = 0; i < runs; i++) {
      const t = runTrip(id, makeLoadout({ potions: 5 }), hr, at, bail);
      if (!t) return null;
      take += t.haul; if (t.carted) carts++;
    }
    return { take: take / runs, cart: 100 * carts / runs };
  };
  for (const [id, hr, label] of where) {
    console.log(`
${R.localeById.get(id).name} — ${label}, 5 potions, no hire`);
    console.log('  policy                        take-home   cart%');
    const rows = [['fish it out', Infinity, 0]];
    for (const at of [16, 24, 32]) rows.push([`blind: stop after ${at} casts`, at, 0]);
    for (const hpAt of [30, 50, 70]) rows.push([`informed: leave under ${hpAt} HP`, Infinity, hpAt]);
    let best = { label: '', take: -1 };
    for (const [label2, at, bail] of rows) {
      const r = avg(id, hr, at, bail);
      if (!r) continue;
      if (r.take > best.take) best = { label: label2, take: r.take };
      console.log(`  ${label2.padEnd(30)}${r.take.toFixed(0).padStart(7)}z  ${r.cart.toFixed(1).padStart(6)}%`);
    }
    console.log(`  -> best: ${best.label} (${best.take.toFixed(0)}z)`);
  }
}

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

// HR13, not 12 — the meal power ladder puts the strongest dishes in G Rank+, so
// sampling at 12 would price a meal the angler cannot yet cook.
const MEAL_HR = 13;
line(`Does a meal pay for itself? (Misty Peaks, HR${MEAL_HR})`);
const sampleMeals = [G.MEALS[0], mealsByTotal[Math.floor(mealsByTotal.length * 0.25)],
  mealsByTotal[Math.floor(mealsByTotal.length * 0.6)], mealsByTotal[mealsByTotal.length - 1]];
for (const m of sampleMeals) {
  const p = profile('misty_peaks', makeLoadout({ meal: m.id }), MEAL_HR, Math.min(TRIPS, 2000));
  const gate = G.mealUnlockHR(m);
  console.log(`${m.name.padEnd(28)} cost ${String(m.cost).padStart(5)}z  casts ${p.casts.toFixed(0).padStart(3)}` +
    `  gross ${p.perTrip.toFixed(0).padStart(7)}z  net ${p.net.toFixed(0).padStart(7)}z` +
    `  opens HR${gate}`);
}

line('When does the canteen open up?');
{
  const full = {};
  for (const i of G.CANTEEN.ingredients) full[i.id] = true;
  console.log('holding every ingredient, the best meal each rank can cook:');
  for (const hr of [1, 4, 9, 13]) {
    const av = G.mealsAvailable(full, hr).filter(m => m.id !== 'none');
    const best = Math.max(...av.map(G.mealPower));
    const top = av.filter(m => G.mealPower(m) === best)[0];
    console.log(`  HR${String(hr).padEnd(3)}${G.rankAt(hr).id.padEnd(6)}` +
      `${String(av.length).padStart(3)} meals   best ${String(best).padStart(3)}  ${top.name}`);
  }
  // What a real pantry looks like: one find per trip, at the real rate.
  const LEGS = [{ hr: 1, trips: 12 }, { hr: 4, trips: 18 }, { hr: 9, trips: 22 }, { hr: 13, trips: 15 }];
  const RUNS = 3000, LANDED = 30;
  const perTrip = 1 - Math.pow(1 - G.INGREDIENT_CHANCE, LANDED);
  console.log(`
and what one actually looks like — ${(perTrip * 100).toFixed(0)}% chance of a find per trip:`);
  const tally = {};
  for (let r = 0; r < RUNS; r++) {
    const held = {};
    for (const leg of LEGS) {
      for (let t = 0; t < leg.trips; t++) {
        if (Math.random() >= perTrip) continue;
        const pool = G.CANTEEN.ingredients.filter(i => leg.hr >= G.RANK_HR[i.rank] && !held[i.id]);
        if (pool.length) held[pool[(Math.random() * pool.length) | 0].id] = true;
      }
      const av = G.mealsAvailable(held, leg.hr).filter(m => m.id !== 'none');
      const k = leg.hr;
      tally[k] = tally[k] || { ing: 0, meals: 0, best: 0 };
      tally[k].ing += Object.keys(held).length;
      tally[k].meals += av.length;
      tally[k].best += Math.max(...av.map(G.mealPower), 0);
    }
  }
  let cum = 0;
  for (const leg of LEGS) {
    cum += leg.trips;
    const a = tally[leg.hr];
    console.log(`  ${G.rankAt(leg.hr).id.padEnd(6)}by trip ${String(cum).padStart(3)}   ` +
      `${(a.ing / RUNS).toFixed(1).padStart(4)}/${G.CANTEEN.ingredients.length} ingredients   ` +
      `${(a.meals / RUNS).toFixed(1).padStart(5)} meals   best ${(a.best / RUNS).toFixed(0).padStart(3)}`);
  }
}

line('The goal ladder — does each rung ask more than the last?');
{
  // Difficulty is the goal measured against what the locale can ACTUALLY pay on a
  // provisioned trip, not the raw zenny — a rich locale should ask for more zenny
  // without being harder. Kit is the best meal that rung can cook plus 10 levels
  // of Endurance, which is roughly 74,000z of upgrades: affordable, not maxed.
  const fullPantry = {};
  for (const i of G.CANTEEN.ingredients) fullPantry[i.id] = true;
  const bestMealSta = hr =>
    Math.max(0, ...G.mealsAvailable(fullPantry, hr).map(m => m.stamina));
  const noBait = baitBy.get('no_bait');
  const grossPerTrip = (id, hr, sta, runs = 2500) => {
    let tot = 0;
    for (let r = 0; r < runs; r++) {
      let s = sta, g = 0;
      while (s >= G.STAMINA_COST.cast) {
        s -= G.STAMINA_COST.cast;
        const c = R.rollCatch({ localeId: id, bait: noBait, hr });
        if (c) {
          g += c.value;
          s -= G.STAMINA_COST.reelTick * (G.fightFor(c.fish, c.ore, 0, hr).durationMs / 1000);
        }
      }
      tot += g;
    }
    return tot / runs;
  };

  console.log('rung  casts   goal range              difficulty (goal / provisioned trip)');
  let prevMedian = 0;
  const dips = [], unreachable = [];
  for (const [hrKey, ids] of Object.entries(G.LADDER)) {
    if (!ids.length) continue;
    const hr = +hrKey, sta = G.BASE_MAX_STAMINA + bestMealSta(hr) + 80;
    const rows = ids.map(id => {
      const goal = R.questGoal(id, hr);
      return { id, goal, ratio: goal / grossPerTrip(id, hr, sta) };
    }).sort((a, b) => a.ratio - b.ratio);
    for (const r of rows) if (r.ratio > 1) unreachable.push(`${r.id} HR${hr}`);
    const median = rows[Math.floor(rows.length / 2)].ratio;
    const goals = rows.map(r => r.goal).sort((a, b) => a - b);
    if (median < prevMedian) dips.push(`HR${hr}`);
    console.log(`HR${String(hr).padEnd(4)}${String(G.goalCasts(hr)).padEnd(8)}` +
      `${(goals[0] + 'z .. ' + goals[goals.length - 1] + 'z').padEnd(24)}` +
      `median ${median.toFixed(2)}   range ${rows[0].ratio.toFixed(2)}-${rows[rows.length - 1].ratio.toFixed(2)}` +
      (median < prevMedian ? '   <-- DIPS' : ''));
    prevMedian = median;
  }
  console.log('');
  console.log('rungs where difficulty dips: ' + (dips.length ? dips.join(', ') : 'none'));
  console.log('quests needing more than 10 Endurance: ' +
    (unreachable.length ? unreachable.join(', ') : 'none'));
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
