// roll.js — resolving what is on the end of the line.
//
// Two independent rolls, in order:
//   1. WHICH FISH — from the locale's real table for the equipped bait, falling
//      back to that spot's No Bait pool. A species bait re-weights this roll.
//   2. WHICH ORE  — from the ores unlocked at your HR. An ore bait re-weights
//      this roll.
//
// Keeping them separate is what makes "target a species or an ore, never a
// specific combo" true by construction rather than by rule. It also means the
// real drop percentages survive intact: the ore layer sits on top of them and
// never edits them.

(function () {
  const G = window.MF_GAME;
  const FISH = window.MF_FISH;
  const LOCALES = window.MF_LOCALES;

  const fishById = new Map(FISH.fish.map(f => [f.id, f]));
  const localeById = new Map(LOCALES.map(l => [l.id, l]));
  const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  const pick = (list, rng) => {
    const total = list.reduce((a, e) => a + e.w, 0);
    let r = rng() * total;
    for (const e of list) { r -= e.w; if (r <= 0) return e; }
    return list[list.length - 1];
  };

  // ── The locale's pool ─────────────────────────────────────────────────────
  //
  // A locale is ONE body of water. The game splits its tables by area and by rank,
  // but you do not walk to an area — you go to the locale and cast — so every
  // table the locale offers at your rank is merged into a single pool.
  //
  // Merging keeps the rank ladder additive, which matters: the low tables are not
  // redundant. Five of the 34 rank-pairs carry a fish the rank above drops, and
  // Brocadefish appears ONLY in low tables, so reading just the top rank would
  // strand it entirely.
  //
  // Weights simply add. Each table is its own 100%, so a fish listed in several of
  // a locale's tables ends up commoner than one listed in a single table, which is
  // the right shape.

  const RANK_ORDER = ['Low', 'High', 'G'];

  // A locale is open once your rank reaches the one its first Hub quest sits at.
  // That is what decides ACCESS; which of its tables you can then read is still
  // a separate question, answered by your rank as before.
  function localeUnlocked(localeId, hr) {
    const loc = localeById.get(localeId);
    if (!loc) return false;
    if (!loc.hasFishing && !G.SHOW_DESIGNED_LOCALES) return false;
    return G.localesOpenAt(hr).includes(localeId);
  }

  // Which of the locale's own table ranks you can read at this HR.
  function ranksAt(localeId, hr) {
    const loc = localeById.get(localeId);
    if (!loc || !localeUnlocked(localeId, hr)) return [];
    const allowed = G.tableRanksAt(hr);
    if (!loc.hasFishing) return allowed.slice();
    const has = new Set();
    for (const ranks of Object.values(loc.areas))
      for (const r of Object.keys(ranks)) if (allowed.includes(r)) has.add(r);
    return RANK_ORDER.filter(r => has.has(r));
  }

  const isOpen = (localeId, hr) => ranksAt(localeId, hr).length > 0;

  // Every table the locale offers at this HR, merged. A bait reads its own table
  // where a spot has one and the rod pool where it does not.
  function basePool(localeId, hr, bait) {
    const loc = localeById.get(localeId);
    if (!loc) return [];

    if (!loc.hasFishing) {
      if (!isOpen(localeId, hr)) return [];
      const designed = G.DESIGNED_POOLS[localeId];
      const src = designed ? designed.pool : G.ARENA_POOL;
      // Hub gating can open an arena at Low Rank, but its pool is the rarest fish
      // in the game. Without this an early angler lands a Guardfish whose guide
      // row is still hidden — catchable but invisible. Rank filters the pool.
      return src
        .map(e => ({ fish: fishById.get(e.fish), w: e.pct }))
        .filter(e => e.fish && hr >= G.fishUnlockHR(e.fish));
    }

    const allowed = new Set(G.tableRanksAt(hr));
    const weight = new Map();
    for (const ranks of Object.values(loc.areas)) {
      for (const [rank, pools] of Object.entries(ranks)) {
        if (!allowed.has(rank) || !pools.length) continue;
        const byName = new Map(pools.map(p => [p.bait, p]));
        const chosen = byName.get(bait.name) || byName.get('No Bait') || pools[0];
        for (const e of chosen.entries) {
          const f = fishById.get(slug(e.name));
          if (f) weight.set(f, (weight.get(f) || 0) + e.pct);
        }
      }
    }
    return [...weight].map(([fish, w]) => ({ fish, w }));
  }

  // ── The fish roll ─────────────────────────────────────────────────────────
  //
  // A species bait multiplies its target's weight. It never adds the fish — if
  // the locale has no Goldenfish, Goldenfish Bait catches you nothing new. Bait
  // biases, it does not conjure.
  // Weighted from whatever the bait's own table offers. The bait's PROMISE — that
  // some of what swims in is the thing you asked for — is kept by rollSchool,
  // which forces that share; this is what fills the rest.
  function rollFish(localeId, hr, bait, lureLevel, rng) {
    const pool = basePool(localeId, hr, bait);
    if (!pool.length) return null;
    return pick(pool, rng).fish;
  }

  // ── The ore roll ──────────────────────────────────────────────────────────
  //
  // Independent of which fish bit. Gated by HR, weighted so rare ores stay rare,
  // shifted by the locale (Volcano is the whole reason to take the risk) and by
  // an ore bait if one is equipped.
  function rollOre(localeId, hr, bait, lureLevel, rng) {
    const ores = G.oresAt(hr);
    if (!ores.length) return null;

    const boost = G.DESIGNED_POOLS[localeId]?.oreBoost;
    let list = ores.map(o => ({
      ore: o,
      w: G.ORE_WEIGHT[o.rank] * (boost ? (boost[o.rank] ?? 1) : 1),
    }));

    return pick(list, rng).ore;
  }

  // ── A whole catch ─────────────────────────────────────────────────────────
  function rollCatch(opts) {
    const { localeId, bait, hr, lureLevel = 0, rng = Math.random,
            forceFish = null, forceOre = null } = opts;
    const fish = forceFish ? fishById.get(forceFish) : rollFish(localeId, hr, bait, lureLevel, rng);
    if (!fish) return null;
    const ore = forceOre ? G.oresAt(hr).find(o => o.id === forceOre)
      : rollOre(localeId, hr, bait, lureLevel, rng);
    if (!ore) return null;
    return {
      fish, ore,
      id: G.variantId(fish, ore),
      name: G.variantName(fish, ore),
      icon: G.variantIcon(ore),
      value: G.variantValue(fish, ore),
      xp: G.xpFor(fish, ore),
    };
  }

  // A whole school for one cast. Lure Quality adds fish to it.
  //
  // A bait SALTS the school rather than replacing it: it guarantees a share of
  // what you asked for and leaves the rest to the water, and those are the fish
  // drawn to your bobber. Filling the pond with a single species made the bait an
  // "I win" button and threw away the pool the locale actually has.
  //
  // It still never conjures. The share is only promised when the target really
  // lives here — Speartuna Bait in the Marshlands forces nothing.
  function rollSchool(opts) {
    const { localeId, bait, hr, lureLevel = 0, rng = Math.random } = opts;
    const n = G.POND.school + Math.round(lureLevel / 3);
    const pool = basePool(localeId, hr, bait);
    if (!pool.length) return [];

    // A species bait delivers wherever that fish LIVES, not merely wherever this
    // rung's tables happen to list it. Reading the rung's pool meant Guardfish
    // Bait did nothing at three locales Guardfish genuinely swims in, purely
    // because the rung read a table that omits it — which is not something a
    // player can see or reason about.
    //
    // The rank gate stays: forcing in a fish you have not unlocked would hand you
    // a catch whose guide row is still hidden.
    const fish = bait.family === 'species' ? fishById.get(bait.target) : null;
    const canForce =
      (bait.family === 'species' && !!fish
        && speciesAt(localeId).includes(bait.target)
        && hr >= G.fishUnlockHR(fish)) ||
      (bait.family === 'ore' && G.oresAt(hr).some(o => o.id === bait.target));
    // Never the whole school — there is always something else in the water.
    const promised = canForce
      ? Math.min(n - 1, Math.max(2, Math.round(n * (G.POND.baitShare + lureLevel * 0.03))))
      : 0;

    const out = [];
    for (let i = 0; i < n; i++) {
      const forced = i < promised;
      const c = rollCatch({
        localeId, bait, hr, lureLevel, rng,
        forceFish: forced && bait.family === 'species' ? bait.target : null,
        forceOre: forced && bait.family === 'ore' ? bait.target : null,
      });
      if (!c) break;
      // What the bait pulls is anything MATCHING it, not merely the ones it
      // forced in. A Scatterfish that was already swimming here is still a
      // Scatterfish, and Scatterfish Bait should mean something to it.
      c.matches = bait.family === 'species' ? c.fish.id === bait.target
        : bait.family === 'ore' ? c.ore.id === bait.target
          : false;
      out.push(c);
    }
    // Shuffle, or the bait's fish always spawn as the same slots in the pond.
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // ── Encounters ────────────────────────────────────────────────────────────
  //
  // Rolled per cast, before the fish. A boss on the line replaces the catch.
  // Plesioth only bites where monster_habitat actually puts it, and Frog raises
  // its odds sharply — the game's own description calls Frog "the ideal bait for
  // certain aquatic monsters".
  function rollEncounter(localeId, bait, hr = 1, rng = Math.random) {
    const loc = localeById.get(localeId);
    if (!loc || !loc.boss.length) return null;
    for (const name of loc.boss) {
      let chance = G.encounterChance(name, hr);
      if (G.BOSS[name]?.bait && bait.id === G.BOSS[name].bait) chance *= 4;
      if (rng() < chance) return G.BOSS[name];
    }
    return null;
  }

  // ── Small monsters ────────────────────────────────────────────────────────
  //
  // Rolled once per ordinary cast. A boss cast is left alone — it already puts
  // your whole haul on the line and does not need help.
  //
  // Which one comes at you is weighted by how many quests bring it to this
  // locale, so the common pest is the common one. How hard it hits is set by the
  // best table you can read here, so the water getting richer also gets rougher.
  const bestRank = (localeId, hr) => {
    const ranks = ranksAt(localeId, hr);
    return ranks.length ? ranks[ranks.length - 1] : 'Low';
  };

  function hireCost(localeId, hr) {
    const loc = localeById.get(localeId);
    if (!loc) return 0;
    const raw = G.HIRE.base[bestRank(localeId, hr)]
      * (G.HIRE.climate[G.climateOf(localeId)] ?? 1)
      * (loc.boss.length ? G.HIRE.danger : 1);
    return Math.round(raw / G.HIRE.round) * G.HIRE.round;
  }

  function pestChance(hired) {
    return G.PEST.chancePerCast * (hired ? 1 - G.PEST.hireCut : 1);
  }

  function rollPest(localeId, hr, hired, rng = Math.random) {
    const loc = localeById.get(localeId);
    if (!loc || !loc.pests || !loc.pests.length) return null;
    if (rng() >= pestChance(hired)) return null;
    const total = loc.pests.reduce((a, p) => a + p.w, 0);
    let x = rng() * total, hit = loc.pests[loc.pests.length - 1];
    for (const p of loc.pests) { x -= p.w; if (x <= 0) { hit = p; break; } }
    return { name: hit.name, damage: G.PEST.damage[bestRank(localeId, hr)] };
  }

  // ── What a locale is worth, and so what it asks of you ────────────────────
  //
  // Expected zenny for one cast here: the fish weights from the locale's merged
  // pool crossed with the ore weights your rank can roll. Computed rather than
  // hand-tabled so it follows the balance instead of drifting from it.
  function expectedCastValue(localeId, hr) {
    const pool = basePool(localeId, hr, { id: 'no_bait', name: 'No Bait', family: 'none' });
    if (!pool.length) return 0;
    const ores = G.oresAt(hr);
    const oreTotal = ores.reduce((a, o) => a + G.ORE_WEIGHT[o.rank], 0);
    const fishTotal = pool.reduce((a, e) => a + e.w, 0);

    let ev = 0;
    for (const { fish, w } of pool) {
      const pf = w / fishTotal;
      for (const o of ores) {
        const po = G.ORE_WEIGHT[o.rank] / oreTotal;
        ev += pf * po * G.variantValue(fish, o);
      }
    }
    return ev;
  }

  // The mean cast value across everything the rung opens. A goal leans partly on
  // this rather than purely on its own locale — see questGoal.
  function rungCastValue(hr) {
    const ids = G.localesAtHR(hr);
    const vals = ids.map(id => expectedCastValue(id, hr)).filter(Boolean);
    return vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : 0;
  }

  // The zenny a trip here must bring home to clear the quest.
  //
  // Sized purely on the locale's own worth, this could not climb: the yield
  // spread across a rank is about 4.6x, so which rung a quest sat on mattered far
  // less than which locale it happened to be. Deserted Island on HR5 asked more
  // than anything on HR6. So the goal is a BLEND — mostly the locale, partly the
  // rung it sits on — which keeps a rich locale asking more than a poor one while
  // letting rung order decide the overall climb.
  //
  // Then it is clamped to what the water can actually produce. A poor locale
  // pulled up toward its rung's mean would be asking for zenny that is not in it
  // at any stamina — Volcanic Hollow is Whetfish-only and cannot pay a Dunes goal
  // however long you stand there. The ceiling is a heavily provisioned trip, so
  // clearing a poor locale is meant to be a long grind, not an impossibility.
  const GOAL_LOCALE_SHARE = 0.55;
  const GOAL_CEILING_CASTS = 32;

  function questGoal(localeId, hr) {
    const ev = expectedCastValue(localeId, hr);
    if (!ev) return 0;
    const rung = rungCastValue(hr) || ev;
    const blended = ev * GOAL_LOCALE_SHARE + rung * (1 - GOAL_LOCALE_SHARE);
    const sized = Math.min(blended * G.goalCasts(hr), ev * GOAL_CEILING_CASTS);
    return Math.round(sized / G.GOAL_ROUND) * G.GOAL_ROUND;
  }

  // Every species a locale can ever produce, across all its ranks and bait tables.
  // Rank-independent on purpose: this answers "what lives here", which is what you
  // want when you are hunting a fish you are still missing.
  function speciesAt(localeId) {
    const loc = localeById.get(localeId);
    if (!loc) return [];
    const out = new Set();
    if (!loc.hasFishing) {
      for (const e of (G.DESIGNED_POOLS[localeId]?.pool || G.ARENA_POOL))
        if (fishById.get(e.fish)) out.add(e.fish);
      return [...out];
    }
    for (const ranks of Object.values(loc.areas))
      for (const pools of Object.values(ranks))
        for (const p of pools)
          for (const e of p.entries) {
            const f = fishById.get(slug(e.name));
            if (f) out.add(f.id);
          }
    return [...out];
  }

  // The same question asked one rank at a time. A locale's pool GROWS with rank
  // and the tables are not merely supersets of each other, so "what lives here"
  // has three different answers and the guide shows all three.
  function speciesByRank(localeId) {
    const loc = localeById.get(localeId);
    const out = { Low: [], High: [], G: [] };
    if (!loc) return out;
    if (!loc.hasFishing) {
      // A designed pool has no rank tables; it reads the same at every rank.
      const pool = (G.DESIGNED_POOLS[localeId]?.pool || G.ARENA_POOL)
        .map(e => e.fish).filter(f => fishById.get(f));
      for (const r of RANK_ORDER) out[r] = [...new Set(pool)];
      return out;
    }
    const sets = { Low: new Set(), High: new Set(), G: new Set() };
    for (const ranks of Object.values(loc.areas))
      for (const [rank, pools] of Object.entries(ranks)) {
        if (!sets[rank]) continue;
        for (const p of pools)
          for (const e of p.entries) {
            const f = fishById.get(slug(e.name));
            if (f) sets[rank].add(f.id);
          }
      }
    for (const r of RANK_ORDER) out[r] = [...sets[r]];
    return out;
  }

  // ── The full guide ────────────────────────────────────────────────────────
  // Every fish x every ore, in rarity order. This is the completion target.
  function fullGuide() {
    const out = [];
    for (const f of FISH.fish)
      for (const o of window.CF_ORES.list)
        out.push({
          id: G.variantId(f, o), name: G.variantName(f, o),
          fish: f, ore: o, icon: G.variantIcon(o),
          value: G.variantValue(f, o),
        });
    return out;
  }

  window.MF_ROLL = {
    ranksAt, isOpen, localeUnlocked, basePool, speciesAt, speciesByRank,
    expectedCastValue, rungCastValue, questGoal,
    hireCost, pestChance, rollPest, rollSchool, rollFish, rollOre, rollCatch, rollEncounter, fullGuide,
    fishById, localeById,
  };
})();
