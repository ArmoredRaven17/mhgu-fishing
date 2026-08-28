// game.js — the game-design layer. EVERYTHING invented lives here.
//
// docs/data/*.js is transcribed fact: real fish, real ores, real per-locale
// fishing tables straight off the game's own numbers. Nothing in those files was
// made up. This file is the opposite — it is all design, and it is kept separate
// so the line never blurs. Same discipline ores.js states in its own header.
//
// Invented here: ore variants of each fish, the bait families that target them,
// the reel-struggle curves, stamina/HP rates, climate, encounter rates, the HR
// ladder, meals, upgrades, and the designed pools for locales the game gives no
// fishing data for.

(function () {
  const FISH = window.MF_FISH;
  const ORES = window.CF_ORES;
  const CANTEEN = window.MF_CANTEEN || { ingredients: [], recipes: [] };

  // ── Rank ladder ───────────────────────────────────────────────────────────
  //
  // HR gates both axes of the guide at once: each promotion adds new base fish
  // (from the real Low/High/G tables) AND new ore variants (from ores.js rank
  // gates). The grid fills diagonally rather than row by row.

  // Promotion is earned by WHERE you have fished, not by how much XP you have.
  // You move up once you have completed a quest at every locale your current rank
  // opens — so the ladder is "see everything here, then move on" rather than
  // "grind anywhere". Each rank tracks its own visits, because a Low Rank trip to
  // Verdant Hills is not a High Rank trip to Verdant Hills.
  //
  // XP does nothing until G Rank+, which is the only band where HR climbs.
  const RANKS = [
    { id: 'Low',   name: 'Low Rank',  baseHR: 1,  oreRank: 0, next: 'High' },
    { id: 'High',  name: 'High Rank', baseHR: 4,  oreRank: 1, next: 'G' },
    { id: 'G',     name: 'G Rank',    baseHR: 9,  oreRank: 2, next: 'Gplus' },
    { id: 'Gplus', name: 'G Rank+',   baseHR: 13, oreRank: 2, plus: true },
  ];
  const RANK_BY_ID = new Map(RANKS.map(r => [r.id, r]));
  const rankById = id => RANK_BY_ID.get(id) || RANKS[0];

  // The HR each table rank opens at. Everything that unlocks does so on one of
  // these three, so a bait, a fish and an ore all speak the same language.
  const RANK_HR = { Low: 1, High: 4, G: 9 };
  // The rank a CURVE should use: G Rank+ is G Rank, played past the ladder's end.
  const curveRank = hr => { const r = rankAt(hr).id; return r === 'Gplus' ? 'G' : r; };
  const ORE_RANK_HR = [1, 4, 9];            // by ores.js rank 0/1/2

  // Fish and varieties take their unlock from the data — the rank a fish first
  // swims at, and an ore's own rank. Provisions are hand-set item by item in
  // ITEM_EFFECT below, because nothing about them implies a rank.
  const fishUnlockHR = f => RANK_HR[f.firstRank] || 1;
  const oreUnlockHR = o => ORE_RANK_HR[o.rank] ?? 1;

  function baitUnlockHR(b) {
    if (b.family === 'species') {
      const f = FISH.fish.find(x => x.id === b.target);
      return f ? fishUnlockHR(f) : 1;
    }
    if (b.family === 'ore') {
      const o = ORES.list.find(x => x.id === b.target);
      return o ? oreUnlockHR(o) : 1;
    }
    return 1;
  }

  // Shown on anything that unlocks. Their names already say what they do, so this
  // is the one line worth spending on them.
  const unlockLabel = hr => hr <= 1 ? 'Unlocked from the start' : `Unlocked at HR ${hr}`;

  // Still keyed off HR because every unlock in the app is, and HR is now derived
  // from the rank rather than the other way round.
  // Read off RANKS rather than repeating its numbers. The thresholds used to be
  // written out again here, so moving a rank's baseHR silently did nothing and
  // the two disagreed — which is how HR4 ended up labelled Low Rank while the
  // table said High.
  const RANK_DESC = [...RANKS].sort((a, b) => b.baseHR - a.baseHR);
  function rankAt(hr) {
    return RANK_DESC.find(r => hr >= r.baseHR) || RANKS[0];
  }

  // The HR a rank sits at. Only G Rank+ moves, and only on XP.
  const hrForRank = (id, gplusLevels = 0) =>
    rankById(id).baseHR + (id === 'Gplus' ? gplusLevels : 0);

  // Which real table ranks are readable at a given HR. Additive: High rank
  // anglers still fish the Low tables, they just also reach the High ones.
  function tableRanksAt(hr) {
    const oreRank = rankAt(hr).oreRank;
    return ['Low', 'High', 'G'].slice(0, oreRank + 1);
  }

  // XP per catch scales off the fish's real rarity. Deliberately shallow — the
  // long pole is meant to be the guide, not the ladder.
  const xpFor = (fish, ore) => Math.round((fish.rarity ** 1.6) * (1 + ore.rank * 0.75));
  const hrThreshold = hr => Math.round(120 * Math.pow(hr, 1.85));

  // ── Ore variants ──────────────────────────────────────────────────────────
  //
  // Every fish x every ore is a distinct catch. The prefix is the ore's name with
  // its material suffix trimmed, so the variant reads as a fish rather than as an
  // ore: "Machalite Whetfish", not "Machalite Ore Whetfish". Lightcrystal and
  // Purecrystal have no suffix to trim and stay whole.

  const ORE_PREFIX = {
    iron: 'Iron', earth: 'Earth', machalite: 'Machalite', dragonite: 'Dragonite',
    carbalite: 'Carbalite', fucium: 'Fucium', lightcrystal: 'Lightcrystal',
    firecell: 'Firecell', eltalite: 'Eltalite', allfire: 'Allfire',
    purecrystal: 'Purecrystal', ultimas: 'Ultimas',
  };

  const variantName = (fish, ore) => `${ORE_PREFIX[ore.id]} ${fish.name}`;
  const variantId = (fish, ore) => `${ore.id}__${fish.id}`;

  // A variant's icon is the fish icon in that ore's colour — a real asset, not a
  // CSS filter. Two ore pairs share a colour (Iron/Lightcrystal grey, Eltalite/
  // Allfire red); the names still distinguish them.
  // Icons are keyed by the ore's COLOUR, so Iron shares a file with Lightcrystal
  // and Eltalite with Allfire. These two wanted their own shade without moving
  // the ore beside them, so each has a file of its own — the real glyph with only
  // its body shades shifted, outline and proportions untouched.
  const ORE_ICON = {
    iron: 'MH4G-Fish_Icon_Grey_Dark.png',       // Grey, a touch darker
    eltalite: 'MH4G-Fish_Icon_Red_Light.png',   // Red, a touch lighter
  };
  const variantIcon = ore =>
    ORE_ICON[ore.id] || `MH4G-Fish_Icon_${ore.color.replace(/ /g, '_')}.png`;

  // Ore colours as hex, for tinting. The real MH4G-Fish_Icon_<Color>.png set is
  // not in hand — Kiranico blocks crawling and the wiki is not trustworthy — so
  // the guide draws a tinted silhouette instead. variantIcon() above already
  // returns the right filename, so dropping the real art in is a one-line change.
  const ORE_HEX = {
    White: '#e9e9e6', Red: '#d64a4a', Green: '#5bb85f', Blue: '#4a7fd6',
    Yellow: '#e3c545', Purple: '#a05fc0', 'Light Blue': '#6fc9e0',
    Orange: '#e08b41', Pink: '#e07ba8', Grey: '#98a0a8', Cyan: '#3fd0c4',
  };
  // A few ores want their own shade rather than their colour family's. Iron and
  // Lightcrystal are both Grey and Eltalite and Allfire are both Red, so nudging
  // the family would move two ores at once — these override just the one.
  // Matched to the icon shifts above, so a chip and its fish never disagree.
  const ORE_TINT = {
    iron: '#848c94',        // Grey #98a0a8, a touch darker
    eltalite: '#e26461',    // Red  #d64a4a, a touch lighter
  };
  const oreHex = ore => ORE_TINT[ore.id] || ORE_HEX[ore.color] || ORE_HEX.Grey;

  // Rarer ores are rarer catches. Weights are within-rank; the rank gate decides
  // which ores are in the running at all.
  const ORE_WEIGHT = { 0: 100, 1: 34, 2: 9 };

  function oresAt(hr) {
    const max = rankAt(hr).oreRank;
    return ORES.list.filter(o => o.rank <= max);
  }

  // Value: the fish's real sell price, lifted by the ore. G-rank ore variants of
  // a good fish are the money, which is what makes Volcano worth the risk.
  const ORE_VALUE_MULT = { 0: 1, 1: 1.8, 2: 3.2 };
  const variantValue = (fish, ore) =>
    Math.round(fish.sell * ORE_VALUE_MULT[ore.rank] + ore.sell * 0.04);

  // ── Baits ─────────────────────────────────────────────────────────────────
  //
  // You equip ONE bait. Its family decides which axis of the grid you bias, so a
  // player can chase a species or chase an ore but never a specific combo.
  //
  //   generic  — no bias. Real tables exist for these.
  //   category — Burst Bait, real, targets fish that rupture.
  //   species  — one per fish. Sushifish and Goldenfish Bait are real and have
  //              real tables; the other 18 are designed and work by bias.
  //   ore      — one per ore, all designed. Bias the ore roll only.
  //   (a monster bait existed here and is withheld — see buildBaits)
  //
  // A bait SWAPS THE SCHOOL. Casting with one clears the pond of anything that
  // does not match and fills it with what does: a species bait stocks that fish
  // with its variety still rolled, a variety bait stocks that variety with the
  // species still rolled. It is spent on the attempt — landed, snapped or missed
  // — and the school is re-rolled after.
  //
  // A bait still never CONJURES. If the species does not live in this water the
  // bait cannot summon it, and the cast falls back to whatever is really there.
  // That keeps every real table honest.

  const realBaits = new Map(FISH.baits.map(b => [b.name, b]));

  // Only six tinted bait icons exist, so a designed bait borrows the nearest one
  // its target's colour allows and falls back to grey. Real baits keep the exact
  // file the save editor maps them to.
  const BAIT_ICON_COLOURS = new Set(['Blue', 'Grey', 'Orange', 'Pink', 'Red', 'Yellow']);
  const baitIconFor = colour => {
    const c = (colour || 'Grey').replace(/ /g, '_');
    return `assets/BaitIcons/MH4G-Bait_Icon_${BAIT_ICON_COLOURS.has(c) ? c : 'Grey'}.png`;
  };
  const realIcon = r => r.icon ? `assets/ItemIcons/${r.icon}` : baitIconFor(r.color);

  function buildBaits() {
    const out = [];
    // Not a bait — the free baseline, and the pool every designed bait biases.
    out.push({ id: 'no_bait', name: 'No Bait', family: 'none', buy: 0,
      icon: baitIconFor('Grey'),
      desc: 'Just the rod.' });
    for (const f of FISH.fish) {
      const realName = `${f.name} Bait`;
      const r = realBaits.get(realName);
      out.push({
        id: `bait_${f.id}`, name: realName, family: 'species', target: f.id,
        targetName: `Rarity ${f.rarity}`,
        buy: r ? r.buy : speciesBaitPrice(f), real: !!r, color: r ? r.color : f.color,
        icon: r ? realIcon(r) : baitIconFor(f.color),
        desc: r ? r.desc : `A nugget-shaped fishing lure that makes ${f.name} go "mmm."`,
      });
    }
    for (const o of ORES.list) {
      out.push({
        id: `bait_ore_${o.id}`, name: `${ORE_PREFIX[o.id]} Bait`, family: 'ore',
        target: o.id, targetName: `${['Low', 'High', 'G'][o.rank]} Rank and up`,
        buy: oreBaitPrice(o), color: o.color, icon: baitIconFor(o.color),
        desc: `Chum ground through ${o.name}. Fish that take it come up the same colour.`,
      });
    }
    // Mega Fishing Fly and Burst Bait are NOT baits here. Both are real, and both
    // have their own real tables in the locale data, but neither is offered:
    // Burst Bait is dropped outright, and Mega Fishing Fly exists only as the
    // combine material every bait recipe consumes — see ITEM_EFFECT.
    //
    // The cost of that is worth naming, because it is invisible: 96 of the game's
    // 227 bait tables are keyed to those two names, so basePool falls through to
    // the No Bait pool for all of them.

    // No Frog for now. Deliberately withheld so a large monster is something that
    // happens TO you rather than something you go and fetch — the encounter is a
    // risk you accept by fishing a locale, not a purchase. The item is still in
    // the data; re-offering it means restoring this push and Plesioth's `bait`.
    return out;
  }

  // Designed species baits price off the fish's own worth, anchored so the two
  // real ones stay in the right neighbourhood (Sushifish 20z, Goldenfish 300z).
  const speciesBaitPrice = f => Math.max(20, Math.round(f.sell * 0.6 / 10) * 10);
  // Ore baits price off the ore, so a Purecrystal Bait is a real commitment.
  const oreBaitPrice = o => Math.max(40, Math.round(o.sell * 0.35 / 10) * 10);

  // ── Locales the game gives no fishing data for ────────────────────────────
  //
  // Volcano has 1,269 gathering rows and zero fishing rows — the game simply does
  // not fish there. It gets a designed pool because it earns one: it is the
  // rare-ore locale, and the only place Lavasioth lives.
  //
  // The 12 arenas have no gathering worth the name (<=30 rows, Forlorn Citadel 0).
  // They used to hold the six fish-icon items that appear in no real table, but
  // those turned out not to be fish at all — Burnt Fish is a fish burnt to a
  // crisp, Rare Fish is lightly braised, Gourmet Fish is a heal item — so the
  // roster now excludes them entirely (see build-data.mjs). The arenas instead
  // pay in the rarest real fish, which suits an HR13 gate.

  // The 12 locales the game defines no fishing for — Volcano, the arenas, the
  // slaygrounds and the rest — are hidden until they are given a purpose of their
  // own (special or urgent quests, most likely). Their designed pools, boss
  // placement and Hub gating all stay in the data and the build; flipping this to
  // true is the only thing needed to bring them back.
  const SHOW_DESIGNED_LOCALES = false;

  // ...except this one, which is designed AND shown. It is the endgame locale and
  // the only non-fishing locale with a reason to exist, so it is allowed through
  // the hasFishing gate by name rather than by flipping the flag above and
  // letting eleven unfinished locales out with it.
  const SPECIAL_LOCALES = new Set(['wyvern_s_end']);
  const isSpecialLocale = id => SPECIAL_LOCALES.has(id);

  const RANK_ORDER = ['Low', 'High', 'G', 'Gplus'];
  const rankIndex = id => Math.max(0, RANK_ORDER.indexOf(id));

  // ── The ladder ────────────────────────────────────────────────────────────
  //
  // Each HR opens its own locales, and each RANK rebuilds from scratch: promotion
  // to High reopens the Low locales at High tables before adding new ones, and G
  // does the same again. So the pool grows 7 -> 11 -> 14 across the ranks while
  // each individual rung stays a short list.
  //
  // Ordering inside a rank is by hazard — the safe locales first, then Cold, then
  // Hot and Danger, with Desert (the only Hot AND Danger locale) on the last rung
  // before G Rank+.
  //
  // Hand-set, because "which locales open at HR6" is a pacing decision that no
  // data can answer. HR8 is deliberately empty and is passed straight through.
  const LADDER = {
    // Low Rank — three rungs, and the last takes the remaining three locales.
    1:  ['jurassic_frontier', 'verdant_hills'],
    2:  ['marshlands', 'arctic_ridge'],
    3:  ['dunes', 'deserted_island', 'misty_peaks'],
    // High Rank opens at HR4 — the Low seven return at High tables, plus four new
    4:  ['jurassic_frontier', 'marshlands', 'ancestral_steppe', 'primal_forest'],
    // Volcanic Hollow and Deserted Island are swapped against where the game's own
    // hub stars would put them, deliberately. Deserted Island is the richest water
    // in the app and Volcanic Hollow the poorest, so having the rich one on the
    // EARLIER rung made HR6 ask less than HR5. The poor locale belongs on the
    // earlier rung and the rich one on the later, or the ladder walks backwards.
    5:  ['verdant_hills', 'arctic_ridge', 'frozen_seaway', 'volcanic_hollow'],
    6:  ['dunes', 'misty_peaks', 'deserted_island'],
    // HR7 is High Rank's capstone: the three best waters it has, asked for again
    // at a harder goal. Nothing new opens here — the point is that you already
    // know these places, and they are going to want more of you than they did.
    // Frozen Seaway is in it so the rung is not simply HR6 repeated, and so the
    // last test of the rank costs you cold as well as stamina.
    7:  ['deserted_island', 'dunes', 'frozen_seaway'],
    // HR8 stays empty and checkPromotion steps over it, so clearing HR7 lands
    // you on HR9 and G Rank.
    8:  [],
    // G Rank — all eleven return at G tables, plus three new
    9:  ['jurassic_frontier', 'marshlands', 'ancestral_steppe', 'primal_forest'],
    10: ['verdant_hills', 'arctic_ridge', 'frozen_seaway', 'volcanic_hollow'],
    11: ['dunes', 'misty_peaks', 'jungle'],
    12: ['deserted_island', 'ruined_pinnacle', 'desert'],
  };

  // Which HRs belong to the same rank, so a rank's rungs accumulate but do not
  // spill across a promotion.
  const BAND = [[1, 3], [4, 8], [9, 12]];
  const bandOf = hr => BAND.find(([a, b]) => hr >= a && hr <= b);

  const localesAtHR = hr => LADDER[hr] || [];
  // Every rung that actually holds locales. HR8 is empty by design, so asking
  // "is the ladder finished" has to skip it rather than wait on it forever.
  const LADDER_RUNGS = Object.keys(LADDER).map(Number)
    .filter(hr => (LADDER[hr] || []).length).sort((a, b) => a - b);

  // Everything reachable at this HR: every rung of the current rank up to here.
  // At G Rank+ the ladder is done, so all of it is open.
  // Everything you have ever opened, from HR1 up. A rung does not close behind
  // you — a High Rank angler can still go back and fish the Jurassic Frontier,
  // they just fish it as the High Rank angler they now are.
  function localesOpenAt(hr) {
    if (hr >= MAX_LADDER_HR) return [...new Set(Object.values(LADDER).flat())];
    const out = new Set();
    for (let h = 1; h <= hr; h++) for (const id of localesAtHR(h)) out.add(id);
    return [...out];
  }

  const MAX_LADDER_HR = 13;      // G Rank+ begins; XP takes over from here

  // ── Quest goal ────────────────────────────────────────────────────────────
  //
  // A quest is cleared by the ZENNY you bring home, not by turning up. Retire
  // under it and you keep everything you caught; the locale simply stays
  // unmarked. That is the point — an early goal you cannot yet reach is a reason
  // to fish for money, buy a meal and some Endurance, and come back for it.
  //
  // The goal is PER LOCALE, scaled to what that water is worth, because a flat
  // number cannot work: across a full rank the yield spread is about 4.6x.
  // Volcanic Hollow is Whetfish-only and earns ~1,100 on a bare trip where
  // Deserted Island earns ~5,000. One flat goal would be trivial at the rich end
  // and permanently unreachable at Volcanic Hollow — which sits on the HR7 rung,
  // so the ladder would dead-end there.
  //
  // GOAL_CASTS is the sizing dial, and it climbs with the rank. A bare trip
  // supports ~15 casts, so 18 put the Low goal just past a perfect unprovisioned
  // run. But a PROVISIONED trip runs to about 35 casts at every rank, so that
  // same 18 left High and G goals sitting at half of what a normal trip brings
  // home — you cleared them without noticing and often doubled them.
  //
  // Scaling by rank keeps the Low rung where it was and makes the later ones an
  // actual target: you have the gear by then, so the goal should expect it.
  // These are shares of a THEORETICAL full trip — the balance harness lands every
  // cast, which no player does. A missed strike, a snapped line or a fish that
  // wears you down all come off the top, so G is held a little below where the
  // arithmetic alone would put it.
  //
  // Per RUNG, not per rank. Holding it flat across a rank meant rung order carried
  // no difficulty at all: every HR4, HR5 and HR6 quest was sized at 25 casts, so
  // whether one was harder than another came down purely to which locale happened
  // to be richer. Deserted Island on the HR5 rung asked 8,550z while Misty Peaks
  // on the rung ABOVE it asked 6,700z. Climbing per rung is what makes the next
  // step up actually feel like one.
  //
  // The ceiling is real: a bare trip runs ~15 casts, a trip with the best meal
  // ~21, and only maxed Endurance reaches ~45. Note the meal barely moves it —
  // nothing out-staminas Vigorous Stir-fry's 38 until Ultimate Rice at HR13 — so
  // Endurance is what these later numbers are really asking you to have bought.
  // A G trip runs about 31 casts where a High one runs 34 — the fish are rarer,
  // so the fights are longer and the same stamina buys fewer lines in the water.
  // G's figures therefore have to climb faster than the arithmetic suggests just
  // to stay ahead of where High finished.
  const GOAL_CASTS_BY_HR = {
    1: 18, 2: 20, 3: 22,          // Low
    4: 24, 5: 26, 6: 28, 7: 29,   // High — 7 is the capstone rung
    9: 30, 10: 31, 11: 32, 12: 33, // G
  };
  const GOAL_CASTS_BY_RANK = { Low: 18, High: 24, G: 30, Gplus: 33 };
  const goalCasts = hr =>
    GOAL_CASTS_BY_HR[hr] ?? GOAL_CASTS_BY_RANK[rankAt(hr).id] ?? 18;
  const GOAL_CASTS = 18;                 // the Low figure, kept for reference
  const GOAL_ROUND = 50;

  // Where finishing this rung actually lands you. Empty rungs are stepped over,
  // so at HR7 the answer is HR9, not HR8.
  function nextHR(hr) {
    let h = hr + 1;
    while (h < MAX_LADDER_HR && localesAtHR(h).length === 0) h++;
    return h;
  }

  // Which rung of the current rank opened this locale. Used to group the locale
  // list, so it reads as the ladder rather than as one flat pile.
  // The rung a locale first appeared on. Kept for anything that needs a locale's
  // earliest home; a QUEST is identified by its own rung, not by this.
  function openedAtHR(localeId) {
    for (let h = 1; h <= 12; h++)
      if (localesAtHR(h).includes(localeId)) return h;
    return 1;
  }

  // Every rung you have unlocked, oldest first. A locale appears once per rank it
  // is listed at, because those are different quests: the Jurassic Frontier at
  // HR1 is a Low Rank quest and at HR4 a High Rank one, with different tables,
  // different ores and a different goal. Reaching High Rank does not close the
  // Low quest — going back is how you farm a fish out of an undiluted Low pool.
  function rungsOpenAt(hr) {
    const top = hr >= MAX_LADDER_HR ? 12 : hr;
    const out = [];
    for (let h = 1; h <= top; h++)
      if (localesAtHR(h).length) out.push({ hr: h, rank: rankAt(h), locales: localesAtHR(h) });
    return out;
  }

  const DESIGNED_POOLS = {
    // Sparse and valuable, echoing Volcanic Hollow's real one-fish spot.
    volcano: {
      note: 'Designed. The game defines no fishing here; this is the rare-ore run.',
      areas: { 4: { Low: null, High: null, G: null } },
      pool: [
        { fish: 'whetfish', pct: 30 },
        { fish: 'glutton_tuna', pct: 25 },
        { fish: 'gastronome_tuna', pct: 20 },
        { fish: 'guardfish', pct: 15 },
        { fish: 'ancient_fish', pct: 10 },
      ],
      // The whole point of the trip: the ore roll is shoved upward.
      oreBoost: { 0: 0.3, 1: 1.3, 2: 3.2 },
    },
    // Wyvern's End. Nothing cheap is in this water — the five dearest species in
    // the game and no filler, because there is no goal here to grind toward and
    // the fish are what make the wait for Nakarkos worth standing through rather
    // than a toll you pay. Ore is pushed to the top band for the same reason.
    wyvern_s_end: {
      note: 'Designed. The game defines no fishing here; it is where Nakarkos is.',
      areas: { 1: { Low: null, High: null, G: null } },
      pool: [
        { fish: 'guardfish', pct: 28 },
        { fish: 'king_brocadefish', pct: 24 },
        { fish: 'silverfish', pct: 20 },
        { fish: 'ancient_fish', pct: 18 },
        { fish: 'speartuna', pct: 10 },
      ],
      oreBoost: { 0: 0.2, 1: 1.0, 2: 3.6 },
    },
  };

  // Every arena shares one designed pool. Deliberately top-heavy — these open at
  // HR13 and are the last thing left to fish.
  const ARENA_POOL = [
    { fish: 'silverfish', pct: 26 },
    { fish: 'speartuna', pct: 22 },
    { fish: 'king_brocadefish', pct: 20 },
    { fish: 'ancient_fish', pct: 16 },
    { fish: 'premium_sashimi', pct: 10 },
    { fish: 'guardfish', pct: 6 },
  ];

  // ── Climate ───────────────────────────────────────────────────────────────
  //
  // Cold drains stamina faster: shorter trips, no danger. Hot chips HP: the trip
  // can kill you. Hot Drink stops cold, Cool Drink stops heat, and Dash Juice is
  // the cheap partial answer to cold because "run without tiring" is exactly a
  // stamina-drain modifier.
  //
  // Dunes and Desert are hot by day and cold by night in the real game. Day/night
  // is a later pass; they are hot here.

  const CLIMATE = {
    arctic_ridge: 'cold', frozen_seaway: 'cold', polar_field: 'cold',
    volcano: 'hot', volcanic_hollow: 'hot', dunes: 'hot', desert: 'hot',
    ingle_isle: 'hot',
  };
  const climateOf = id => CLIMATE[id] || 'temperate';

  // ── Casting from the keyboard ─────────────────────────────────────────────
  //
  // Off by default, because Space is the pond's own button and a stray press
  // between casts should not spend stamina. Turned on, it is deliberately NOT a
  // single press — it borrows the reel-in check, shortened. Three taps in quick
  // succession is short enough to be quicker than reaching for the button and
  // long enough that nothing you do by accident ever adds up to a cast.
  const CAST_PRESSES = 3;
  // How long a part-finished cast holds before it forgets. Without this a tap
  // now and a tap in a minute would eventually cast on their own.
  const CAST_PRESS_WINDOW_MS = 900;

  // ── The colour of the water ───────────────────────────────────────────────
  //
  // The pond used to be painted from the THEME, which meant every locale looked
  // the same and the theme picker — a monster colour, nothing to do with where
  // you are standing — decided what a marsh looked like. One hex per locale
  // instead. Invented, like everything else in this file: the game does not
  // publish a water colour, these are read off what each place looks like.
  //
  // The pond derives its shallows and depths from this single value the same way
  // the theme derives its shades, so tuning a locale means changing one number.
  const WATER = {
    jurassic_frontier: '#55A8CE',   // open, light, sky on the surface
    verdant_hills:     '#4C6076',   // grey-blue, overcast rather than lush
    marshlands:        '#9A8F7E',   // pale brown-grey, silt held in suspension
    arctic_ridge:      '#5C8FB5',   // meltwater under ice
    dunes:             '#1F8C93',   // an oasis against the sand
    deserted_island:   '#1C90B8',   // bright tropical shallows
    misty_peaks:       '#3F8F7C',   // blue-green
    ancestral_steppe:  '#C0B190',   // craggy tan, and the lighter of the two greys
    primal_forest:     '#245C4A',   // deep shade, almost black-green
    frozen_seaway:     '#6FA8C4',   // pale glacial blue
    volcanic_hollow:   '#B4552A',   // lit from underneath
    jungle:            '#128FA6',   // blue-cyan
    ruined_pinnacle:   '#4B5A86',   // cold stone, high altitude
    desert:            '#2A8FA0',   // spring water in dry country
    volcano:           '#C0431F',   // molten
  };
  // Anything without its own entry falls back to its climate, so a locale added
  // later still looks like somewhere rather than like the theme. The temperate
  // default is PINNED rather than tracking Jurassic Frontier, whose hex it used
  // to share: the two parted company when the Frontier went blue, and green is
  // the safer thing for a locale nobody has looked at yet to look like.
  const WATER_BY_CLIMATE = { cold: '#5C8FB5', hot: '#B4552A', temperate: '#2E7D6B' };
  const waterOf = id => WATER[id] || WATER_BY_CLIMATE[climateOf(id)];

  // How long one drink holds off the climate, measured in fight seconds rather
  // than wall clock — a trip is only as long as the time you spend reeling.
  const DRINK_SECONDS = 90;

  // Dash Juice halves what reeling costs. Same clock as a drink, measured in
  // fight seconds; the Mega version simply runs twice as long.
  const ARMOR_SECONDS = 90;    // one Armorskin; the Mega lasts twice that
  const DASH_SECONDS = 90;
  const DASH_MULT = 0.5;

  // ── Bombs ─────────────────────────────────────────────────────────────────
  //
  // The whole feature turns on one number, and it is not the radius: it is what a
  // bombed fish COUNTS for. trip.landed feeds the full basket and the Trade Cart,
  // and both pay on count rather than value — the basket deliberately, so that a
  // run of cheap catches is worth staying out for. A bomb makes count cheaply, so
  // at face value it would be the fastest way to fill a forty-fish basket and cap
  // the cart, and the rod would be for people who had not worked it out yet.
  //
  // So a bombed fish counts a FRACTION. Everything else here is a dial; this is
  // the one that decides whether bombs are a tool or a replacement.
  const BOMB = {
    countFraction: 0.4,   // toward the basket and the cart
    valueMult: 0.55,      // and what the bruised fish sells for
    staminaMult: 1.8,     // against one cast, so it is a burst and not a rhythm
  };
  // Blast widens the radius; Bruising is what the fish keeps of its value.
  const bombCatch = (id, gear) =>
    Math.max(1, Math.round((ITEM_EFFECT[id] || {}).bomb * (1 + effectPower(gear, 'blast'))));
  const bombValueMult = gear =>
    Math.min(1, BOMB.valueMult * (1 + effectPower(gear, 'bruising')));

  const CLIMATE_RATES = {
    temperate: { staminaMult: 1,    hpPerTick: 0 },
    cold:      { staminaMult: 1.85, hpPerTick: 0 },
    hot:       { staminaMult: 1.15, hpPerTick: 1.4 },
  };

  // ── Resources ─────────────────────────────────────────────────────────────
  //
  // Both pools are FIXED. Consumables only restore within them. Meals raise the
  // ceiling for one quest; upgrades raise it permanently. Nothing in the pouch
  // touches a maximum.
  //
  // Stamina is spent fishing — that is what makes a long trip a real choice.
  // HP is spent by climate and encounters, and losing it costs you the haul.

  // What each consumable does. Shared by the shop (what it prints) and quest.js
  // (what it applies), so the two can never drift. GROUP is what the shop sorts
  // them under.
  // hp and stamina are separate because an item can do both — Ancient Potion is
  // the only one that does, which is why it sits in Misc rather than under HP.
  // `unlock` is the HR the shop starts offering it. Unlike fish and varieties,
  // which take their rank from the data, these are hand-set: nothing about a
  // Potion says when it should appear, so each one was decided on its own.
  // Supply items (First-aid Med, Ration) are never sold, so they carry no unlock.
  // `carry` is how many of that item fit in one pouch slot. The stronger the
  // item, the fewer of it you can take — that, plus a hard slot count, is what
  // turns packing into a decision instead of a formality.
  const ITEM_EFFECT = {
    herb:            { group: 'hp',      hp: 10,                unlock: 1,  carry: 10, label: '+10 HP' },
    potion:          { group: 'hp',      hp: 30,                unlock: 1,  carry: 10, label: '+30 HP' },
    mega_potion:     { group: 'hp',      hp: 50,                unlock: 5,  carry: 5,  label: '+50 HP' },
    max_potion:      { group: 'hp',      hp: 999,               unlock: 9,  carry: 2,  label: 'Full HP' },
    first_aid_med:   { group: 'hp',      hp: 20,                            carry: 10, label: '+20 HP' },
    energy_drink:    { group: 'stamina', stamina: 25,           unlock: 1,  carry: 10, label: '+25 Stamina' },
    rare_steak:      { group: 'stamina', stamina: 35,           unlock: 5,  carry: 5,  label: '+35 Stamina' },
    well_done_steak: { group: 'stamina', stamina: 50,           unlock: 9,  carry: 5,  label: '+50 Stamina' },
    ration:          { group: 'stamina', stamina: 25,                       carry: 10, label: '+25 Stamina' },
    ancient_potion:  { group: 'misc',    hp: 999, stamina: 999, unlock: 13, carry: 1,  label: 'Full HP and Stamina' },
    cool_drink:      { group: 'misc', protects: 'hot',          unlock: 1,  carry: 5,  label: 'Increases heat resistance for a short time' },
    hot_drink:       { group: 'misc', protects: 'cold',         unlock: 1,  carry: 5,  label: 'Increases cold resistance for a short time' },
    dash_juice:      { group: 'misc',      dash: 1,             unlock: 5,  carry: 5,  label: 'Halves Stamina used while reeling' },
    mega_dash_juice: { group: 'misc',      dash: 2,             unlock: 9,  carry: 2,  label: 'Halves Stamina used while reeling, for twice as long' },
    // Defence, the same currency the Alcohol fresh bonus pays in: a fraction off
    // what small monsters and the two big ones take from you.
    // One slot doing two jobs: a Well-done Steak's Stamina AND a drink's
    // resistance. That is the whole reason they are G Rank+ and dearer than the
    // two things they replace put together.
    hot_meat:        { group: 'misc', stamina: 50, protects: 'cold', unlock: 13, carry: 5, label: '+50 Stamina and cold resistance' },
    chilled_meat:    { group: 'misc', stamina: 50, protects: 'hot',  unlock: 13, carry: 5, label: '+50 Stamina and heat resistance' },
    // ── Bombs ────────────────────────────────────────────────────────────
    // Thrown into the water rather than cast into it: everything inside the
    // blast comes up at once, bruised and worth less for it. `bomb` is how many
    // fish the radius reaches.
    barrel_bomb_s:   { group: 'misc',      bomb: 2,             unlock: 3,  carry: 10, label: 'Takes a few fish at once, worth less for it' },
    barrel_bomb_l:   { group: 'misc',      bomb: 3,             unlock: 6,  carry: 3,  label: 'Takes several fish at once, worth less for it' },
    barrel_bomb_lp:  { group: 'misc',      bomb: 5,             unlock: 9,  carry: 2,  label: 'Takes a haul of fish at once, worth less for it' },
    armorskin:       { group: 'misc',      def: 0.15, secs: 1,  unlock: 5,  carry: 5,  label: '+15% DEF for a short time' },
    mega_armorskin:  { group: 'misc',      def: 0.25, secs: 2,  unlock: 9,  carry: 2,  label: '+25% DEF, for twice as long' },
  };

  // How much you can take at all. A slot holds one KIND of item, up to its own
  // carry limit, so the choice is which six things matter — not how much of
  // everything you can afford.
  // Low Rank gets a free supply box — a few First-aid Meds and Rations — so a new
  // angler is not immediately punished for packing badly. It stops at promotion:
  // from High Rank on, everything you carry is something you chose and paid for.
  const SUPPLY_RANK = 'Low';
  const SUPPLY_EACH = 3;

  const POUCH_SLOTS = 10;      // books and materials share it with the potions
  const TACKLE_SLOTS = 5;      // bait kinds, swapped between casts — the "Bait Pouch"
  const BAIT_CARRY = 10;       // of any one bait

  // A book is knowledge, not a supply: one is all that does anything, and letting
  // it stack to ten would be a slot-eating trap.
  const carryLimit = id =>
    bookById.has(id) ? 1 : (ITEM_EFFECT[id]?.carry ?? 10);
  // How many you may OWN. A second book does nothing a first one does not, so
  // the shop should not let you buy 99 of them and call it stock.
  const ownCap = id => (bookById.has(id) ? 1 : STOCK_CAP);
  const effectOf = id => ITEM_EFFECT[id] || { group: 'misc', label: '' };
  // Books carry their own gate — one per rank, so the ladder of them lands
  // alongside the ladder of ranks rather than all at once.
  const itemUnlockHR = p => p.unlock ?? ITEM_EFFECT[p.id]?.unlock ?? 1;

  // Prices are the transcribed ones unless overridden here. Rare Steak and Energy
  // Drink have both their effect and their price swapped: the steak is the bigger,
  // dearer, later one and the drink is the cheap early standby. Straight off the
  // real numbers the steak was half the price AND stronger, which left the drink
  // with no reason to exist after HR5.
  const ITEM_PRICE = {
    rare_steak: 60, energy_drink: 30,
    // The real prices put these BELOW the drink alone — 250 and 300 against a 96
    // steak — which would make a slot-saving combo cheaper than either half of
    // it. Priced above the pair they replace instead (346 and 396), so what you
    // are paying for is the slot.
    hot_meat: 420, chilled_meat: 480,
  };
  const priceOf = p => ITEM_PRICE[p.id] ?? p.buy;

  // A group with an explicit order lists its items that way; the rest sort by
  // price. Misc is spelled out because price order buries Ancient Potion at the
  // bottom, when it is the one people are looking for.
  const ITEM_GROUPS = [
    ['hp', 'HP Items'],
    ['stamina', 'Stamina Items'],
    ['misc', 'Misc', ['ancient_potion', 'cool_drink', 'hot_drink', 'dash_juice', 'mega_dash_juice',
                      'armorskin', 'mega_armorskin', 'hot_meat', 'chilled_meat']],
    ['mats', 'Combo Mats'],
    ['books', 'Books'],
  ];

  // ── Combining ─────────────────────────────────────────────────────────────
  //
  // Every bait can be made instead of bought, out on the water, from Mega Fishing
  // Fly plus one material. The materials are real MHGU items and so are three of
  // the game's own recipes; which material makes which bait is invented here.
  //
  // The rate is keyed to what the bait CATCHES, not to what the bait costs — a
  // Goldenfish is worth ten Whetfish, so its bait should be the harder one to
  // make even though both are cheap to buy. Species and variety are scaled
  // across their OWN spans, or the ore range (up to 24,000z) would swamp the fish
  // range (up to 2,500z) and no species bait would ever reach the floor.
  // ── The recipe book ───────────────────────────────────────────────────────
  //
  // Every combo is BASE + MODIFIER, and the pair is what names the result. That
  // is the whole reason the base varies: with one shared base the modifier alone
  // had to identify the bait, so sharing a husk across four cheap recipes made
  // four recipes that all claimed the same two ingredients.
  //
  // The base doubles as the tier. Insect Husk for the cheap end, Worm for the
  // middle, Mega Fishing Fly for the top — on both halves of the list, so an ore
  // bait and a species bait of similar standing read the same way. All three are
  // the materials the shop sells, so you buy the body and gather the scent.
  //
  // Modifiers are chosen to NAME the thing: whetfish takes a whetstone, bomb
  // arowana a bomberry, silverfish a silver cricket. MHGU's own bait recipes are
  // not followed — the baits themselves are largely invented, so deferring to
  // two real recipes was costing better pairings than it bought.
  const COMBO_BASES = ['insect_husk', 'worm', 'mega_fishing_fly'];
  const COMBO_BASE_ITEM = 'mega_fishing_fly';   // still the top tier's base

  const SPECIES_RECIPE = {
    // Huskberry, not Huge Lagniapple: the Lagniapple is a G Rank pickup and this
    // is the cheapest fish in the game on a bait you have from cast one.
    glutton_tuna:     ['insect_husk',      'huskberry'],
    popfish:          ['insect_husk',      'flashbug'],
    whetfish:         ['insect_husk',      'whetstone'],
    sleepyfish:       ['insect_husk',      'sleep_herb'],
    wanchovy:         ['insect_husk',      'bitterbug'],
    pin_tuna:         ['insect_husk',      'needleberry'],
    gastronome_tuna:  ['worm',             'choice_mushroom'],
    burst_arowana:    ['worm',             'nitroshroom'],
    bomb_arowana:     ['worm',             'bomberry'],
    scatterfish:      ['worm',             'scatternut'],
    premium_sashimi:  ['worm',             'unique_mushroom'],
    small_goldenfish: ['worm',             'honey'],
    brocadefish:      ['worm',             'paintberry'],
    sushifish:        ['insect_husk',      'honey'],
    goldenfish:       ['mega_fishing_fly', 'gold_cricket'],
    speartuna:        ['mega_fishing_fly', 'stinkhopper'],
    silverfish:       ['mega_fishing_fly', 'silver_cricket'],
    ancient_fish:     ['mega_fishing_fly', 'mopeshroom'],
    king_brocadefish: ['mega_fishing_fly', 'king_scarab'],
    // Divine Rhino, not Flutterfly: Flutterfly is G Rank only and this bait opens
    // at HR4, so it would have sat uncraftable for five ranks.
    guardfish:        ['mega_fishing_fly', 'divine_rhino'],
  };
  // A variety bait is ground from its own ore, so the modifier needs no
  // invention; the base carries the rank the way it does for species.
  const ORE_MAT = {
    iron: 'iron_ore', earth: 'earth_crystal', machalite: 'machalite_ore',
    dragonite: 'dragonite_ore', carbalite: 'carbalite_ore', fucium: 'fucium_ore',
    lightcrystal: 'lightcrystal', firecell: 'firecell_stone', eltalite: 'eltalite_ore',
    allfire: 'allfire_stone', purecrystal: 'purecrystal', ultimas: 'ultimas_crystal',
  };

  const fishById = new Map(FISH.fish.map(f => [f.id, f]));
  const oreById = new Map(ORES.list.map(o => [o.id, o]));

  // What a bait is FOR, in zenny: the fish it lands, or the ore it tints them.
  function comboWorth(b) {
    if (b.family === 'ore') {
      const o = oreById.get(b.target);
      return o.sell * ORE_VALUE_MULT[o.rank];
    }
    return (fishById.get(b.target) || { sell: 0 }).sell;
  }

  // { base, mod } for any bait, or null if it is not something you can make.
  function comboRecipe(b) {
    if (!b) return null;
    if (b.family === 'ore') {
      const o = oreById.get(b.target);
      return { base: COMBO_BASES[o.rank] || COMBO_BASE_ITEM, mod: ORE_MAT[b.target] };
    }
    const r = SPECIES_RECIPE[b.target];
    return r ? { base: r[0], mod: r[1] } : null;
  }
  const comboMaterial = b => (comboRecipe(b) || {}).mod;

  const COMBO_TOP = 95, COMBO_FLOOR = 70;
  const comboSpan = (() => {
    const out = {};
    for (const fam of ['species', 'ore']) {
      const v = buildBaits().filter(b => b.family === fam).map(comboWorth);
      out[fam] = [Math.min(...v), Math.max(...v)];
    }
    return out;
  })();

  function comboBase(b) {
    const [lo, hi] = comboSpan[b.family] || [1, 1];
    const t = hi > lo ? Math.log(comboWorth(b) / lo) / Math.log(hi / lo) : 0;
    return Math.round(COMBO_TOP - (COMBO_TOP - COMBO_FLOOR) * t);
  }

  // ── Books of Fishing Combos ───────────────────────────────────────────────
  //
  // Three where the game has five, at the game's own prices for its first three.
  // They must be CARRIED to do anything — the knowledge does not stay with you —
  // and they are sequential the way the real ones are: the second is worth
  // nothing without the first, the third nothing without both. So they cost you
  // three pouch slots or none, which is the whole trade.
  // Renamed, and re-iconed off the game's own five: 1 keeps the dark grey of the
  // real first book, 2 takes the light grey its third and fourth wear, and 3 goes
  // cyan. Prices are the real ones for the game's first three.
  const BOOKS = [
    { id: 'book_1', name: 'Book of Fishing Combos 1', buy: 1000, bonus: 10, unlock: 3,
      icon: 'MH4G-Book_Icon_Grey.png',
      desc: 'Raises the chance a combination succeeds. Must be carried.' },
    { id: 'book_2', name: 'Book of Fishing Combos 2', buy: 2000, bonus: 10, unlock: 6,
      icon: 'MH4G-Book_Icon_White.png', needs: 'book_1',
      desc: 'Worth nothing without the first book alongside it.' },
    { id: 'book_3', name: 'Book of Fishing Combos 3', buy: 5000, bonus: 10, unlock: 9,
      icon: 'MH4G-Book_Icon_Light_Blue.png', needs: 'book_2',
      desc: 'Worth nothing without the first two alongside it.' },
  ];
  const bookById = new Map(BOOKS.map(b => [b.id, b]));

  // ── What the pouch can hold ───────────────────────────────────────────────
  //
  // Three kinds of thing share the ten slots: the provisions that keep you
  // alive, the materials a combination eats, and the books that make one work.
  // They are listed together because the slot is the same slot — that is the
  // whole trade.
  //
  // Only the two commonest bugs and the Fly are sold. Everything else the cats
  // bring back, or you do without: stocking Snakebee Larva at 300z would make
  // hiring them pointless, and stocking the ores would be inventing a shop the
  // game does not have.
  const MAT_BUYABLE = new Set(COMBO_BASES);
  const megaFly = () => FISH.baits.find(b => b.id === 'mega_fishing_fly');

  const MATERIALS = (() => {
    const fly = megaFly();
    const out = fly ? [{ ...fly, group: 'mats' }] : [];
    for (const m of (FISH.materials || [])) out.push({ ...m, group: 'mats' });
    return out;
  })();
  const materialById = new Map(MATERIALS.map(m => [m.id, m]));
  const isBuyableMat = id => MAT_BUYABLE.has(id);
  // No gathering rows anywhere in the game — a quest reward rather than
  // something you pick up. Kept, because the alternative is a recipe whose
  // material can never reach you.
  const isQuestRewardMat = id => !!(FISH.materialSources || {})[id]?.questReward;

  // Everything the Item Pouch can carry, in one list, so the pouch and the shop
  // stop having to know which table a thing came out of.
  const pouchItems = () => [
    ...FISH.prep.map(p => ({ ...p, group: effectOf(p.id).group || 'misc', kind: 'prep' })),
    ...MATERIALS.map(m => ({ ...m, kind: 'mat' })),
    ...BOOKS.map(b => ({ ...b, group: 'books', kind: 'book' })),
  ];
  const pouchItemById = new Map(pouchItems().map(i => [i.id, i]));

  // How much the books you are CARRYING are worth. Sequential, so a third book
  // packed without the first two is dead weight.
  function bookBonus(carried) {
    let bonus = 0;
    for (const b of BOOKS) {
      if (!carried[b.id]) break;               // the chain stops at the first gap
      bonus += b.bonus;
    }
    return bonus;
  }

  // Steady Mixer stacks with the Books, in the same units they use: percentage
  // points on the success rate, not a multiplier of it.
  const comboRate = (b, carried, armor = null) =>
    Math.min(100, comboBase(b) + bookBonus(carried || {})
      + Math.round(effectPower(armor, 'combo') * 100));

  // ── Palicos ───────────────────────────────────────────────────────────────
  //
  // Up to two, gathering while you fish. Priced off the same locale the Hunter
  // for Hire is priced off, a little under him: they are not standing between
  // you and anything, they are picking things up.
  // chancePerCast is per CAT, so two of them roll twice. Tuned so a full trip
  // comes home with a useful handful rather than a hoard — the point is that a
  // rare material is a reason to go out again, not something you farm in one go.
  const PALICO = { max: 2, ofHunter: 0.8, chancePerCast: 0.08 };

  // ── The Trade Cart ────────────────────────────────────────────────────────
  //
  // Hand something over and the cart works it while you fish. What comes back is
  // whatever you gave PLUS one more for every few fish you land — the item is
  // never spent, so the only thing at risk is the fee and the trip itself.
  //
  // Priced off the locale like the other services, plus a cut of what the item is
  // worth: multiplying a Purecrystal should not cost what multiplying a Huskberry
  // costs, or the cart would be a free printing press for the rarest thing you own.
  const TRADE = { ofHunter: 0.6, cut: 0.18 };

  // ── The Trade Cart ────────────────────────────────────────────────────────
  //
  // What the cart brings back is `min(cap, landed / perExtra)`, and the whole
  // design turns on the fact that ONLY THE LOWER OF THOSE TWO EVER BINDS. Raise
  // the cap while the rate is the limit and nothing happens at all, so the two
  // ladders have to leapfrog: every cap step lands just above what the current
  // rate produces, every rate step just above the current cap. Tuned that way all
  // six upgrades are felt instead of three being dead money.
  //
  // The consequence is the point of the whole thing. On a short trip (~30 fish)
  // only the RATE steps pay; on a long one (~50) mostly the CAP steps do. A cap
  // upgrade is money wasted on someone who hits the quest goal and goes home,
  // which is a reason to stay out that lives in the economy rather than in a
  // bonus bolted on top of it.
  //
  // NAMES ARE PLACEHOLDERS. Raven set the ends — Shabby to Grand — and the five
  // between are mine until he says otherwise.
  const TRADE_CART_UNLOCK_HR = 3;
  const TRADE_CART = [
    { lvl: 0, name: 'Shabby Trade Cart',   cap: 3,  perExtra: 10 },
    { lvl: 1, name: 'Humble Trade Cart',   cap: 5,  perExtra: 10, knob: 'cap',  rank: 'Low',  cost: 1200,  matCount: 2 },
    { lvl: 2, name: 'Sturdy Trade Cart',   cap: 5,  perExtra: 6,  knob: 'rate', rank: 'Low',  cost: 2400,  matCount: 2 },
    { lvl: 3, name: 'Solid Trade Cart',    cap: 8,  perExtra: 6,  knob: 'cap',  rank: 'High', cost: 7000,  matCount: 3 },
    { lvl: 4, name: 'Fine Trade Cart',     cap: 8,  perExtra: 4,  knob: 'rate', rank: 'High', cost: 12000, matCount: 3 },
    { lvl: 5, name: 'Splendid Trade Cart', cap: 12, perExtra: 4,  knob: 'cap',  rank: 'G',    cost: 26000, matCount: 3 },
    { lvl: 6, name: 'Grand Trade Cart',    cap: 12, perExtra: 3,  knob: 'rate', rank: 'G',    cost: 45000, matCount: 3 },
  ];
  const TRADE_CART_MAX = TRADE_CART.length - 1;
  const cartAt = lvl => TRADE_CART[Math.min(TRADE_CART_MAX, Math.max(0, lvl | 0))];
  // A rung stays out of sight until you are the rank that pays for it. The parts
  // it wants would be unobtainable anyway, and listing four suits you cannot buy
  // reads as a wall rather than a ladder.
  const cartTierOpen = (tier, hr) =>
    !tier.rank || rankIndex(curveRank(hr)) >= rankIndex(tier.rank);

  // ── The full basket ────────────────────────────────────────────────────────
  //
  // A flat bonus for coming home with a lot of FISH, counted rather than valued.
  // Counting is the point: it is what makes a run of cheap little catches worth
  // staying for, which is the only reason a player would keep casting once the
  // quest goal is met. Value-weighting it would just pay you more for the trips
  // that already paid best.
  //
  // Paid at camp, so a cart loses it with the haul — the fuller the basket, the
  // more the next cast is risking.
  //
  // 40 is deliberately flat across the game rather than scaled per rank. Trips
  // get SHORTER as rank rises — about 54 fish at HR1 against 40 at HR12, because
  // fights run longer and the climates bite harder — so a rising target would be
  // unreachable by G Rank and a falling one reads as the game getting easier.
  // Flat means Low Rank fills it every time and G Rank has to work for it.
  const BASKET = {
    target: 40,
    bonus: { Low: 800, High: 1500, G: 2500 },   // ~10% of a fished-out trip's net
  };
  // `gear` is optional so anything still asking the plain question gets the plain
  // answer; Basket lowers the bar for anyone wearing it.
  const basketBonus = (landed, hr, gear = null) =>
    landed >= basketTarget(gear) ? (BASKET.bonus[curveRank(hr)] || 0) : 0;

  const BASE_MAX_HP = 100;
  const BASE_MAX_STAMINA = 110;

  const STAMINA_COST = { cast: 4, reelTick: 0.6 };
  const CLIMATE_TICK_MS = 1000;

  // ── Meals ─────────────────────────────────────────────────────────────────
  //
  // 99 real MHGU meals with their real Hunter HP and Stamina bonuses, from
  // Kiranico's Meal List (data/meals.js). Only the PRICE is ours: the game buys
  // meals with ingredients, not zenny, so cost is set from what the meal is worth
  // to an angler — HP is dearer than Stamina because HP is what keeps the haul.
  // MEAL_SCALE is the balance dial over the real numbers. The game's own values
  // cap at +50/+50, which against the base bars is too small to be worth buying;
  // scaling stamina makes the choice real without inventing meals or renaming
  // them. Change these two numbers to retune, then re-run scripts/simulate.mjs.
  const MEAL_SCALE = { hp: 1, stamina: 1.5 };
  const mealCost = m => Math.round(m.hp * 11 + m.stamina * 8);

  const MEALS = [
    { id: 'none', name: 'No Meal', cost: 0, hp: 0, stamina: 0, realHp: 0, realStamina: 0 },
    ...(window.MF_MEALS || [])
      .filter(m => m.hp || m.stamina)
      .map(m => {
        const hp = Math.round(m.hp * MEAL_SCALE.hp);
        const stamina = Math.round(m.stamina * MEAL_SCALE.stamina);
        return { ...m, hp, stamina, realHp: m.hp, realStamina: m.stamina,
                 cost: mealCost({ hp, stamina }) };
      }),
  ];

  // ── Ingredients ───────────────────────────────────────────────────────────
  //
  // You turn one up while fishing rather than buying it. The pool is whatever you
  // have NOT already found at or below your rank, so an early ingredient you
  // missed stays findable at G instead of being stranded behind you — that is the
  // whole point of drawing from what remains rather than from the current tier.
  //
  // Chance is per LANDED fish, not per cast, so a snapped line earns nothing.

  // Per LANDED fish, and a trip turns up AT MOST ONE (quest.js stops rolling once
  // it has something). So the figure that matters is the per-TRIP one: over a
  // ~30-fish trip this is 1 - 0.985^30, a little over a third. Ingredients were
  // arriving faster than the ranks that gate them, which is how a High Rank
  // pantry ended up holding every recipe in the game.
  const INGREDIENT_CHANCE = 0.015;

  // ── Fresh ingredients ─────────────────────────────────────────────────────
  //
  // The canteen hands out a lot of meals that differ only in name, because the
  // real game separates them with effects this app does not model. Freshness is
  // what pulls them apart: a meal cooked from a fresh ingredient carries a small
  // bonus set by what KIND of ingredient it is, so two meals with the same HP and
  // Stamina stop being interchangeable.
  //
  // A meal uses two ingredients, so bonuses stack — and two fresh Meats really do
  // stack twice, which is the point of chasing them.
  const FRESH_CHANCE = 0.25;
  // How many ingredients can be fresh AT ONCE. Freshness was accumulating with
  // nothing to stop it, so a full pantry ended up entirely fresh and every meal
  // carried its maximum bonus — which is no choice at all. Two, because a meal is
  // cooked from two ingredients, so the best case is still a meal whose BOTH
  // ingredients are the ones you are holding fresh. A third find pushes the
  // oldest back to ordinary.
  const FRESH_MAX = 2;
  const FRESH = {
    Meat:       { hp: 8 },        // even a stamina-only dish comes with HP on it
    Vegetables: { stamina: 8 },
    Fish:       { zenny: 0.06 },  // a fraction of every catch's value
    Alcohol:    { guard: 0.10 },  // defence: a fraction off what monsters take
  };
  const FRESH_LABEL = {
    hp: n => `+${n} HP`,
    stamina: n => `+${n} Stamina`,
    zenny: n => `+${Math.round(n * 100)}% Zenny per catch`,
    // DEF to the player. `guard` stays the key everywhere in the code.
    guard: n => `+${Math.round(n * 100)}% DEF`,
  };

  const ingredientById = new Map(CANTEEN.ingredients.map(i => [i.id, i]));

  // Held as `true` when found and `'fresh'` when found fresh. Both are truthy, so
  // every recipe check still reads the same and saves from before freshness load
  // unchanged — they simply have no fresh ingredients yet.
  const isFresh = (held, id) => held[id] === 'fresh';

  // Anything you have not found yet. Fishing turns ingredients UP; it has nothing
  // to do with which are fresh, because freshness only ever matters while you are
  // choosing a meal — see freshPick below.
  // Gated on the wiki's own unlock rank, and ONLY on that. An ingredient does not
  // inherit the gate of the best meal it feeds: the strong meals share
  // ingredients with weak ones, so pushing the ingredient back drags a pile of
  // 20-power dishes to G Rank with it. The power gate belongs on the meal, where
  // it can be exact — see mealUnlockHR below.
  const ingredientPool = (hr, held) => CANTEEN.ingredients
    .filter(i => hr >= RANK_HR[i.rank] && !held[i.id]);

  function rollIngredient(hr, held, rng = Math.random) {
    if (rng() >= INGREDIENT_CHANCE) return null;
    const pool = ingredientPool(hr, held);
    if (!pool.length) return null;
    return pool[Math.floor(rng() * pool.length)];
  }

  // Which of the pantry is fresh right now. Chosen at CAMP, between trips, since
  // that is the only place it changes anything — it decides which meal is worth
  // cooking, and there is no meal to cook while you are stood in the water.
  // Rerolled every time you come home, so the pair rotates rather than being
  // something you happened to fish up once and keep forever.
  function freshPick(pantry, rng = Math.random, gear = null) {
    const held = Object.keys(pantry);
    const out = [];
    const bag = held.slice();
    // Fresh widens this: whole ingredients, so it steps rather than scales.
    const want = gear ? freshMax(gear) : FRESH_MAX;
    while (out.length < want && bag.length)
      out.push(bag.splice(Math.floor(rng() * bag.length), 1)[0]);
    return out;
  }

  // What a meal's fresh ingredients are worth. Baseline meals have no recipe and
  // so no ingredients — nothing to be fresh, which is its own reason to graduate
  // onto cooked food.
  function freshBonus(meal, held) {
    const out = { hp: 0, stamina: 0, zenny: 0, guard: 0 };
    if (!meal || meal.id === 'none') return out;
    const r = recipeFor.get(meal.name);
    if (!r) return out;
    for (const id of [r.a, r.b]) {
      if (!isFresh(held, id)) continue;
      const ing = ingredientById.get(id);
      const gain = ing && FRESH[ing.group];
      if (gain) for (const [k, v] of Object.entries(gain)) out[k] += v;
    }
    return out;
  }

  // The same thing said in words, for the camp screen.
  const freshLines = bonus => Object.entries(bonus)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => FRESH_LABEL[k](v));

  // The short form, for somewhere with no room — a <select> option, which cannot
  // carry markup and has to fit on one line next to the price.
  // Abbreviations were for a <select> option that had to fit on one line. The
  // meal table puts this under the name where it can wrap, so it says the words.
  const FRESH_SHORT = {
    hp: n => `+${n} HP`,
    stamina: n => `+${n} Stamina`,
    zenny: n => `+${Math.round(n * 100)}% Zenny`,
    guard: n => `+${Math.round(n * 100)}% DEF`,
  };
  const freshShort = bonus => Object.entries(bonus)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => FRESH_SHORT[k](v))
    .join(' ');

  // ── Which meals you can order ─────────────────────────────────────────────
  //
  // A recipe meal needs both its ingredients in the pantry. The seven with no
  // recipe gate on rank instead, on a power ladder, so the best meal in the game
  // is not sitting there free on your first trip.

  const recipeFor = new Map(CANTEEN.recipes.map(r => [r.dish, r]));

  // ── The meal power ladder ─────────────────────────────────────────────────
  //
  // The wiki rank on an ingredient CANNOT gate meal power, because in the real
  // game the two have nothing to do with each other. The strongest recipe meals
  // in MHGU — Wyvernburger, Dragon Salad, Shaved Dragon Mussels, all 105 — are
  // cooked from ingredients the wiki unlocks at Low and High. Seven of the nine
  // ingredients feeding them are Low rank. Gate on the wiki rank alone and every
  // one of those meals is yours before you leave High Rank, while the G-rank
  // ingredients open nothing better than an 88.
  //
  // So the gate goes on the MEAL's own power, on top of the recipe. Ingredients
  // keep unlocking exactly as the real game unlocks them; what changes is that
  // holding both halves of a Wyvernburger in High Rank no longer means you get
  // to cook one. The kitchen is what is gated, not the pantry.
  const MEAL_TIERS = [
    { power: 100, hr: 13 },   // G Rank+ — Ultimate Rice and the 105s
    { power:  80, hr:  9 },   // G Rank  — the 88s
    { power:  60, hr:  4 },   // High    — the 78s
  ];                          // everything below is Low

  const mealPower = m => (m.hp || 0) + (m.stamina || 0);
  const tierHR = power => (MEAL_TIERS.find(t => power >= t.power) || { hr: 1 }).hr;

  // The HR a meal opens at: its own tier, floored by its rank where it has one.
  const mealUnlockHR = m =>
    Math.max(m.baseline ? (RANK_HR[m.rank] || 1) : 1, tierHR(mealPower(m)));

  function mealAvailable(meal, held, hr) {
    if (meal.id === 'none') return true;
    if (meal.cut) return false;
    // The rank gate sits on the MEAL, not only on its ingredients, so a pantry
    // stocked before this ladder existed does not hand over the whole canteen.
    if (hr < mealUnlockHR(meal)) return false;
    if (meal.baseline) return true;
    const r = recipeFor.get(meal.name);
    return !!r && !!held[r.a] && !!held[r.b];
  }

  const mealsAvailable = (held, hr) => MEALS.filter(m => mealAvailable(m, held, hr));

  // ── Permanent upgrades ────────────────────────────────────────────────────
  // The four upgrade sliders that used to live here — Vitality, Endurance, Line
  // Strength and Lure Quality — are gone. Gear replaced them: HP and stamina are
  // armor, the line and the lure are the rod. Kept only as a refund table, so a
  // save that already spent money on them gets it back rather than losing it.
  const RETIRED_UPGRADES = [
    { id: 'vitality',  cost: n => Math.round(1200 * Math.pow(1.38, n)) },
    { id: 'endurance', cost: n => Math.round(1000 * Math.pow(1.36, n)) },
    { id: 'line',      cost: n => Math.round(2600 * Math.pow(1.55, n)) },
    { id: 'lure',      cost: n => Math.round(3000 * Math.pow(1.58, n)) },
  ];
  // Everything a save sank into them, back to the nearest zenny.
  const refundUpgrades = (up = {}) => {
    let z = 0;
    for (const u of RETIRED_UPGRADES)
      for (let n = 0; n < (up[u.id] || 0); n++) z += u.cost(n);
    return z;
  };

  // ── The pond ──────────────────────────────────────────────────────────────
  //
  // A cast fills the water with a school and drops the bobber in the middle. Fish
  // drift; a bait pulls them in. One of them nibbles, hooks, and the bobber goes
  // under — that is your cue.
  //
  // All distances are fractions of the pond, so the surface can be any size.
  const POND = {
    school: 6,              // fish in the water at once
    fishSpeed: 0.045,       // pond-widths per second, drifting
    turnEvery: 2.2,         // seconds between heading changes
    bobberStep: 0.085,      // how far one nudge sends the bobber
    stepCooldownMs: 260,    // the pause before you can nudge again
    glideRate: 14,          // how quickly it slides to where you sent it, per second
    attract: 0.10,          // pond-widths per second toward the bobber when baited
    attractRange: 0.55,     // how far away a baited fish starts being drawn in
    nibbleRange: 0.075,     // close enough to nibble
    nibbleEveryMs: 700,     // a fish nibbles at most this often
    hookChance: 0.30,       // each nibble's chance of taking it under
    baitShare: 0.5,         // how much of the school a bait can promise you
    reelInPresses: 5,       // taps to pull an unhooked line back in
  };

  // ── Reel struggle ─────────────────────────────────────────────────────────
  //
  // The line is a gauge that starts HALF FULL and falls on its own. Every press
  // pulls it tighter. Both ends lose: run it down to nothing and the line goes
  // slack and the fish is off; drive it to the top and the line snaps. You only
  // gain ground while it sits in the good stretch around the middle, so the fight
  // is a rhythm — tap fast enough to hold it up, not so fast that you overshoot.
  //
  // Difficulty is spent on how hard that rhythm is to hold: a rare fish sinks
  // faster and leaves a narrower stretch to hold it in. It is NOT spent on making
  // the progress bar crawl, which reads as failing rather than as a strong fish.
  //
  // Difficulty comes from the fish's REAL rarity and its ore's rank, so a
  // Purecrystal Guardfish is genuinely the hardest thing in the water and it got
  // there honestly. `durationMs` also prices the cast in Stamina — the charge
  // stays nominal rather than however long you actually took, which is what keeps
  // trip lengths and every quest goal where the sim put them.
  const REEL_START = 0.5;      // where the pill sits when the fight opens
  const BAND_WIDE = 0.22;      // half-width for the cheapest thing in the water
  const BAND_TIGHT = 0.055;    // ...and for the most valuable
  const BAND_FLOOR = 0.045;    // never narrower than this, whatever the rung
  // How long you get to notice a bite, read off the same value scale the band is.
  // The window has to be long enough to NOTICE, not merely long enough to react
  // to: under a second is a reflex test you can only pass by already expecting it,
  // which is the opposite of watching for a bite. So the tight end stays well
  // clear of that even before Strike widens it.
  const STRIKE_WIDE = 2800;    // ms on the cheapest thing in the water
  const STRIKE_TIGHT = 1400;   // ...and on the most valuable
  // How much the rung itself closes the band, on top of what the catch is worth.
  // This is the dial that decides whether G Rank asks anything of you: the value
  // scale spans all 240 variants, but what you actually catch clusters near the
  // cheap end, so a typical G-rank fish was getting a quarter of the track and
  // 0.28 was not enough to be felt. Low Rank is untouched — rung is 0 there.
  const RUNG_TIGHTEN = 0.50;

  // Where a variant sits between the cheapest and dearest in the game, 0..1, on a
  // log scale because value spans two orders of magnitude. Measured off the real
  // table once, so it recalibrates itself if fish or ore prices ever change.
  let _valueSpan = null;
  function valueSpan() {
    if (_valueSpan) return _valueSpan;
    let lo = Infinity, hi = 0;
    for (const f of FISH.fish) for (const o of ORES.list) {
      const v = variantValue(f, o);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return (_valueSpan = { lo: Math.log(lo), hi: Math.log(hi) });
  }
  function valueT(fish, ore) {
    const { lo, hi } = valueSpan();
    if (hi <= lo) return 0;
    return Math.min(1, Math.max(0, (Math.log(variantValue(fish, ore)) - lo) / (hi - lo)));
  }

  // `hr` is the RUNG the quest was taken on, not your own rank. The same fish is
  // a harder fight on a G-rank rung than on a Low one: deeper water, rougher day.
  // It tightens the band and quickens the sink on top of whatever the fish's own
  // value already asked for.
  // Presses per second the line asks of you: a floor every rank resets to, plus
  // whatever the catch in your hands is worth.
  //
  // This used to run off `rarity` and `ore.rank`, which were far too coarse — a
  // 47z Whetfish and a 52z Pin Tuna came out identical — and off one continuous
  // ramp from HR1 to HR12, which meant nothing happened at a rank boundary. The
  // whole game lived between 3.9 and 6.3 presses/second across a 550x spread in
  // value, and Low Rank was flat end to end.
  //
  // It is a SAWTOOTH now, because that is what the game it is imitating does:
  // each rank drops you back to easy prey and then climbs to a peak the last
  // rank never reached. You take Low Rank gear into early High Rank and it
  // carries you; it is High Rank's own late fish that demand the next rod.
  const RATE_FLOOR = 3.1;                                  // cheapest thing in the water
  const RATE_SPAN = 4.4;                                   // ...added at the dearest
  const RANK_DEMAND = { Low: 1, High: 1.2, G: 1.38 };      // the peak each rank climbs to
  const RANK_RAMP = 0.13;                                  // drift across the rungs inside one
  const rankRung = hr => {
    const rank = curveRank(hr);
    const base = RANK_HR[rank] || 1;
    const next = rank === 'Low' ? RANK_HR.High : rank === 'High' ? RANK_HR.G : MAX_LADDER_HR + 1;
    return Math.min(1, Math.max(0, (hr - base) / Math.max(1, next - base - 1)));
  };

  function fightFor(fish, ore, rod, hr = 1, armor = null, ctx = null) {
    const r = fish.rarity, o = ore.rank;
    const durationMs = 3200 + r * 700 + o * 1400;
    const rank = curveRank(hr);
    const within = rankRung(hr);
    const rung = Math.min(1, Math.max(0, (hr - 1) / 11));   // HR1..HR12 -> 0..1
    const vt = valueT(fish, ore);
    const lift = 0.085 + rodLift(rod);
    const rate = RATE_FLOOR
      + vt * RATE_SPAN * (RANK_DEMAND[rank] || 1) * (1 + within * RANK_RAMP);
    return {
      durationMs,
      // How fast the line falls slack when you stop pulling — the thing that sets
      // how hard you have to work. The rod cuts it proportionally, so a better rod
      // buys you time on every fish rather than a fixed amount that would mean
      // everything on a cheap one and nothing on a dear one.
      sinkPerSec: Math.max(0.16, rate * lift * (1 - rodSink(rod))),
      // Control, and the reason it is TWO numbers rather than one.
      //
      // Inside the sweet spot, help has to be help you can hold: a bigger press
      // would carry the line straight back out the top, so what you want there is
      // for it to fall more slowly and stay where you put it.
      //
      // Outside it, the opposite — you are trying to get back, and a bigger press
      // is exactly the help you want. So Control slows the SINK while you are
      // held and lengthens the PRESS while you are not, and fishing.js picks
      // between them by where the line actually sits.
      sinkInBand: Math.max(0.16, rate * lift * (1 - rodSink(rod)))
        * (1 - effectPower(armor, 'control')),
      liftOutOfBand: lift * (1 + effectPower(armor, 'control')),
      // What one press buys. Nearly flat, so the rhythm stays the skill; the rod
      // adds a little, which is the only reason a press is ever worth more.
      // Plain. Control's help lives in sinkInBand and liftOutOfBand above.
      liftPerPress: lift,
      // Half-width of the good stretch either side of centre, set by what the
      // fish is WORTH. Rarity and ore rank were far too coarse for this: a 47z
      // Iron Whetfish and a 52z Iron Pin Tuna came out identical, and the most
      // valuable fish in the game only pulled the band in from 46% of the track
      // to 28%. Value spans 47z to 8,293z, so it is read on a log scale — every
      // step up in what you are holding visibly tightens the stretch.
      // The rod widens it and so does Sure Grip. Both were withheld before, on the
      // grounds that a wider target only makes it easier to be sloppy — but with
      // the demand now resetting and climbing per rank there has to be something
      // that answers a tight band, or the dearest G Rank fish are simply refused.
      // The floor is what the FISH will never take below — so it is applied to
      // the intrinsic band, and gear widens from there. Applying it after the gear
      // multiplier instead meant the dearest fish sat on the floor bare-handed and
      // a full rod plus Master's Grip bought 1.1 points of track: 83% of bonus,
      // almost all of it swallowed.
      band: Math.min(0.34,
        Math.max(BAND_FLOOR,
          (BAND_WIDE - vt * (BAND_WIDE - BAND_TIGHT)) * (1 - rung * RUNG_TIGHTEN))
        * (1 + rodBand(rod) + effectPower(armor, 'band') + heatBand(armor, ctx))),
      // Ground is only gained inside that stretch. A clean fight runs a little
      // under the nominal duration, so playing well beats the stamina you paid.
      progressPerSec: (1000 / (durationMs * 0.6)) * (1 + effectPower(armor, 'progress')),
      // ...and the fish takes ground back whenever you are outside it. Slightly
      // faster than you gain, so a fight you keep slipping out of is one you lose
      // even if the line never reaches either extreme. This is the fish's half of
      // the contest rather than another way for you to be punished.
      escapePerSec: (1000 / (durationMs * 0.6)) * 1.3 * (1 - effectPower(armor, 'escape')),
      // Inverse to what the fish is WORTH: the dearer the catch, the less time
      // you get to answer it.
      //
      // It was `2800 - rarity * 80 - oreRank * 100`, the same coarse pair the band
      // gave up for exactly this reason. That was not merely imprecise, it was not
      // even monotonic — a 437z Purecrystal Sushifish allowed 2520ms while a 15z
      // Iron Glutton Tuna allowed 2480, because rarity and ore rank can disagree
      // with price. `vt` is value on a log scale across the whole span, so every
      // step up in what you are holding visibly shortens the window. Bounded by
      // construction — vt is 0..1 — so no floor is needed.
      strikeWindowMs: (STRIKE_WIDE - vt * (STRIKE_WIDE - STRIKE_TIGHT))
        * (1 + effectPower(armor, 'strike')),
    };
  }

  // Bosses are a different animal: they sink fast, hold a narrow stretch, and
  // they cart you on a loss.
  // The band a monster leaves you, and the floor under it. The same rule the fish
  // follow — the better the catch, the less room you get — had never been applied
  // here: Plesioth pays 14,000z against a Guardfish variant's 8,300z and was
  // handing you a 26% band where the fish gets 9%, three times the room for
  // nearly twice the money.
  //
  // They still sit a little above the fish floor rather than under it, because
  // band is not the whole of the difficulty. A monster fight runs 26-32 seconds
  // against a fish's seven, and holding a hairline for half a minute is a
  // different thing from hitting one for a moment. BOSS_BAND_FLOOR is the
  // minimum there is any point playing.
  const BOSS_BAND_FLOOR = 0.05;

  // ── Gear ──────────────────────────────────────────────────────────────────
  //
  // Two slots, a rod and a suit of armor, and between them they replace all four
  // of the old upgrade sliders. Vitality and Endurance became armor; Line
  // Strength and Lure Quality became the rod.
  //
  // The reason is progression you can feel. Four sliders you nudged a level at a
  // time never read as equipment, and their effect was small enough that a
  // player could skip them entirely and still clear G Rank — which is exactly
  // what happened. Gear you forge from something you caught, in tiers named for
  // the rank they belong to, is legible in a way a slider is not.
  //
  // Rod is a LADDER: strictly better as you climb.
  // Armor is a CHOICE: comparable defence within a rank, differing by effect.

  // What a monster gives up when you land it. One part per rank, and the real
  // MHGU part at that: the game's own naming already carries the rank, base for
  // Low, `+` for High and Shard/Piel for G, so nothing here is invented.
  const MAT_LINES = {
    cephalos:   { name: 'Cephalos',      Low: 'Cephalos Scale',  High: 'Cephalos Scale+',  G: 'Cephalos Shard',   icon: 'MH4G-Scale_Icon_Light_Blue.png' },
    ludroth:    { name: 'Royal Ludroth', Low: 'R.Ludroth Scale', High: 'R.Ludroth Scale+', G: 'R.Ludroth Shard',  icon: 'MH4G-Scale_Icon_Yellow.png' },
    nibelsnarf: { name: 'Nibelsnarf',    Low: 'Nibelsnarf Hide', High: 'Nibelsnarf Hide+', G: 'Nibelsnarf Piel',  icon: 'MH4G-Hide_Icon_Brown.png' },
    plesioth:   { name: 'Plesioth',      Low: null,              High: 'Plesioth Scale+',  G: 'Plesioth Shard',   icon: 'MH4G-Scale_Icon_Blue.png' },
    zamtrios:   { name: 'Zamtrios',      Low: 'Zamtrios Scale',  High: 'Zamtrios Scale+',  G: 'Zamtrios Shard',   icon: 'MH4G-Scale_Icon_Light_Blue.png' },
    agnaktor:   { name: 'Agnaktor',      Low: 'Agnaktor Scale',  High: 'Agnaktor Hide+',   G: 'Agnaktor Piel',    icon: 'MH4G-Hide_Icon_Red.png' },
    lagiacrus:  { name: 'Lagiacrus',     Low: 'Lagiacrus Scale', High: 'Lagiacrus Scale+', G: 'Lagiacrus Shard',  icon: 'MH4G-Scale_Icon_Light_Blue.png' },
    lavasioth:  { name: 'Lavasioth',     Low: null,              High: 'Lavasioth Scale+', G: 'Lavasioth Shard',  icon: 'MH4G-Scale_Icon_Grey.png' },
    // The crabs share the shell ladder the game gives every carapace monster;
    // Mizutsune runs the same Scale / Scale+ / Shard as the other leviathans.
    hermitaur:  { name: 'Hermitaur',     Low: 'Hermitaur Shell', High: 'Hermitaur Carapace', G: 'Hermitaur Cortex', icon: 'MH4G-Shell_Icon_Red.png' },
    ceanataur:  { name: 'Ceanataur',     Low: 'Ceanataur Shell', High: 'Ceanataur Carapace', G: 'Ceanataur Cortex', icon: 'MH4G-Shell_Icon_Blue.png' },
    // G only, because that is where its armor starts and there is no earlier
    // Nakarkos to meet. The real parts: materials in MHGU top out at rarity 9
    // (r10 and r11 in the data are EQUIPMENT, not parts), and Nakarkos sits right
    // at that ceiling, which is what makes it worth being the last thing you fish.
    nakarkos:   { name: 'Nakarkos',      Low: null,              High: null,               G: 'Nakarkos Hardshell', icon: 'MH4G-Shell_Icon_Blue.png' },
    mizutsune:  { name: 'Mizutsune',     Low: 'Mizutsune Scale', High: 'Mizutsune Scale+',   G: 'Mizutsune Shard',  icon: 'MH4G-Scale_Icon_White.png' },
  };
  const matId = (line, rank) => `${line}_${rank.toLowerCase()}`;

  // ── The marketplace ───────────────────────────────────────────────────────
  //
  // Fifty-nine of the seventy-one armor lines belong to monsters you cannot fish.
  // Their parts are traded for rather than caught, and the whole economy runs on
  // RARITY and nothing else: hand over several parts of a rarity, take one part
  // of that same rarity back.
  //
  // Same rarity only, deliberately. It needs no rank gate and no HR gate because
  // rarity already is one — you cannot trade at r8 until something has given you
  // an r8 part, and only G Rank monsters do.
  const TRADE_RATE = { 4: 2, 6: 3, 8: 3 };
  const tradeRate = rarity => TRADE_RATE[rarity] || 3;

  // Everything of one rarity, which is everything a holder of that rarity may ask
  // for. Sorted by name so the list does not reshuffle as your holdings change.
  const matsAtRarity = rarity => MONSTER_MATS
    .filter(m => m.rarity === rarity)
    .sort((a, b) => a.name.localeCompare(b.name));
  const tradeRarities = () => [...new Set(MONSTER_MATS.map(m => m.rarity))].sort((a, b) => a - b);

  // ── Effects ───────────────────────────────────────────────────────────────
  //
  // Names follow one rule: Base -> Base+ -> a new name at G. A line that only
  // exists from High Rank skips the `+` and runs Base -> new name. Anything with
  // no levels at all is simply itself.
  //
  // A real MHGU skill keeps its real name ONLY where the effect genuinely is
  // that thing. Guts, Heat Cancel, Cold Cancel and Defense Up are real and mean
  // here what they mean there. Hero's Talisman was kept and then given up: once
  // it stopped negating damage and started keeping small monsters away, it was a
  // different skill, so it became Fisherman's Talisman. Whim is about
  // tools breaking and Fate about quest rewards, so neither was allowed to stand
  // in for bait saving or trade yield — those got names of their own. Every
  // invented name here was checked against the game's real skill list first.
  // ONE name per skill; the level does the rest. Every tier ladder that used to
  // live here — Sure Grip / Sure Grip+ / Master's Grip — collapsed into
  // `Sure Grip Lv N`, which is what killed the invented-top-tier-name problem
  // for good. The names below are the ones Raven already had; the block after
  // them carries working names he replaces once the allotment settles.
  //
  // `blurb` is deliberately absent on some. Four of the shipped skills only ever
  // had wording that was true at ONE level — Heat Cancel negates, Heat Resist
  // lengthens a drink — so there was no level-neutral line to keep, and inventing
  // one is not mine to do. Those, and every newly declared skill, wait for his
  // words rather than getting a placeholder that would quietly ship.
  const EFFECTS = {
    // ── Read by the game today ────────────────────────────────────────────
    band:     { name: 'Sure Grip',        per: 0.18,
                blurb: 'Widens the sweet spot when catching a fish' },
    escape:   { name: 'Tireless Arm',     per: 0.12,
                blurb: "The fish's escape bar fills more slowly when outside of the sweet spot" },
    progress: { name: 'Quick Reel',       per: 0.12,
                blurb: 'The capture bar fills more quickly while in the sweet spot' },
    bites:    { name: 'Baited Water',     per: 0.15,
                blurb: 'Fish are more eager to bite the line' },
    zenny:    { name: 'Fair Price',       per: 0.15,
                blurb: 'Every catch is worth more' },
    saver:    { name: 'Sparing Hand',     per: 0.12,
                blurb: 'A chance to not use bait/items when used' },
    gather:   { name: 'Beachcomber',      per: 0.20,
                blurb: 'When gathering, Palicos often find more items' },
    trade:    { name: 'Fair Trade',       per: 0.25,
                blurb: 'The Trade Cart will obtain more items' },
    // Capped at 30% because there are only three Books of Fishing Combos, and a
    // skill that outruns the whole book ladder makes the books pointless.
    combo:    { name: 'Steady Mixer',     per: 0.06,
                blurb: 'Increases your combo success chances' },
    // 0.18 was the three-level value. Over five levels it reached 90% off a
    // hit, which is most of the way to not being attacked at all.
    defense:  { name: 'Defense Up',       per: 0.10,
                blurb: 'When attacked by a monster, you take less damage' },
    stamina:  { name: 'Long Haul',        per: 0.08,
                blurb: 'Casting and reeling cost less stamina' },
    effectup: { name: 'Effect Up',        per: 0.25,
                blurb: 'Increases the effects of items' },
    // 0.08 a level, so five levels land on exactly 40% and every level counts.
    //
    // It was 0.35 — a three-level figure that went past 1.0 at Lv 3 once the cap
    // rose to five. pestChance multiplies by `1 - repel`, so it went NEGATIVE,
    // and `rng() >= chance` is always true against a negative: levels 3 to 5
    // were not "175% repel", they were silent, total immunity to small monsters.
    //
    // 40% also keeps it under the Hunter for Hire's 85%, which is the point of
    // the hire — a reputation should not beat a man standing watch.
    repel:    { name: "Fisherman's Talisman", per: 0.08,
                blurb: 'Repels small monsters, making attacks from them less common' },
    guts:     { name: 'Guts',             flag: true,
                blurb: 'Once per trip, instead of carting from any HP, you will be left with 1 HP.' },
    // `band` is how far up the ore ranks the cull reaches; it clears everything
    // beneath that rank and then the lower half of the rank itself. Never the
    // whole pool — see CULL_KEEP.
    cull:     { name: 'Shock Bobber',     band: [0, 1, 2, 2, 2], blurb: 'Repels the lower varieties, leaving the better ones biting' },
    heat:     { name: 'Heat Resist',      climate: 'hot',  blurb: 'Protects you from the heat of hot regions' },
    cold:     { name: 'Cold Resist',      climate: 'cold',
                blurb: 'Protects you from the cold of cold regions' },
    hotblood: { name: 'Heat Hunter',      climate: 'hot', bandInHeat: true, blurb: 'You are more comfortable in Hot regions and like Hot Drinks' },

    // ── Declared, nothing reads them yet ──────────────────────────────────
    // These exist so the armor board can name them and the checker can verify
    // them. Every `per` here is a placeholder of mine to be tuned against the
    // sim once the thing it moves is actually wired up; the comment names the
    // constant each one is for, which is the same spec tools/skills-data.js
    // carries. Working names throughout — Raven's to replace.
    strike:     { name: 'Strike',     per: 0.10, blurb: 'You have longer to answer a bite before it is gone' },  // strikeWindowMs
    control:    { name: 'Control',    per: 0.10, blurb: 'The line holds in the sweet spot more easily, and climbs back to it faster' },  // lift per press
    hook:       { name: 'Hooking',    per: 0.12, blurb: 'A nibbling fish is more likely to take the line under' },  // POND.hookChance
    reach:      { name: 'Reach',      per: 0.15, blurb: 'Baited fish notice the bobber from further away' },  // POND.attract / attractRange
    bobber:     { name: 'Bobber',     per: 0.12, blurb: 'The bobber travels further with each nudge and settles sooner' },  // POND.bobberStep / glideRate
    lure:       { name: 'Lure',       per: 0.15, blurb: 'Large monsters show themselves more often' },  // how soon a monster checks in
    // Same reasoning as the site skills: at 0.20 a full commitment made the
    // second part certain, which stops it reading as luck at all.
    parts:      { name: 'Parts',      per: 0.16, blurb: 'A chance a large monster leaves behind a second part' },  // what a monster leaves behind
    // 0.20 meant a CERTAIN second find at the cap. 0.14 leaves it a roll.
    siteGather: { name: 'Gathering',  per: 0.14, blurb: 'A chance the Palicos bring back a second of what they gathered' },  // Gather sites
    siteBug:    { name: 'Bugs',       per: 0.14, blurb: 'A chance the Palicos bring back a second bug' },  // Bug sites
    siteMine:   { name: 'Mining',     per: 0.14, blurb: 'A chance the Palicos bring back a second of what they mined' },  // Mine sites
    vigor:      { name: 'Vitality',   per: 0.05, blurb: 'You carry more HP and Stamina' },  // HP and Stamina carried
    // 0.20 took holdMs to ZERO at the cap, deleting the mechanic rather than
    // easing it. 0.12 leaves 100ms, which still has to be a deliberate hold.
    brace:      { name: 'Brace',      per: 0.12, blurb: 'Bracing against a large monster is more forgiving' },  // BOSS_ATTACK.holdMs
    // 0.20 doubled the pouch at the cap. 0.10 takes 10 slots to 15.
    carry:      { name: 'Carrying',   per: 0.10, blurb: 'You can take more bait and more items with you' },  // POUCH_SLOTS / TACKLE_SLOTS / BAIT_CARRY
    duration:   { name: 'Duration',   per: 0.20, blurb: 'Dash Juice and Armorskin last longer' },  // DASH_SECONDS / ARMOR_SECONDS
    hire:       { name: 'Hire',       per: 0.20, blurb: 'The Hunter for Hire turns away more of what comes at you' },  // PEST.hireCut
    fresh:      { name: 'Fresh',      per: 0.15, blurb: 'More of the pantry is fresh when you get back to camp' },  // FRESH_CHANCE / FRESH_MAX
    bounty:     { name: 'Bounty',     per: 0.15, blurb: 'Large monsters are worth more' },  // BOSS_REWARD_MULT
    haggle:     { name: 'Costs',      per: 0.10, blurb: 'The hire, the Palicos and the Trade Cart all charge less' },  // hire / Palico / cart charges
    lesson:     { name: 'Experience', per: 0.20, blurb: 'You learn more from every catch' },  // XP per catch
    basket:     { name: 'Basket',     per: 0.10, blurb: 'A full basket takes fewer fish' },  // BASKET.target
    // Bombs and traps are designed but unbuilt; these four wait on that feature.
    blast:      { name: 'Blast',      per: 0.15, blurb: 'A bomb takes fish from further out' },  // bomb blast radius
    bruising:   { name: 'Bruising',   per: 0.15, blurb: 'Fish taken by a bomb or a Shock Trap keep more of their value' },  // value lost to a blast / Shock Trap
    trapping:   { name: 'Trapping',   per: 0.15, blurb: 'Traps catch fish more often' },  // a trap's odds of catching
    trapsize:   { name: 'Capacity',   per: 0.15, blurb: 'A trap holds more fish before it is full' },  // how many fish a trap holds
  };
  // Levels now STACK across pieces rather than being read off the rank, so a
  // ceiling is required where none used to be needed.
  const EFFECT_MAX = 5;
  // The number carries the degree, so the name never has to. A flag has no
  // level to show.
  const effectName = (key, lvl) => {
    const e = EFFECTS[key];
    if (!e) return '';
    return e.flag ? e.name : e.name + ' Lv ' + Math.min(EFFECT_MAX, Math.max(1, lvl || 1));
  };
  // One line per skill regardless of level. Empty until Raven writes it.
  const effectBlurb = key => EFFECTS[key]?.blurb || '';
  const isFlagEffect = key => !!EFFECTS[key]?.flag;

  // ── Armor ─────────────────────────────────────────────────────────────────
  //
  // One line per monster, named the way MHGU names them: base at Low, S at High,
  // X at G. Each line carries a PRIMARY effect that gets stronger as you climb,
  // and picks up a SECOND effect only at G. Which second is fixed per line, so a
  // set keeps an identity and committing to one means something.
  //
  // Lines whose monster does not exist below High Rank start there — the same
  // rule the materials already state.
  // TWO skills on every suit, both climbing together: base at Low, improved at
  // High, maxed at G. A G suit then picks up a THIRD at level 1, or one of the
  // skills that has no levels at all.
  //
  // The third skill at LEVEL ONE is what makes the whole ladder visible. Under the
  // old shape a second effect only ever appeared at level 3, so the tier-1 name of
  // anything that was not somebody's primary — Sure Grip, Cold Resist, Fair Price,
  // Steady Mixer — existed in the code and could never be seen in the game. Now
  // every effect has a line carrying it up from 1, and the G thirds fill in the
  // ones whose own line starts at High Rank.
  // Every large monster bar Deviants and Variants has a line. What each piece
  // carries is Raven's, assigned in tools/armor.html and exported to
  // tools/armor-assignment.mjs; scripts/ingest-armor.mjs copies it in below.
  // EDIT THE BENCH, NOT THIS. A hand-edit here is overwritten by the next ingest
  // and, worse, silently disagrees with the board he is designing against.
  //
  // Only the lines with materials in MAT_LINES can actually be forged today —
  // the other sixty are exchange lines waiting on the Trader, which is why they
  // carry an assignment but produce no ARMORS entries yet.
  //
  const PIECE_SLOTS = ['helm', 'chest', 'waist'];
  // MHGU's own convention: the piece names the slot and the RANK suffixes the
  // piece — Cephalos Helm, Cephalos Helm S, Cephalos Helm X.
  const PIECE_LABEL = { helm: 'Helm', chest: 'Chest', waist: 'Waist' };

  // >>> ARMOR_PIECES START
  const ARMOR_PIECES = {
  cephalos: {
    floor: 'Low',
    Low:  { helm: [{ k: 'heat', lvl: 1 }], chest: [{ k: 'strike', lvl: 1 }], waist: [{ k: 'strike', lvl: 1 }] },
    High: { helm: [{ k: 'heat', lvl: 2 }, { k: 'duration', lvl: 1 }], chest: [{ k: 'strike', lvl: 2 }, { k: 'zenny', lvl: 1 }], waist: [{ k: 'strike', lvl: 2 }, { k: 'fresh', lvl: 1 }] },
    G:    { helm: [{ k: 'heat', lvl: 2 }, { k: 'duration', lvl: 1 }, { k: 'parts', lvl: 1 }], chest: [{ k: 'strike', lvl: 2 }, { k: 'zenny', lvl: 1 }, { k: 'escape', lvl: 1 }], waist: [{ k: 'strike', lvl: 2 }, { k: 'fresh', lvl: 1 }, { k: 'trapping', lvl: 1 }] },
    setBonus: null,
  },
  ludroth: {
    floor: 'Low',
    Low:  { helm: [{ k: 'gather', lvl: 1 }], chest: [{ k: 'stamina', lvl: 1 }], waist: [{ k: 'stamina', lvl: 1 }] },
    High: { helm: [{ k: 'gather', lvl: 2 }, { k: 'effectup', lvl: 1 }], chest: [{ k: 'stamina', lvl: 2 }, { k: 'gather', lvl: 1 }], waist: [{ k: 'stamina', lvl: 2 }, { k: 'duration', lvl: 1 }] },
    G:    { helm: [{ k: 'gather', lvl: 2 }, { k: 'effectup', lvl: 1 }, { k: 'trade', lvl: 1 }], chest: [{ k: 'stamina', lvl: 2 }, { k: 'gather', lvl: 2 }, { k: 'trade', lvl: 1 }], waist: [{ k: 'stamina', lvl: 3 }, { k: 'duration', lvl: 1 }, { k: 'trade', lvl: 2 }] },
    setBonus: null,
  },
  nibelsnarf: {
    floor: 'Low',
    Low:  { helm: [{ k: 'escape', lvl: 1 }], chest: [{ k: 'escape', lvl: 1 }], waist: [{ k: 'bites', lvl: 1 }] },
    High: { helm: [{ k: 'escape', lvl: 2 }, { k: 'lure', lvl: 1 }], chest: [{ k: 'escape', lvl: 2 }, { k: 'defense', lvl: 1 }], waist: [{ k: 'bites', lvl: 2 }, { k: 'control', lvl: 1 }] },
    G:    { helm: [{ k: 'escape', lvl: 2 }, { k: 'lure', lvl: 1 }, { k: 'strike', lvl: 1 }], chest: [{ k: 'escape', lvl: 2 }, { k: 'defense', lvl: 1 }, { k: 'strike', lvl: 1 }], waist: [{ k: 'bites', lvl: 2 }, { k: 'control', lvl: 1 }, { k: 'strike', lvl: 1 }] },
    setBonus: null,
  },
  plesioth: {
    floor: 'High',
    High: { helm: [{ k: 'basket', lvl: 1 }, { k: 'trapsize', lvl: 1 }, { k: 'trapping', lvl: 1 }], chest: [{ k: 'basket', lvl: 1 }, { k: 'trapsize', lvl: 1 }, { k: 'trapping', lvl: 1 }], waist: [{ k: 'basket', lvl: 1 }, { k: 'trapsize', lvl: 1 }, { k: 'trapping', lvl: 1 }] },
    G:    { helm: [{ k: 'basket', lvl: 2 }, { k: 'trapsize', lvl: 1 }, { k: 'trapping', lvl: 2 }], chest: [{ k: 'basket', lvl: 2 }, { k: 'trapsize', lvl: 2 }, { k: 'trapping', lvl: 1 }], waist: [{ k: 'basket', lvl: 1 }, { k: 'trapping', lvl: 2 }, { k: 'trapsize', lvl: 1 }] },
    setBonus: null,
  },
  zamtrios: {
    floor: 'Low',
    Low:  { helm: [{ k: 'cold', lvl: 1 }], chest: [{ k: 'parts', lvl: 1 }], waist: [{ k: 'cold', lvl: 1 }] },
    High: { helm: [{ k: 'cold', lvl: 1 }, { k: 'parts', lvl: 1 }, { k: 'combo', lvl: 1 }], chest: [{ k: 'parts', lvl: 2 }, { k: 'strike', lvl: 1 }], waist: [{ k: 'cold', lvl: 2 }, { k: 'trapping', lvl: 1 }] },
    G:    { helm: [{ k: 'cold', lvl: 2 }, { k: 'parts', lvl: 2 }, { k: 'combo', lvl: 1 }], chest: [{ k: 'parts', lvl: 2 }, { k: 'strike', lvl: 2 }, { k: 'defense', lvl: 1 }], waist: [{ k: 'cold', lvl: 3 }, { k: 'trapping', lvl: 1 }, { k: 'defense', lvl: 1 }] },
    setBonus: null,
  },
  agnaktor: {
    floor: 'High',
    High: { helm: [{ k: 'brace', lvl: 2 }, { k: 'strike', lvl: 1 }], chest: [{ k: 'heat', lvl: 2 }, { k: 'strike', lvl: 1 }], waist: [{ k: 'heat', lvl: 2 }, { k: 'strike', lvl: 1 }] },
    G:    { helm: [{ k: 'brace', lvl: 3 }, { k: 'strike', lvl: 1 }, { k: 'heat', lvl: 1 }], chest: [{ k: 'heat', lvl: 2 }, { k: 'strike', lvl: 2 }, { k: 'defense', lvl: 2 }], waist: [{ k: 'heat', lvl: 2 }, { k: 'strike', lvl: 1 }, { k: 'defense', lvl: 2 }] },
    setBonus: null,
  },
  lagiacrus: {
    floor: 'High',
    High: { helm: [{ k: 'zenny', lvl: 1 }, { k: 'bounty', lvl: 1 }, { k: 'combo', lvl: 1 }], chest: [{ k: 'zenny', lvl: 1 }, { k: 'bounty', lvl: 1 }, { k: 'combo', lvl: 1 }], waist: [{ k: 'zenny', lvl: 1 }, { k: 'bounty', lvl: 1 }, { k: 'combo', lvl: 1 }] },
    G:    { helm: [{ k: 'zenny', lvl: 2 }, { k: 'bounty', lvl: 2 }, { k: 'combo', lvl: 1 }], chest: [{ k: 'zenny', lvl: 2 }, { k: 'bounty', lvl: 1 }, { k: 'combo', lvl: 1 }], waist: [{ k: 'zenny', lvl: 1 }, { k: 'bounty', lvl: 2 }, { k: 'combo', lvl: 1 }] },
    setBonus: null,
  },
  lavasioth: {
    floor: 'High',
    High: { helm: [{ k: 'siteMine', lvl: 1 }, { k: 'reach', lvl: 1 }, { k: 'bites', lvl: 1 }], chest: [{ k: 'siteMine', lvl: 1 }, { k: 'bobber', lvl: 1 }, { k: 'strike', lvl: 1 }], waist: [{ k: 'siteMine', lvl: 1 }, { k: 'band', lvl: 1 }, { k: 'escape', lvl: 1 }] },
    G:    { helm: [{ k: 'siteMine', lvl: 2 }, { k: 'reach', lvl: 2 }, { k: 'bites', lvl: 2 }], chest: [{ k: 'siteMine', lvl: 1 }, { k: 'bobber', lvl: 2 }, { k: 'strike', lvl: 2 }], waist: [{ k: 'siteMine', lvl: 2 }, { k: 'band', lvl: 2 }, { k: 'escape', lvl: 2 }] },
    setBonus: null,
  },
  hermitaur: {
    floor: 'Low',
    Low:  { helm: [{ k: 'trapsize', lvl: 1 }], chest: [{ k: 'progress', lvl: 1 }], waist: [{ k: 'progress', lvl: 1 }] },
    High: { helm: [{ k: 'trapsize', lvl: 2 }, { k: 'brace', lvl: 1 }], chest: [{ k: 'progress', lvl: 2 }, { k: 'trapping', lvl: 1 }], waist: [{ k: 'progress', lvl: 1 }, { k: 'trapping', lvl: 2 }] },
    G:    { helm: [{ k: 'trapsize', lvl: 2 }, { k: 'brace', lvl: 1 }], chest: [{ k: 'progress', lvl: 2 }, { k: 'trapping', lvl: 1 }], waist: [{ k: 'progress', lvl: 1 }, { k: 'trapping', lvl: 2 }] },
    setBonus: null,
  },
  ceanataur: {
    floor: 'High',
    High: { helm: [{ k: 'band', lvl: 2 }, { k: 'parts', lvl: 1 }], chest: [{ k: 'band', lvl: 1 }, { k: 'parts', lvl: 2 }], waist: [{ k: 'band', lvl: 1 }, { k: 'repel', lvl: 1 }, { k: 'siteGather', lvl: 1 }] },
    G:    { helm: [{ k: 'band', lvl: 2 }, { k: 'parts', lvl: 2 }, { k: 'cold', lvl: 2 }], chest: [{ k: 'band', lvl: 2 }, { k: 'parts', lvl: 2 }, { k: 'heat', lvl: 2 }], waist: [{ k: 'band', lvl: 1 }, { k: 'repel', lvl: 1 }, { k: 'siteGather', lvl: 1 }] },
    setBonus: null,
  },
  mizutsune: {
    floor: 'High',
    High: { helm: [{ k: 'duration', lvl: 1 }, { k: 'control', lvl: 1 }, { k: 'stamina', lvl: 1 }], chest: [{ k: 'duration', lvl: 1 }, { k: 'control', lvl: 1 }, { k: 'stamina', lvl: 1 }], waist: [{ k: 'duration', lvl: 1 }, { k: 'control', lvl: 1 }, { k: 'band', lvl: 1 }] },
    G:    { helm: [{ k: 'duration', lvl: 1 }, { k: 'control', lvl: 1 }, { k: 'stamina', lvl: 2 }], chest: [{ k: 'duration', lvl: 1 }, { k: 'control', lvl: 2 }, { k: 'stamina', lvl: 2 }], waist: [{ k: 'duration', lvl: 2 }, { k: 'control', lvl: 1 }, { k: 'band', lvl: 1 }] },
    setBonus: null,
  },
  ahtal_ka: {   // exchange
    floor: 'G',
    G:    { helm: [], chest: [], waist: [] },
    setBonus: null,
  },
  akantor: {   // exchange
    floor: 'G',
    G:    { helm: [{ k: 'defense', lvl: 1 }, { k: 'brace', lvl: 2 }, { k: 'lure', lvl: 1 }, { k: 'band', lvl: 1 }], chest: [{ k: 'defense', lvl: 2 }, { k: 'lure', lvl: 2 }, { k: 'brace', lvl: 1 }, { k: 'band', lvl: 1 }], waist: [{ k: 'defense', lvl: 2 }, { k: 'lure', lvl: 2 }, { k: 'brace', lvl: 2 }, { k: 'band', lvl: 1 }] },
    setBonus: null,
  },
  alatreon: {   // exchange
    floor: 'G',
    G:    { helm: [], chest: [], waist: [] },
    setBonus: null,
  },
  amatsu: {   // exchange
    floor: 'G',
    G:    { helm: [], chest: [], waist: [] },
    setBonus: null,
  },
  arzuros: {   // exchange
    floor: 'Low',
    Low:  { helm: [{ k: 'siteGather', lvl: 1 }], chest: [{ k: 'siteGather', lvl: 1 }], waist: [{ k: 'vigor', lvl: 1 }] },
    High: { helm: [{ k: 'siteGather', lvl: 2 }, { k: 'brace', lvl: 1 }], chest: [{ k: 'siteGather', lvl: 2 }, { k: 'band', lvl: 1 }], waist: [{ k: 'vigor', lvl: 2 }, { k: 'effectup', lvl: 1 }] },
    G:    { helm: [{ k: 'siteGather', lvl: 2 }, { k: 'brace', lvl: 1 }, { k: 'band', lvl: 1 }], chest: [{ k: 'siteGather', lvl: 2 }, { k: 'band', lvl: 1 }, { k: 'stamina', lvl: 1 }], waist: [{ k: 'vigor', lvl: 2 }, { k: 'effectup', lvl: 1 }, { k: 'stamina', lvl: 1 }] },
    setBonus: null,
  },
  astalos: {   // exchange
    floor: 'High',
    High: { helm: [{ k: 'progress', lvl: 2 }, { k: 'zenny', lvl: 1 }], chest: [{ k: 'progress', lvl: 1 }, { k: 'stamina', lvl: 1 }], waist: [{ k: 'progress', lvl: 1 }, { k: 'lure', lvl: 2 }] },
    G:    { helm: [{ k: 'progress', lvl: 3 }, { k: 'zenny', lvl: 1 }, { k: 'escape', lvl: 1 }], chest: [{ k: 'progress', lvl: 1 }, { k: 'stamina', lvl: 2 }, { k: 'escape', lvl: 2 }], waist: [{ k: 'progress', lvl: 1 }, { k: 'lure', lvl: 2 }, { k: 'escape', lvl: 2 }] },
    setBonus: null,
  },
  barioth: {   // exchange
    floor: 'High',
    High: { helm: [{ k: 'cold', lvl: 2 }, { k: 'escape', lvl: 1 }], chest: [{ k: 'cold', lvl: 2 }, { k: 'escape', lvl: 1 }], waist: [{ k: 'cold', lvl: 1 }, { k: 'band', lvl: 1 }] },
    G:    { helm: [{ k: 'cold', lvl: 2 }, { k: 'escape', lvl: 2 }, { k: 'reach', lvl: 2 }], chest: [{ k: 'cold', lvl: 2 }, { k: 'escape', lvl: 2 }, { k: 'reach', lvl: 1 }], waist: [{ k: 'cold', lvl: 1 }, { k: 'band', lvl: 2 }, { k: 'reach', lvl: 2 }] },
    setBonus: null,
  },
  barroth: {   // exchange
    floor: 'High',
    High: { helm: [{ k: 'heat', lvl: 1 }, { k: 'vigor', lvl: 1 }, { k: 'defense', lvl: 1 }], chest: [{ k: 'heat', lvl: 1 }, { k: 'vigor', lvl: 1 }, { k: 'brace', lvl: 1 }], waist: [{ k: 'heat', lvl: 2 }, { k: 'defense', lvl: 1 }] },
    G:    { helm: [{ k: 'heat', lvl: 2 }, { k: 'vigor', lvl: 2 }, { k: 'defense', lvl: 2 }], chest: [{ k: 'heat', lvl: 1 }, { k: 'vigor', lvl: 2 }, { k: 'brace', lvl: 1 }], waist: [{ k: 'heat', lvl: 2 }, { k: 'defense', lvl: 1 }, { k: 'escape', lvl: 2 }] },
    setBonus: null,
  },
  basarios: {   // exchange
    floor: 'High',
    High: { helm: [{ k: 'siteMine', lvl: 1 }, { k: 'defense', lvl: 2 }], chest: [{ k: 'siteMine', lvl: 1 }, { k: 'effectup', lvl: 2 }], waist: [{ k: 'siteMine', lvl: 2 }, { k: 'saver', lvl: 1 }] },
    G:    { helm: [{ k: 'siteMine', lvl: 2 }, { k: 'defense', lvl: 2 }, { k: 'lesson', lvl: 1 }], chest: [{ k: 'siteMine', lvl: 1 }, { k: 'effectup', lvl: 2 }, { k: 'lesson', lvl: 2 }], waist: [{ k: 'siteMine', lvl: 2 }, { k: 'saver', lvl: 1 }, { k: 'lesson', lvl: 2 }] },
    setBonus: null,
  },
  blangonga: {   // exchange
    floor: 'High',
    High: { helm: [{ k: 'repel', lvl: 2 }, { k: 'cold', lvl: 1 }], chest: [{ k: 'repel', lvl: 1 }, { k: 'stamina', lvl: 2 }], waist: [{ k: 'repel', lvl: 1 }, { k: 'strike', lvl: 2 }] },
    G:    { helm: [{ k: 'repel', lvl: 2 }, { k: 'cold', lvl: 1 }], chest: [{ k: 'repel', lvl: 1 }, { k: 'stamina', lvl: 2 }], waist: [{ k: 'repel', lvl: 1 }, { k: 'strike', lvl: 2 }] },
    setBonus: null,
  },
  brachydios: {   // exchange
    floor: 'High',
    High: { helm: [{ k: 'blast', lvl: 1 }, { k: 'bruising', lvl: 1 }, { k: 'lure', lvl: 1 }], chest: [{ k: 'blast', lvl: 2 }, { k: 'bruising', lvl: 1 }], waist: [{ k: 'blast', lvl: 1 }, { k: 'bruising', lvl: 2 }] },
    G:    { helm: [{ k: 'blast', lvl: 2 }, { k: 'bruising', lvl: 1 }, { k: 'lure', lvl: 3 }], chest: [{ k: 'blast', lvl: 1 }, { k: 'bruising', lvl: 2 }, { k: 'zenny', lvl: 2 }], waist: [{ k: 'blast', lvl: 2 }, { k: 'bruising', lvl: 2 }, { k: 'zenny', lvl: 2 }] },
    setBonus: null,
  },
  bulldrome: {   // exchange
    floor: 'Low',
    Low:  { helm: [{ k: 'repel', lvl: 1 }], chest: [{ k: 'defense', lvl: 1 }], waist: [{ k: 'repel', lvl: 1 }] },
    High: { helm: [{ k: 'repel', lvl: 2 }, { k: 'defense', lvl: 1 }], chest: [{ k: 'defense', lvl: 2 }, { k: 'stamina', lvl: 1 }], waist: [{ k: 'repel', lvl: 2 }, { k: 'bobber', lvl: 1 }] },
    G:    { helm: [{ k: 'repel', lvl: 2 }, { k: 'defense', lvl: 1 }, { k: 'trade', lvl: 1 }], chest: [{ k: 'defense', lvl: 2 }, { k: 'stamina', lvl: 1 }, { k: 'zenny', lvl: 1 }], waist: [{ k: 'repel', lvl: 2 }, { k: 'bobber', lvl: 1 }, { k: 'saver', lvl: 1 }] },
    setBonus: null,
  },
  chameleos: {   // exchange
    floor: 'G',
    G:    { helm: [], chest: [], waist: [] },
    setBonus: null,
  },
  congalala: {   // exchange
    floor: 'Low',
    Low:  { helm: [{ k: 'effectup', lvl: 1 }], chest: [{ k: 'effectup', lvl: 1 }], waist: [{ k: 'combo', lvl: 1 }] },
    High: { helm: [{ k: 'effectup', lvl: 2 }, { k: 'carry', lvl: 1 }], chest: [{ k: 'effectup', lvl: 2 }, { k: 'carry', lvl: 1 }], waist: [{ k: 'combo', lvl: 2 }, { k: 'carry', lvl: 1 }] },
    G:    { helm: [{ k: 'effectup', lvl: 2 }, { k: 'carry', lvl: 2 }, { k: 'combo', lvl: 1 }], chest: [{ k: 'effectup', lvl: 2 }, { k: 'carry', lvl: 2 }, { k: 'combo', lvl: 1 }], waist: [{ k: 'combo', lvl: 2 }, { k: 'carry', lvl: 1 }, { k: 'effectup', lvl: 1 }] },
    setBonus: null,
  },
  crimson_fatalis: {   // exchange
    floor: 'G',
    G:    { helm: [], chest: [], waist: [] },
    setBonus: null,
  },
  deviljho: {   // exchange
    floor: 'G',
    G:    { helm: [{ k: 'bounty', lvl: 2 }, { k: 'lure', lvl: 1 }, { k: 'band', lvl: 1 }, { k: 'progress', lvl: 1 }], chest: [{ k: 'bounty', lvl: 2 }, { k: 'lure', lvl: 2 }, { k: 'band', lvl: 2 }, { k: 'progress', lvl: 1 }], waist: [{ k: 'bounty', lvl: 1 }, { k: 'lure', lvl: 2 }, { k: 'band', lvl: 2 }, { k: 'escape', lvl: 1 }] },
    setBonus: null,
  },
  diablos: {   // exchange
    floor: 'G',
    G:    { helm: [{ k: 'escape', lvl: 2 }, { k: 'progress', lvl: 1 }, { k: 'reach', lvl: 2 }, { k: 'strike', lvl: 2 }], chest: [{ k: 'escape', lvl: 2 }, { k: 'progress', lvl: 2 }, { k: 'reach', lvl: 1 }, { k: 'strike', lvl: 2 }], waist: [{ k: 'escape', lvl: 1 }, { k: 'progress', lvl: 2 }, { k: 'reach', lvl: 2 }, { k: 'strike', lvl: 1 }] },
    setBonus: null,
  },
  duramboros: {   // exchange
    floor: 'G',
    G:    { helm: [{ k: 'vigor', lvl: 2 }, { k: 'stamina', lvl: 2 }, { k: 'defense', lvl: 1 }, { k: 'brace', lvl: 2 }], chest: [{ k: 'vigor', lvl: 2 }, { k: 'stamina', lvl: 1 }, { k: 'defense', lvl: 2 }, { k: 'brace', lvl: 2 }], waist: [{ k: 'vigor', lvl: 1 }, { k: 'stamina', lvl: 2 }, { k: 'defense', lvl: 2 }, { k: 'brace', lvl: 1 }] },
    setBonus: null,
  },
  fatalis: {   // exchange
    floor: 'G',
    G:    { helm: [], chest: [], waist: [] },
    setBonus: null,
  },
  gammoth: {   // exchange
    floor: 'High',
    High: { helm: [{ k: 'vigor', lvl: 1 }, { k: 'cold', lvl: 1 }, { k: 'stamina', lvl: 1 }], chest: [{ k: 'vigor', lvl: 1 }, { k: 'cold', lvl: 1 }, { k: 'stamina', lvl: 1 }], waist: [{ k: 'vigor', lvl: 1 }, { k: 'cold', lvl: 1 }, { k: 'stamina', lvl: 1 }] },
    G:    { helm: [{ k: 'vigor', lvl: 2 }, { k: 'cold', lvl: 2 }, { k: 'stamina', lvl: 1 }, { k: 'parts', lvl: 1 }], chest: [{ k: 'vigor', lvl: 2 }, { k: 'cold', lvl: 1 }, { k: 'stamina', lvl: 2 }, { k: 'parts', lvl: 1 }], waist: [{ k: 'vigor', lvl: 1 }, { k: 'cold', lvl: 2 }, { k: 'stamina', lvl: 2 }] },
    setBonus: null,
  },
  gendrome: {   // exchange
    floor: 'Low',
    Low:  { helm: [{ k: 'bounty', lvl: 1 }], chest: [{ k: 'zenny', lvl: 1 }], waist: [{ k: 'bounty', lvl: 1 }] },
    High: { helm: [{ k: 'bounty', lvl: 1 }, { k: 'zenny', lvl: 1 }], chest: [{ k: 'zenny', lvl: 2 }, { k: 'band', lvl: 1 }], waist: [{ k: 'bounty', lvl: 2 }, { k: 'band', lvl: 1 }] },
    G:    { helm: [{ k: 'bounty', lvl: 1 }, { k: 'zenny', lvl: 1 }, { k: 'lesson', lvl: 1 }], chest: [{ k: 'zenny', lvl: 2 }, { k: 'band', lvl: 1 }, { k: 'lesson', lvl: 1 }], waist: [{ k: 'bounty', lvl: 2 }, { k: 'band', lvl: 1 }, { k: 'lesson', lvl: 1 }] },
    setBonus: null,
  },
  giadrome: {   // exchange
    floor: 'Low',
    Low:  { helm: [{ k: 'trade', lvl: 1 }], chest: [{ k: 'fresh', lvl: 1 }], waist: [{ k: 'fresh', lvl: 1 }] },
    High: { helm: [{ k: 'trade', lvl: 2 }, { k: 'reach', lvl: 1 }], chest: [{ k: 'fresh', lvl: 2 }, { k: 'band', lvl: 1 }], waist: [{ k: 'fresh', lvl: 2 }, { k: 'band', lvl: 1 }] },
    G:    { helm: [{ k: 'trade', lvl: 2 }, { k: 'reach', lvl: 1 }, { k: 'hire', lvl: 1 }], chest: [{ k: 'fresh', lvl: 2 }, { k: 'band', lvl: 1 }, { k: 'hire', lvl: 1 }], waist: [{ k: 'fresh', lvl: 2 }, { k: 'band', lvl: 1 }, { k: 'hire', lvl: 1 }] },
    setBonus: null,
  },
  glavenus: {   // exchange
    floor: 'High',
    High: { helm: [{ k: 'brace', lvl: 1 }, { k: 'bounty', lvl: 1 }], chest: [{ k: 'brace', lvl: 1 }, { k: 'bounty', lvl: 1 }], waist: [{ k: 'brace', lvl: 1 }, { k: 'combo', lvl: 1 }] },
    G:    { helm: [{ k: 'brace', lvl: 1 }, { k: 'bounty', lvl: 2 }, { k: 'siteMine', lvl: 1 }, { k: 'band', lvl: 1 }], chest: [{ k: 'brace', lvl: 2 }, { k: 'bounty', lvl: 1 }, { k: 'siteMine', lvl: 1 }, { k: 'band', lvl: 1 }], waist: [{ k: 'brace', lvl: 2 }, { k: 'combo', lvl: 1 }, { k: 'siteMine', lvl: 2 }] },
    setBonus: null,
  },
  gold_rathian: {   // exchange
    floor: 'G',
    G:    { helm: [], chest: [], waist: [] },
    setBonus: null,
  },
  gore_magala: {   // exchange
    floor: 'High',
    High: { helm: [{ k: 'bounty', lvl: 1 }, { k: 'band', lvl: 1 }, { k: 'escape', lvl: 1 }], chest: [{ k: 'bounty', lvl: 1 }, { k: 'band', lvl: 1 }, { k: 'escape', lvl: 1 }], waist: [{ k: 'bounty', lvl: 1 }, { k: 'band', lvl: 1 }, { k: 'escape', lvl: 1 }] },
    G:    { helm: [{ k: 'bounty', lvl: 2 }, { k: 'band', lvl: 2 }, { k: 'escape', lvl: 1 }], chest: [{ k: 'bounty', lvl: 1 }, { k: 'band', lvl: 2 }, { k: 'escape', lvl: 2 }], waist: [{ k: 'bounty', lvl: 2 }, { k: 'band', lvl: 1 }, { k: 'escape', lvl: 2 }] },
    setBonus: null,
  },
  gravios: {   // exchange
    floor: 'G',
    G:    { helm: [{ k: 'heat', lvl: 1 }, { k: 'siteMine', lvl: 1 }, { k: 'siteBug', lvl: 1 }, { k: 'siteGather', lvl: 1 }, { k: 'gather', lvl: 1 }], chest: [{ k: 'heat', lvl: 1 }, { k: 'siteMine', lvl: 1 }, { k: 'siteBug', lvl: 1 }, { k: 'siteGather', lvl: 1 }, { k: 'gather', lvl: 1 }], waist: [{ k: 'heat', lvl: 1 }, { k: 'siteMine', lvl: 1 }, { k: 'siteBug', lvl: 1 }, { k: 'siteGather', lvl: 1 }, { k: 'gather', lvl: 1 }] },
    setBonus: null,
  },
  great_maccao: {   // exchange
    floor: 'Low',
    Low:  { helm: [{ k: 'duration', lvl: 1 }], chest: [{ k: 'duration', lvl: 1 }], waist: [{ k: 'hook', lvl: 1 }] },
    High: { helm: [{ k: 'duration', lvl: 2 }, { k: 'control', lvl: 1 }], chest: [{ k: 'duration', lvl: 2 }, { k: 'bites', lvl: 1 }], waist: [{ k: 'hook', lvl: 2 }, { k: 'control', lvl: 1 }] },
    G:    { helm: [{ k: 'duration', lvl: 2 }, { k: 'control', lvl: 1 }, { k: 'brace', lvl: 1 }], chest: [{ k: 'duration', lvl: 2 }, { k: 'bites', lvl: 2 }, { k: 'brace', lvl: 1 }], waist: [{ k: 'hook', lvl: 2 }, { k: 'control', lvl: 1 }, { k: 'brace', lvl: 2 }] },
    setBonus: null,
  },
  gypceros: {   // exchange
    floor: 'Low',
    Low:  { helm: [{ k: 'brace', lvl: 1 }], chest: [{ k: 'lure', lvl: 1 }], waist: [{ k: 'brace', lvl: 1 }] },
    High: { helm: [{ k: 'brace', lvl: 2 }, { k: 'hook', lvl: 1 }], chest: [{ k: 'lure', lvl: 2 }, { k: 'hook', lvl: 1 }], waist: [{ k: 'brace', lvl: 2 }, { k: 'band', lvl: 1 }] },
    G:    { helm: [{ k: 'brace', lvl: 2 }, { k: 'hook', lvl: 1 }], chest: [{ k: 'lure', lvl: 2 }, { k: 'hook', lvl: 1 }], waist: [{ k: 'brace', lvl: 2 }, { k: 'band', lvl: 1 }] },
    setBonus: null,
  },
  iodrome: {   // exchange
    floor: 'Low',
    Low:  { helm: [{ k: 'vigor', lvl: 1 }], chest: [{ k: 'vigor', lvl: 1 }], waist: [{ k: 'saver', lvl: 1 }] },
    High: { helm: [{ k: 'vigor', lvl: 2 }, { k: 'siteGather', lvl: 1 }], chest: [{ k: 'vigor', lvl: 2 }, { k: 'stamina', lvl: 1 }], waist: [{ k: 'saver', lvl: 2 }, { k: 'siteGather', lvl: 1 }] },
    G:    { helm: [{ k: 'vigor', lvl: 2 }, { k: 'siteGather', lvl: 1 }, { k: 'repel', lvl: 1 }], chest: [{ k: 'vigor', lvl: 2 }, { k: 'stamina', lvl: 1 }, { k: 'repel', lvl: 1 }], waist: [{ k: 'saver', lvl: 2 }, { k: 'siteGather', lvl: 1 }, { k: 'repel', lvl: 1 }] },
    setBonus: null,
  },
  kecha_wacha: {   // exchange
    floor: 'High',
    High: { helm: [{ k: 'stamina', lvl: 2 }, { k: 'lesson', lvl: 1 }], chest: [{ k: 'stamina', lvl: 1 }, { k: 'lesson', lvl: 2 }], waist: [{ k: 'stamina', lvl: 2 }, { k: 'basket', lvl: 1 }] },
    G:    { helm: [{ k: 'stamina', lvl: 2 }, { k: 'lesson', lvl: 1 }, { k: 'duration', lvl: 2 }], chest: [{ k: 'stamina', lvl: 2 }, { k: 'lesson', lvl: 2 }, { k: 'duration', lvl: 1 }], waist: [{ k: 'stamina', lvl: 1 }, { k: 'basket', lvl: 2 }, { k: 'duration', lvl: 1 }] },
    setBonus: null,
  },
  khezu: {   // exchange
    floor: 'High',
    High: { helm: [{ k: 'trapping', lvl: 2 }, { k: 'progress', lvl: 1 }], chest: [{ k: 'trapping', lvl: 1 }, { k: 'saver', lvl: 1 }], waist: [{ k: 'trapping', lvl: 1 }, { k: 'progress', lvl: 2 }] },
    G:    { helm: [{ k: 'trapping', lvl: 2 }, { k: 'progress', lvl: 2 }, { k: 'bruising', lvl: 2 }], chest: [{ k: 'trapping', lvl: 2 }, { k: 'saver', lvl: 1 }, { k: 'bruising', lvl: 1 }], waist: [{ k: 'trapping', lvl: 1 }, { k: 'progress', lvl: 2 }, { k: 'bruising', lvl: 2 }] },
    setBonus: null,
  },
  kirin: {   // exchange
    floor: 'G',
    G:    { helm: [], chest: [], waist: [] },
    setBonus: null,
  },
  kushala_daora: {   // exchange
    floor: 'G',
    G:    { helm: [], chest: [], waist: [] },
    setBonus: null,
  },
  lagombi: {   // exchange
    floor: 'Low',
    Low:  { helm: [{ k: 'reach', lvl: 1 }], chest: [{ k: 'siteGather', lvl: 1 }], waist: [{ k: 'reach', lvl: 1 }] },
    High: { helm: [{ k: 'reach', lvl: 2 }, { k: 'stamina', lvl: 1 }], chest: [{ k: 'siteGather', lvl: 2 }, { k: 'stamina', lvl: 1 }], waist: [{ k: 'reach', lvl: 2 }, { k: 'cold', lvl: 1 }] },
    G:    { helm: [{ k: 'reach', lvl: 2 }, { k: 'stamina', lvl: 1 }, { k: 'duration', lvl: 1 }], chest: [{ k: 'siteGather', lvl: 2 }, { k: 'stamina', lvl: 1 }, { k: 'duration', lvl: 1 }], waist: [{ k: 'reach', lvl: 2 }, { k: 'cold', lvl: 1 }, { k: 'duration', lvl: 1 }] },
    setBonus: null,
  },
  lao_shan_lung: {   // exchange
    floor: 'G',
    G:    { helm: [], chest: [], waist: [] },
    setBonus: null,
  },
  malfestio: {   // exchange
    floor: 'High',
    High: { helm: [{ k: 'parts', lvl: 1 }, { k: 'lure', lvl: 1 }, { k: 'reach', lvl: 1 }], chest: [{ k: 'parts', lvl: 1 }, { k: 'lure', lvl: 1 }, { k: 'reach', lvl: 1 }], waist: [{ k: 'parts', lvl: 1 }, { k: 'lure', lvl: 1 }, { k: 'reach', lvl: 1 }] },
    G:    { helm: [{ k: 'parts', lvl: 2 }, { k: 'lure', lvl: 1 }, { k: 'reach', lvl: 2 }], chest: [{ k: 'parts', lvl: 2 }, { k: 'lure', lvl: 2 }, { k: 'reach', lvl: 2 }], waist: [{ k: 'parts', lvl: 1 }, { k: 'lure', lvl: 2 }, { k: 'reach', lvl: 1 }] },
    setBonus: null,
  },
  najarala: {   // exchange
    floor: 'Low',
    Low:  { helm: [{ k: 'band', lvl: 1 }], chest: [{ k: 'trapping', lvl: 1 }], waist: [{ k: 'trapping', lvl: 1 }] },
    High: { helm: [{ k: 'band', lvl: 2 }, { k: 'bobber', lvl: 1 }], chest: [{ k: 'trapping', lvl: 2 }, { k: 'reach', lvl: 1 }], waist: [{ k: 'trapping', lvl: 2 }, { k: 'escape', lvl: 1 }] },
    G:    { helm: [{ k: 'band', lvl: 2 }, { k: 'bobber', lvl: 1 }], chest: [{ k: 'trapping', lvl: 2 }, { k: 'reach', lvl: 1 }], waist: [{ k: 'trapping', lvl: 2 }, { k: 'escape', lvl: 1 }] },
    setBonus: null,
  },
  nakarkos: {   // exchange
    floor: 'G',
    G:    { helm: [{ k: 'band', lvl: 1 }, { k: 'progress', lvl: 1 }, { k: 'escape', lvl: 1 }, { k: 'control', lvl: 1 }, { k: 'bites', lvl: 1 }, { k: 'reach', lvl: 1 }], chest: [{ k: 'band', lvl: 1 }, { k: 'progress', lvl: 1 }, { k: 'escape', lvl: 1 }, { k: 'control', lvl: 1 }, { k: 'strike', lvl: 1 }, { k: 'hook', lvl: 1 }], waist: [{ k: 'band', lvl: 1 }, { k: 'progress', lvl: 1 }, { k: 'escape', lvl: 1 }, { k: 'control', lvl: 1 }, { k: 'bites', lvl: 1 }, { k: 'reach', lvl: 1 }] },
    setBonus: null,
  },
  nargacuga: {   // exchange
    floor: 'High',
    High: { helm: [{ k: 'band', lvl: 1 }, { k: 'hook', lvl: 2 }], chest: [{ k: 'escape', lvl: 2 }, { k: 'reach', lvl: 1 }], waist: [{ k: 'control', lvl: 2 }, { k: 'strike', lvl: 1 }] },
    G:    { helm: [{ k: 'band', lvl: 1 }, { k: 'hook', lvl: 2 }, { k: 'lure', lvl: 1 }], chest: [{ k: 'escape', lvl: 2 }, { k: 'reach', lvl: 1 }, { k: 'lure', lvl: 1 }], waist: [{ k: 'control', lvl: 2 }, { k: 'strike', lvl: 1 }, { k: 'lure', lvl: 1 }] },
    setBonus: null,
  },
  nerscylla: {   // exchange
    floor: 'High',
    High: { helm: [{ k: 'blast', lvl: 2 }, { k: 'trapping', lvl: 1 }], chest: [{ k: 'bruising', lvl: 2 }, { k: 'blast', lvl: 1 }], waist: [{ k: 'trapping', lvl: 3 }, { k: 'trapsize', lvl: 1 }] },
    G:    { helm: [{ k: 'blast', lvl: 2 }, { k: 'trapping', lvl: 2 }, { k: 'reach', lvl: 1 }], chest: [{ k: 'bruising', lvl: 2 }, { k: 'blast', lvl: 2 }, { k: 'reach', lvl: 2 }], waist: [{ k: 'trapping', lvl: 3 }, { k: 'trapsize', lvl: 1 }, { k: 'reach', lvl: 2 }] },
    setBonus: null,
  },
  old_fatalis: {   // exchange
    floor: 'G',
    G:    { helm: [], chest: [], waist: [] },
    setBonus: null,
  },
  rajang: {   // exchange
    floor: 'High',
    High: { helm: [{ k: 'parts', lvl: 1 }, { k: 'band', lvl: 1 }, { k: 'duration', lvl: 1 }], chest: [{ k: 'parts', lvl: 1 }, { k: 'band', lvl: 1 }, { k: 'duration', lvl: 1 }], waist: [{ k: 'parts', lvl: 1 }, { k: 'band', lvl: 1 }, { k: 'duration', lvl: 1 }] },
    G:    { helm: [{ k: 'parts', lvl: 2 }, { k: 'band', lvl: 2 }, { k: 'duration', lvl: 1 }], chest: [{ k: 'parts', lvl: 2 }, { k: 'band', lvl: 2 }, { k: 'duration', lvl: 2 }], waist: [{ k: 'parts', lvl: 1 }, { k: 'band', lvl: 1 }, { k: 'duration', lvl: 2 }] },
    setBonus: null,
  },
  rathalos: {   // exchange
    floor: 'High',
    High: { helm: [{ k: 'blast', lvl: 1 }, { k: 'zenny', lvl: 1 }, { k: 'bounty', lvl: 1 }], chest: [{ k: 'blast', lvl: 1 }, { k: 'zenny', lvl: 1 }, { k: 'bounty', lvl: 1 }], waist: [{ k: 'blast', lvl: 1 }, { k: 'zenny', lvl: 1 }, { k: 'bounty', lvl: 1 }] },
    G:    { helm: [{ k: 'blast', lvl: 2 }, { k: 'zenny', lvl: 2 }, { k: 'bounty', lvl: 1 }], chest: [{ k: 'blast', lvl: 1 }, { k: 'zenny', lvl: 2 }, { k: 'bounty', lvl: 2 }], waist: [{ k: 'blast', lvl: 2 }, { k: 'zenny', lvl: 1 }, { k: 'bounty', lvl: 2 }] },
    setBonus: null,
  },
  rathian: {   // exchange
    floor: 'Low',
    Low:  { helm: [{ k: 'blast', lvl: 1 }], chest: [{ k: 'lesson', lvl: 1 }], waist: [{ k: 'blast', lvl: 1 }] },
    High: { helm: [{ k: 'blast', lvl: 2 }, { k: 'hook', lvl: 1 }], chest: [{ k: 'lesson', lvl: 2 }, { k: 'bites', lvl: 1 }], waist: [{ k: 'blast', lvl: 2 }, { k: 'band', lvl: 1 }] },
    G:    { helm: [{ k: 'blast', lvl: 2 }, { k: 'hook', lvl: 1 }, { k: 'escape', lvl: 1 }], chest: [{ k: 'lesson', lvl: 2 }, { k: 'bites', lvl: 1 }, { k: 'escape', lvl: 1 }], waist: [{ k: 'blast', lvl: 2 }, { k: 'band', lvl: 1 }, { k: 'escape', lvl: 1 }] },
    setBonus: null,
  },
  seltas: {   // exchange
    floor: 'Low',
    Low:  { helm: [{ k: 'carry', lvl: 1 }], chest: [{ k: 'carry', lvl: 1 }], waist: [{ k: 'lure', lvl: 1 }] },
    High: { helm: [{ k: 'carry', lvl: 2 }, { k: 'escape', lvl: 1 }], chest: [{ k: 'carry', lvl: 2 }, { k: 'band', lvl: 1 }], waist: [{ k: 'lure', lvl: 1 }, { k: 'escape', lvl: 1 }, { k: 'bites', lvl: 1 }] },
    G:    { helm: [{ k: 'carry', lvl: 2 }, { k: 'escape', lvl: 1 }, { k: 'fresh', lvl: 1 }], chest: [{ k: 'carry', lvl: 2 }, { k: 'band', lvl: 1 }, { k: 'fresh', lvl: 1 }], waist: [{ k: 'lure', lvl: 1 }, { k: 'escape', lvl: 1 }, { k: 'bites', lvl: 1 }, { k: 'fresh', lvl: 1 }] },
    setBonus: null,
  },
  seltas_queen: {   // exchange
    floor: 'High',
    High: { helm: [{ k: 'siteBug', lvl: 1 }, { k: 'siteGather', lvl: 1 }, { k: 'gather', lvl: 1 }], chest: [{ k: 'siteBug', lvl: 1 }, { k: 'siteGather', lvl: 1 }, { k: 'gather', lvl: 1 }], waist: [{ k: 'siteBug', lvl: 1 }, { k: 'siteGather', lvl: 1 }, { k: 'gather', lvl: 1 }] },
    G:    { helm: [{ k: 'siteBug', lvl: 3 }, { k: 'siteGather', lvl: 1 }, { k: 'gather', lvl: 1 }], chest: [{ k: 'siteBug', lvl: 1 }, { k: 'siteGather', lvl: 3 }, { k: 'gather', lvl: 1 }], waist: [{ k: 'siteBug', lvl: 1 }, { k: 'siteGather', lvl: 1 }, { k: 'gather', lvl: 3 }] },
    setBonus: null,
  },
  seregios: {   // exchange
    floor: 'High',
    High: { helm: [{ k: 'stamina', lvl: 1 }, { k: 'heat', lvl: 1 }, { k: 'bounty', lvl: 1 }], chest: [{ k: 'stamina', lvl: 1 }, { k: 'zenny', lvl: 2 }], waist: [{ k: 'stamina', lvl: 1 }, { k: 'heat', lvl: 1 }, { k: 'trade', lvl: 1 }] },
    G:    { helm: [{ k: 'stamina', lvl: 1 }, { k: 'heat', lvl: 2 }, { k: 'bounty', lvl: 2 }], chest: [{ k: 'stamina', lvl: 1 }, { k: 'zenny', lvl: 2 }, { k: 'strike', lvl: 2 }], waist: [{ k: 'stamina', lvl: 2 }, { k: 'heat', lvl: 2 }, { k: 'trade', lvl: 2 }] },
    setBonus: null,
  },
  shagaru_magala: {   // exchange
    floor: 'G',
    G:    { helm: [], chest: [], waist: [] },
    setBonus: null,
  },
  silver_rathalos: {   // exchange
    floor: 'G',
    G:    { helm: [], chest: [], waist: [] },
    setBonus: null,
  },
  teostra: {   // exchange
    floor: 'G',
    G:    { helm: [], chest: [], waist: [] },
    setBonus: null,
  },
  tetsucabra: {   // exchange
    floor: 'Low',
    Low:  { helm: [{ k: 'siteMine', lvl: 1 }], chest: [{ k: 'progress', lvl: 1 }], waist: [{ k: 'siteMine', lvl: 1 }] },
    High: { helm: [{ k: 'siteMine', lvl: 2 }, { k: 'stamina', lvl: 1 }], chest: [{ k: 'progress', lvl: 2 }, { k: 'stamina', lvl: 1 }], waist: [{ k: 'siteMine', lvl: 1 }, { k: 'cold', lvl: 2 }] },
    G:    { helm: [{ k: 'siteMine', lvl: 2 }, { k: 'stamina', lvl: 1 }, { k: 'bounty', lvl: 1 }], chest: [{ k: 'progress', lvl: 2 }, { k: 'stamina', lvl: 1 }, { k: 'bounty', lvl: 1 }], waist: [{ k: 'siteMine', lvl: 1 }, { k: 'cold', lvl: 2 }, { k: 'bounty', lvl: 1 }] },
    setBonus: null,
  },
  tigrex: {   // exchange
    floor: 'High',
    High: { helm: [{ k: 'vigor', lvl: 2 }, { k: 'band', lvl: 1 }], chest: [{ k: 'vigor', lvl: 2 }, { k: 'band', lvl: 1 }], waist: [{ k: 'vigor', lvl: 1 }, { k: 'band', lvl: 1 }] },
    G:    { helm: [{ k: 'vigor', lvl: 2 }, { k: 'band', lvl: 2 }, { k: 'progress', lvl: 1 }], chest: [{ k: 'vigor', lvl: 2 }, { k: 'band', lvl: 1 }, { k: 'progress', lvl: 2 }], waist: [{ k: 'vigor', lvl: 1 }, { k: 'band', lvl: 2 }, { k: 'progress', lvl: 2 }] },
    setBonus: null,
  },
  ukanlos: {   // exchange
    floor: 'G',
    G:    { helm: [{ k: 'bounty', lvl: 1 }, { k: 'zenny', lvl: 1 }, { k: 'haggle', lvl: 1 }, { k: 'effectup', lvl: 1 }], chest: [{ k: 'bounty', lvl: 1 }, { k: 'zenny', lvl: 1 }, { k: 'haggle', lvl: 1 }, { k: 'effectup', lvl: 1 }], waist: [{ k: 'bounty', lvl: 1 }, { k: 'zenny', lvl: 1 }, { k: 'haggle', lvl: 1 }, { k: 'effectup', lvl: 1 }] },
    setBonus: null,
  },
  uragaan: {   // exchange
    floor: 'High',
    High: { helm: [{ k: 'siteMine', lvl: 2 }, { k: 'siteGather', lvl: 1 }], chest: [{ k: 'siteMine', lvl: 1 }, { k: 'siteGather', lvl: 2 }], waist: [{ k: 'siteGather', lvl: 1 }, { k: 'heat', lvl: 2 }] },
    G:    { helm: [{ k: 'siteMine', lvl: 2 }, { k: 'siteGather', lvl: 1 }, { k: 'heat', lvl: 1 }, { k: 'gather', lvl: 1 }], chest: [{ k: 'siteMine', lvl: 2 }, { k: 'siteGather', lvl: 2 }, { k: 'heat', lvl: 1 }, { k: 'gather', lvl: 1 }], waist: [{ k: 'siteGather', lvl: 1 }, { k: 'heat', lvl: 2 }, { k: 'siteMine', lvl: 1 }] },
    setBonus: null,
  },
  valstrax: {   // exchange
    floor: 'G',
    G:    { helm: [], chest: [], waist: [] },
    setBonus: null,
  },
  velocidrome: {   // exchange
    floor: 'Low',
    Low:  { helm: [{ k: 'basket', lvl: 1 }], chest: [{ k: 'strike', lvl: 1 }], waist: [{ k: 'band', lvl: 1 }] },
    High: { helm: [{ k: 'basket', lvl: 2 }, { k: 'repel', lvl: 1 }], chest: [{ k: 'strike', lvl: 2 }, { k: 'zenny', lvl: 1 }], waist: [{ k: 'band', lvl: 2 }, { k: 'repel', lvl: 1 }] },
    G:    { helm: [{ k: 'basket', lvl: 2 }, { k: 'repel', lvl: 2 }, { k: 'stamina', lvl: 1 }], chest: [{ k: 'strike', lvl: 2 }, { k: 'zenny', lvl: 2 }, { k: 'stamina', lvl: 1 }], waist: [{ k: 'band', lvl: 2 }, { k: 'repel', lvl: 2 }, { k: 'stamina', lvl: 1 }] },
    setBonus: null,
  },
  volvidon: {   // exchange
    floor: 'Low',
    Low:  { helm: [{ k: 'haggle', lvl: 1 }], chest: [{ k: 'siteBug', lvl: 1 }], waist: [{ k: 'siteBug', lvl: 1 }] },
    High: { helm: [{ k: 'haggle', lvl: 1 }, { k: 'trade', lvl: 1 }, { k: 'combo', lvl: 1 }], chest: [{ k: 'siteBug', lvl: 2 }, { k: 'trade', lvl: 1 }], waist: [{ k: 'siteBug', lvl: 2 }, { k: 'siteMine', lvl: 1 }] },
    G:    { helm: [{ k: 'haggle', lvl: 1 }, { k: 'trade', lvl: 1 }, { k: 'combo', lvl: 2 }], chest: [{ k: 'siteBug', lvl: 2 }, { k: 'trade', lvl: 1 }, { k: 'trapsize', lvl: 2 }], waist: [{ k: 'siteBug', lvl: 2 }, { k: 'siteMine', lvl: 2 }, { k: 'parts', lvl: 1 }] },
    setBonus: null,
  },
  yian_garuga: {   // exchange
    floor: 'High',
    High: { helm: [{ k: 'band', lvl: 1 }, { k: 'progress', lvl: 1 }, { k: 'escape', lvl: 1 }], chest: [{ k: 'band', lvl: 1 }, { k: 'progress', lvl: 1 }, { k: 'escape', lvl: 1 }], waist: [{ k: 'band', lvl: 1 }, { k: 'progress', lvl: 1 }, { k: 'escape', lvl: 1 }] },
    G:    { helm: [{ k: 'band', lvl: 2 }, { k: 'progress', lvl: 2 }, { k: 'escape', lvl: 1 }], chest: [{ k: 'band', lvl: 2 }, { k: 'progress', lvl: 1 }, { k: 'escape', lvl: 2 }], waist: [{ k: 'band', lvl: 1 }, { k: 'progress', lvl: 2 }, { k: 'escape', lvl: 2 }] },
    setBonus: null,
  },
  yian_kut_ku: {   // exchange
    floor: 'Low',
    Low:  { helm: [{ k: 'control', lvl: 1 }], chest: [{ k: 'control', lvl: 1 }], waist: [{ k: 'hire', lvl: 1 }] },
    High: { helm: [{ k: 'control', lvl: 2 }, { k: 'hook', lvl: 1 }], chest: [{ k: 'control', lvl: 2 }, { k: 'parts', lvl: 1 }], waist: [{ k: 'hire', lvl: 2 }, { k: 'hook', lvl: 1 }] },
    G:    { helm: [{ k: 'control', lvl: 2 }, { k: 'hook', lvl: 1 }], chest: [{ k: 'control', lvl: 2 }, { k: 'parts', lvl: 1 }], waist: [{ k: 'hire', lvl: 2 }, { k: 'hook', lvl: 1 }] },
    setBonus: null,
  },
  zinogre: {   // exchange
    floor: 'High',
    High: { helm: [{ k: 'duration', lvl: 1 }, { k: 'escape', lvl: 1 }, { k: 'strike', lvl: 1 }], chest: [{ k: 'duration', lvl: 1 }, { k: 'escape', lvl: 1 }, { k: 'strike', lvl: 1 }], waist: [{ k: 'duration', lvl: 2 }, { k: 'strike', lvl: 1 }] },
    G:    { helm: [{ k: 'duration', lvl: 2 }, { k: 'escape', lvl: 1 }, { k: 'strike', lvl: 2 }, { k: 'bounty', lvl: 1 }], chest: [{ k: 'duration', lvl: 1 }, { k: 'escape', lvl: 2 }, { k: 'strike', lvl: 1 }, { k: 'zenny', lvl: 1 }], waist: [{ k: 'duration', lvl: 2 }, { k: 'strike', lvl: 2 }, { k: 'effectup', lvl: 1 }, { k: 'trade', lvl: 1 }] },
    setBonus: null,
  },
};
  // <<< ARMOR_PIECES END

  // Names come from mhgu.db, not from splitting an id: "yian_kut_ku" has to read
  // Yian Kut-Ku, and no amount of underscore-splitting produces that hyphen.
  const armorLineName = line => (window.MF_ARMOR_LINE_NAMES || {})[line] || line;

  // A rank is armor only if something is assigned to it. An entry whose three
  // pieces are all empty arrays is a placeholder waiting for Raven, not a set.
  const hasArmorAt = (line, rank) => {
    const at = (ARMOR_PIECES[line] || {})[rank];
    return !!at && PIECE_SLOTS.some(slot => (at[slot] || []).length > 0);
  };

  // The other fifty-nine lines, filled in from the real drop tables. The twelve
  // above are hand-set and WIN: those names are Raven's, one of them (Zamtrios
  // Scale) deliberately does not exist in the game, and regenerating over them
  // would quietly take that back.
  //
  // A generated line carries a rarity per tier because the marketplace trades on
  // rarity and nothing else. The hand-set twelve get theirs from the same ladder
  // the data uses throughout: r4 Low, r6 High, r8 G.
  const RANK_RARITY = { Low: 4, High: 6, G: 8 };
  (() => {
    const gen = window.MF_MONSTER_PARTS || {};
    for (const [line, tiers] of Object.entries(gen)) {
      const L = MAT_LINES[line];
      if (L) {                       // hand-set: keep the names, take the rarities
        L.rarity = L.rarity || {};
        for (const rank of ['Low', 'High', 'G'])
          if (L[rank]) L.rarity[rank] = (tiers[rank] || {}).rarity || RANK_RARITY[rank];
        continue;
      }
      // The raw map, not armorLineName: that helper is declared with the armor
      // board further down and is still in its dead zone here.
      const made = { name: (window.MF_ARMOR_LINE_NAMES || {})[line] || line,
                     Low: null, High: null, G: null,
                     icon: (tiers.G || tiers.High || tiers.Low || {}).icon
                        || 'MH4G-Scale_Icon_Grey.png', rarity: {}, icons: {} };
      for (const rank of ['Low', 'High', 'G']) {
        // Only tiers that are actually ARMOR. A line whose armor starts at G has
        // no use for a Low part, and fifteen lines — the elders and the Fatalis
        // family — are on the board with every piece still empty. Both would put
        // a part in the marketplace that buys nothing.
        if (!tiers[rank] || !hasArmorAt(line, rank)) continue;
        made[rank] = tiers[rank].name;
        made.rarity[rank] = tiers[rank].rarity;
        made.icons[rank] = tiers[rank].icon;
      }
      if (made.Low || made.High || made.G) MAT_LINES[line] = made;
    }
  })();

  const bossMat = (line, rank) => {
    const L = MAT_LINES[line];
    const nm = L && L[rank];
    if (!nm) return null;
    return { id: matId(line, rank), name: nm,
             icon: (L.icons && L.icons[rank]) || L.icon, line, rank,
             rarity: (L.rarity && L.rarity[rank]) || RANK_RARITY[rank] };
  };
  const MONSTER_MATS = (() => {
    const out = [];
    for (const [line, L] of Object.entries(MAT_LINES))
      for (const rank of ['Low', 'High', 'G'])
        if (L[rank]) out.push(bossMat(line, rank));
    return out;
  })();
  const monsterMatById = new Map(MONSTER_MATS.map(m => [m.id, m]));

  // The suffix follows the RANK, exactly as MHGU's own armor does: base at Low,
  // S at High, X at G.
  //
  // It used to be POSITIONAL — first of the line plain, last of the line X — on
  // the reasoning that S is the middle and a two-suit line has no middle. That
  // held while there were eight lines with two or three tiers each. It does not
  // hold now: a line with a single tier got `armorSuffix(0, 1)` and came out X
  // whatever rank it actually was, so twenty-three lines had a Low or High piece
  // called X, wearing the skills of the rank it really is. Raven caught it on
  // Bulldrome. Thirty pieces in total disagreed with their own name.
  const RANK_SUFFIX = { Low: '', High: ' S', G: ' X' };
  const armorSuffix = rank => RANK_SUFFIX[rank] || '';
  // What a suit is worth defensively, before its levels. HP and stamina replace
  // Vitality and Endurance outright, so a G suit at full level lands near where
  // twenty levels of each used to.
  // Stats come off the armor's own RARITY, not its rank. Bulldrome and Nakarkos
  // are both G Rank sets and should not be worth the same, and rarity is the axis
  // the game itself uses to say so — Bulldrome X is rarity 8, Tigrex X rarity 9.
  //
  // Real rarities come from mhgu.db's armor_families. Nineteen lines cannot be
  // matched to a family, because armor names agree with neither the monster nor
  // its parts — Royal Ludroth drops "R.Ludroth" parts and wears "Ludroth" armor —
  // so those fall back to what is typical for the rank.
  const ARMOR_RARITY_DEFAULT = { Low: 3, High: 6, G: 8 };
  // Nakarkos has no family in the data at all. Raven: "his armor is Rare 10".
  const ARMOR_RARITY_OVERRIDE = { nakarkos: { G: 10 } };
  const armorRarity = (line, rank) =>
    (ARMOR_RARITY_OVERRIDE[line] || {})[rank]
    || (((window.MF_ARMOR_STATS || {})[line] || {})[rank] || {}).rarity
    || ARMOR_RARITY_DEFAULT[rank] || 4;

  // Linear in rarity, and deliberately calibrated so the ranks land where they
  // already did: a typical Low set is rarity 2, a High 5, a G 9, and those come
  // out at the 5/3, 13/9, 23/15 the flat table used to hand out. Nothing about
  // the balance moves; what moves is that a dearer set is now worth more than a
  // cheap one of the same rank.
  const ARMOR_PIECE_BASE = rarity => ({
    hp: Math.round(2.57 * rarity - 0.14),
    stamina: Math.round(1.71 * rarity - 0.43),
    guard: +(0.0056 + 0.0057 * rarity).toFixed(4),
  });
  const ARMOR_PER_LEVEL = { hp: 1.33, stamina: 1, guard: 0.0027 };
  // Levels are money only, and locked behind HR so a suit cannot be pushed far
  // ahead of the rank it belongs to. Same shape as the Books of Fishing Combos.
  const ARMOR_LEVELS = 5;
  const GEAR_LEVEL_HR = { Low: [1, 2, 2, 3, 3], High: [4, 5, 6, 6, 7], G: [9, 10, 11, 12, 12] };

  // ARMORS itself is built further down, once BOSS exists — a tier depends on
  // whether its monster can actually be met at that rank, and that cannot be
  // known up here.

  // ── Rods ──────────────────────────────────────────────────────────────────
  //
  // A straight ladder, one per rank, with money-only levels between. The levels
  // are the "range of ability" inside a rank; the tiers are the jumps between
  // them. Forged from the rank's own monster parts, from whichever line you have
  // been hunting — any line's part of the right rank will do, so the rod never
  // forces you onto a monster you dislike.
  const RODS = [
    // The one you start holding. No cost and no parts: it is where everybody
    // begins, so it is never something to be forged.
    { id: 'rod_old',    rank: 'Low',  name: 'Old Angler Rod',    cost: 0, starter: true,
      desc: "It's not much, but it will catch a few fish",
      sink: 0.05, band: 0.02, lift: 0.000, bites: 0.00, school: 0,
      levelCost: n => Math.round(500 * Math.pow(1.45, n)),
      matCount: 0, icon: 'assets/BaitIcons/MH4G-Bait_Icon_Grey.png' },
    { id: 'rod_angler', rank: 'Low',  name: 'Angler Rod',        cost: 3200,
      desc: 'This is the standard rod for anglers',
      sink: 0.12, band: 0.06, lift: 0.002, bites: 0.02, school: 0,
      levelCost: n => Math.round(1100 * Math.pow(1.45, n)),
      matCount: 2, icon: 'assets/BaitIcons/MH4G-Bait_Icon_White.png' },
    { id: 'rod_mega',   rank: 'High', name: 'Mega Angler Rod',   cost: 12000,
      desc: 'A fine fishing rod, made with an eye for quality',
      sink: 0.22, band: 0.12, lift: 0.006, bites: 0.05, school: 1,
      levelCost: n => Math.round(4200 * Math.pow(1.45, n)),
      matCount: 3, icon: 'assets/BaitIcons/MH4G-Bait_Icon_Yellow.png' },
    { id: 'rod_master', rank: 'G',    name: 'Master Angler Rod', cost: 44000,
      desc: 'The pinnacle in fishing rods. Some say it even rivals Hunter weapons.',
      sink: 0.36, band: 0.20, lift: 0.014, bites: 0.10, school: 2,
      levelCost: n => Math.round(14000 * Math.pow(1.45, n)),
      matCount: 3, icon: 'assets/BaitIcons/MH4G-Bait_Icon_Red.png' },
  ];
  // equip() reads the slot off the piece now that there are four of them, so a
  // rod has to say it is a rod. Stamped here rather than on each entry: it is
  // true of every rod and always will be.
  for (const r of RODS) r.slot = 'rod';
  const rodById = new Map(RODS.map(r => [r.id, r]));
  const ROD_PER_LEVEL = { sink: 0.022, band: 0.018, lift: 0.0018, bites: 0.012 };
  const ROD_LEVELS = 5;

  // A rod as it currently stands: its tier plus however many levels are on it.
  // `rod` everywhere below is {id, lvl}; a missing rod is bare hands, which is
  // deliberately playable at Low Rank and nowhere else.
  const rodStat = (rod, key) => {
    const r = rod && rodById.get(rod.id);
    if (!r) return 0;
    return r[key] + (ROD_PER_LEVEL[key] || 0) * (rod.lvl || 0);
  };
  const rodSink  = rod => Math.min(0.62, rodStat(rod, 'sink'));
  const rodBand  = rod => rodStat(rod, 'band');
  const rodLift  = rod => rodStat(rod, 'lift');
  const rodBites = rod => rodStat(rod, 'bites');
  const rodSchool = rod => {
    const r = rod && rodById.get(rod.id);
    return r ? r.school + Math.floor((rod.lvl || 0) / 3) : 0;
  };

  // What the armor you are wearing actually grants, as {effectKey: level}.
  // THE merge point. Everything downstream — effectPower, effectLevel,
  // climateFor, heatBand, culledOres — reads only this, which is why three
  // pieces became one total here and nowhere else.
  //
  // Takes the worn SET, `{helm, chest, waist}`, each a `{id, lvl}` or null. It
  // is handed the whole `gear` object at every call site, extra keys and all,
  // so the ~30 consumers kept their signatures through the rework.
  //
  // Levels SUM and clamp. Summing is what makes mixing a real decision: two
  // pieces carrying Lv 2 of one skill beat one carrying Lv 3.
  const wornPieces = gear => PIECE_SLOTS
    .map(slot => gear && gear[slot] && armorById.get(gear[slot].id))
    .filter(Boolean);

  // The bonus for not mixing. Three pieces of ONE line at ANY ranks — a Low helm
  // beside a G waist still counts, which is what keeps an old favourite worth
  // finishing rather than abandoning at the rank you outgrew it.
  const wornSetLine = gear => {
    const worn = wornPieces(gear);
    return worn.length === PIECE_SLOTS.length
      && worn.every(p => p.line === worn[0].line) ? worn[0].line : null;
  };

  function armorEffects(gear) {
    // A synthetic set: `{ __levels: { band: 3 } }` behaves as armor granting
    // exactly those levels. The benches and the skill sheet need to ask "what
    // does Lv 3 of this do" without hunting for a piece that happens to carry
    // it, and EVERY consumer reaches skills through this one function — so one
    // branch here reaches all of them and none of them needs a test mode.
    if (gear && gear.__levels) {
      const fake = {};
      for (const [k, v] of Object.entries(gear.__levels))
        fake[k] = Math.min(EFFECT_MAX, Math.max(0, v));
      return fake;
    }
    const out = {};
    for (const p of wornPieces(gear))
      for (const e of p.effects) out[e.key] = (out[e.key] || 0) + e.lvl;
    const line = wornSetLine(gear);
    const bonus = line && ARMOR_PIECES[line] && ARMOR_PIECES[line].setBonus;
    if (bonus) out[bonus.k] = (out[bonus.k] || 0) + bonus.lvl;
    for (const k of Object.keys(out)) out[k] = Math.min(EFFECT_MAX, out[k]);
    return out;
  }
  // Effect strength, already multiplied out. Flags come back as 0 or 1.
  function effectPower(armor, key) {
    const lvl = armorEffects(armor)[key] || 0;
    if (!lvl) return 0;
    const e = EFFECTS[key];
    return e.flag ? 1 : (e.per || 0) * lvl;
  }
  // How many levels of an effect a suit carries, 0 if none. Climate wants this
  // rather than effectPower: 1 and 2 lengthen a drink, 3 removes the need for one.
  const effectLevel = (armor, key) => armorEffects(armor)[key] || 0;

  // What one drink is worth while wearing this, and whether the climate can touch
  // you at all. Level 3 is Heat Cancel / Cold Cancel: no drink needed, ever.
  const climateFor = (armor, climate) => {
    let lvl = 0;
    for (const [key, e] of Object.entries(EFFECTS))
      if (e.climate === climate) lvl = Math.max(lvl, effectLevel(armor, key));
    // One constant, and the whole heat/cold economy turns on it. At EFFECT_MAX
    // only a set built for the climate is immune; at 3 any two committed pieces
    // would be, and levels 4 and 5 would buy nothing at all.
    const CANCEL_AT = EFFECT_MAX;
    // 25% a level, not 50%: with a cap of five, half again per level ran a drink
    // to 3.5x before immunity ever arrived, and the last rungs stopped mattering
    // because the ones below had already solved the climate.
    return { lvl, immune: lvl >= CANCEL_AT,
             drinkMult: lvl >= CANCEL_AT ? 1 : 1 + 0.25 * lvl };
  };

  // Tropic Hunter's half that is not resistance. Standing in the heat widens the
  // line by what Sure Grip of the same level would give; a Hot Drink while you are
  // there doubles it. A Hot Drink anywhere else is worth the single step, which is
  // what makes carrying the wrong drink deliberately a real choice.
  function heatBand(armor, ctx) {
    if (!ctx) return 0;
    const lvl = effectLevel(armor, 'hotblood');
    if (!lvl) return 0;
    const hot = ctx.climate === 'hot';
    const drink = !!ctx.hotDrink;
    const steps = hot && drink ? 2 : (hot || drink ? 1 : 0);
    return EFFECTS.band.per * lvl * steps;
  }

  // Which varieties Shock Bobber drives off. It clears every rank BELOW the one
  // it reaches, then the lower half of that rank — so each rung takes a whole
  // band out of the water rather than one more item. Never the whole pool: at
  // least two varieties always stay, or a Low Rank angler wearing it would find
  // nothing biting at all.
  const CULL_KEEP = 2;
  function culledOres(armor, ores) {
    const lvl = effectLevel(armor, 'cull');
    if (!lvl || ores.length <= CULL_KEEP) return ores;
    const reach = EFFECTS.cull.band[Math.min(EFFECTS.cull.band.length - 1, lvl - 1)];
    const inBand = ores.filter(o => o.rank === reach)
      .sort((a, b) => a.sell - b.sell);
    const gone = new Set([
      ...ores.filter(o => o.rank < reach).map(o => o.id),          // everything beneath it
      ...inBand.slice(0, Math.floor(inBand.length / 2)).map(o => o.id),  // its lower half
    ]);
    const kept = ores.filter(o => !gone.has(o.id));
    if (kept.length >= CULL_KEEP) return kept;
    // Too few left to fish: keep the best CULL_KEEP instead of emptying the water.
    return [...ores].sort((a, b) => b.rank - a.rank || b.sell - a.sell).slice(0, CULL_KEEP);
  }


  // The second merge, and deliberately NOT routed through armorEffects — hp,
  // stamina and guard are properties of the metal, not skills, and each piece
  // levels separately. Rounds once at the end so three pieces do not each lose
  // a fraction.
  const armorStat = (gear, key) => {
    let n = 0;
    for (const slot of PIECE_SLOTS) {
      const w = gear && gear[slot];
      const a = w && armorById.get(w.id);
      if (a) n += a[key] + (ARMOR_PER_LEVEL[key] || 0) * (w.lvl || 0);
    }
    // Vitality is the one skill that moves a STAT rather than a mechanic, so it
    // belongs here rather than at a consumer — every reader of hp and stamina then
    // gets it for free. Guard is left alone: taking less damage is Defense Up's
    // job, and stacking both onto one number would count it twice.
    if (key === 'hp' || key === 'stamina') n *= 1 + effectPower(gear, 'vigor');
    return key === 'guard' ? n : Math.round(n);
  };

  // ── Money by rank ─────────────────────────────────────────────────────────
  //
  // Value rides on the LOCALE's rank, not the fish's. A rank resets the lineup
  // back to easy prey, so the cheap variants you meet again on a G rung have to
  // still be worth pulling out — otherwise half of every G Rank trip is a wasted
  // cast. The step is the rank; the drift inside it is the rungs.
  const RANK_PAY = { Low: 1, High: 1.35, G: 1.8 };
  const RANK_PAY_PER_RUNG = 0.04;
  function payMult(hr) {
    const rank = curveRank(hr);
    return (RANK_PAY[rank] || 1) + RANK_PAY_PER_RUNG * Math.max(0, (hr || 1) - RANK_HR[rank]);
  }

  // The dearest thing swimming at each rank, read off the real data rather than
  // typed here, so everything pinned to it stays true when the tables change.
  const RANK_PEAK = (() => {
    const out = {};
    for (const rank of ['Low', 'High', 'G']) {
      const hr = RANK_HR[rank];
      const ores = ORES.list.filter(o => oreUnlockHR(o) <= hr);
      let top = 0;
      for (const f of FISH.fish) {
        if (fishUnlockHR(f) > hr) continue;
        for (const o of ores) top = Math.max(top, variantValue(f, o));
      }
      out[rank] = top;
    }
    return out;
  })();

  // Bosses pay about three times the dearest fish of their own rank. That is not
  // a new rule — Plesioth's 14,000z against a 4,569z peak and Lavasioth's
  // 26,000z against 8,300z are both almost exactly 3x, so it is the one already
  // in the numbers, read back out and applied to the rest.
  const BOSS_REWARD_MULT = 3;

  // ...and they ask MORE of you than that fish did, which is the whole of the
  // fix. Something paying three times the best catch in the water while demanding
  // less of your hands than that catch did is what made them feel cheap.
  //
  // So it is a MULTIPLE of the rank's hardest fish rather than a number typed
  // here. Typed numbers were exactly the bug the first time: they were set
  // against the old curve, the fish curve then moved, and every boss quietly
  // became easier than the water it swam in. Pinned like this they cannot drift.
  const RANK_TOP_RATE = (() => {
    const out = {};
    for (const rank of ['Low', 'High', 'G']) {
      const hr = rank === 'Low' ? 3 : rank === 'High' ? 8 : 12;
      const ores = ORES.list.filter(o => oreUnlockHR(o) <= RANK_HR[rank]);
      let top = 0;
      for (const f of FISH.fish) {
        if (fishUnlockHR(f) > RANK_HR[rank]) continue;
        for (const o of ores) {
          const t = fightFor(f, o, null, hr, null);
          top = Math.max(top, t.sinkPerSec / t.liftPerPress);
        }
      }
      out[rank] = top;
    }
    return out;
  })();
  const BOSS_RATE_MULT = { lo: 1.04, hi: 1.20 };   // easiest to hardest of a rank

  // How long the fight nominally runs, which is also what it charges in stamina.
  const BOSS_SECONDS = { Low: 18, High: 26, G: 32 };

  // The fish's half of the contest. Fish take ground back at 1.3x what you gain;
  // a monster does far worse, and that bar is the reason they are dangerous
  // rather than merely long.
  const BOSS_ESCAPE_MULT = { Low: 1.5, High: 1.7, G: 1.9 };

  // Each monster's place inside its own rank, 0 easiest to 1 hardest, scaling
  // demand, pay, duration and how hard it fights back together.
  //
  // `floor` is the earliest rank it turns up at. MHGU gives Plesioth, Zamtrios
  // and Lavasioth no plain-tier scale at all — their materials start at `+` —
  // which is the game itself saying they are High Rank animals; Cephalos,
  // R.Ludroth, Nibelsnarf, Agnaktor and Lagiacrus have the full trio.
  //
  // Zamtrios is the one deliberate departure. Arctic Ridge is the only cold
  // locale on the Low ladder and Zamtrios the only cold monster, so holding it
  // to High left that locale unable to hold anything at all — a rung with a
  // guaranteed dead slot. It is Low here, and `Zamtrios Scale` is ours rather
  // than the game's.
  //
  // A monster then RECURS at every rank its locale reaches, harder each time,
  // exactly as a fish picks up richer varieties. That is what closes the forge
  // loop: Ludroth S needs a High Rank Royal Ludroth to drop an R.Ludroth Scale+.
  const BOSS = {
    Cephadrome: {
      name: 'Cephadrome', icon: 'MHGU-Cephadrome_Icon.webp', bait: null,
      floor: 'Low', tier: 0, line: 'cephalos',
      desc: 'The sand shifts, and something long moves under it.',
      note: 'The leaders of Cephalos herds, these individuals are set apart by '
          + 'their larger size and hard, black scales.',
    },
    'Royal Ludroth': {
      name: 'Royal Ludroth', icon: 'MHGU-Royal_Ludroth_Icon.webp', bait: null,
      floor: 'Low', tier: 0.25, line: 'ludroth',
      desc: 'A wet mane breaks the surface beside the bobber.',
      note: 'Royal Ludroth use their sponge-like neck scales to absorb water and '
          + 'keep from drying out on land.',
    },
    // The last thing in the water. tier 1 is the top of the scale — the hardest
    // fight, the best pay and the rarest part in the app.
    //
    // desc and note are deliberately empty: they are Raven's words, and the three
    // monsters added before this one waited for his too.
    Nakarkos: {
      name: 'Nakarkos', icon: 'MHGU-Nakarkos_Body_Icon.webp', bait: null,
      floor: 'G', tier: 1, line: 'nakarkos',
      desc: '',
      note: 'After covering its prey in a repulsive mucus, it has been seen '
          + 'dragging them back to feast in its macabre nest of bones and '
          + "undulating darkness known as Wyvern's End.",
    },
    Nibelsnarf: {
      name: 'Nibelsnarf', icon: 'MHGU-Nibelsnarf_Icon.webp', bait: null,
      floor: 'Low', tier: 0.5, line: 'nibelsnarf',
      desc: 'The sand opens under the bobber and takes it whole.',
      note: 'They burrow beneath the desert and locate prey aurally, then suck '
          + 'both the target and any surrounding sand into their maws.',
    },
    Plesioth: {
      // bait: 'frog' — withheld; nothing raises the odds deliberately right now.
      name: 'Plesioth', icon: 'MHGU-Plesioth_Icon.webp', bait: null,
      floor: 'High', tier: 0.45, line: 'plesioth',
      desc: 'It takes the line and does not let go.',
      note: 'Where wings would be found on other wyverns, it has developed fins '
          + 'specialized for swimming, and, as a result, cannot fly.',
    },
    Zamtrios: {
      name: 'Zamtrios', icon: 'MHGU-Zamtrios_Icon.webp', bait: null,
      floor: 'Low', tier: 0.6, line: 'zamtrios',
      desc: 'The ice cracks from underneath.',
      note: 'Amphibians that strike from frozen waters, using the cold to stun '
          + 'their prey.',
    },
    Agnaktor: {
      name: 'Agnaktor', icon: 'MHGU-Agnaktor_Icon.webp', bait: null,
      floor: 'Low', tier: 0.75, line: 'agnaktor',
      desc: 'Something surfaces glowing, and the rock runs off it.',
      note: 'Also known as fire-pike wyverns, Agnaktor use their tough beaks and '
          + 'great strength to burrow effortlessly through rock, and can even '
          + 'burrow into ceilings.',
    },
    Lagiacrus: {
      name: 'Lagiacrus', icon: 'MHGU-Lagiacrus_Icon.webp', bait: null,
      floor: 'Low', tier: 0.9, line: 'lagiacrus',
      desc: 'The water goes still, then bright.',
      note: 'Feared by sailors as the "Lords of the Seas", Lagiacrus store enough '
          + 'electricity in their spinal organs to make the oceans surge. '
          + 'Occasionally they can be found resting on land as well.',
    },
    Lavasioth: {
      name: 'Lavasioth', icon: 'MHGU-Lavasioth_Icon.webp', bait: null,
      floor: 'High', tier: 1, line: 'lavasioth',
      desc: 'Something moves under the lava, and the line goes tight.',
      note: 'It swims around in lava, sucking in molten rock to spew at its prey. '
          + 'Its peculiar biology makes it a popular research subject.',
    },
    // Aquatic enough to fish for rather than trade for. Floors are the rank each
    // first appears at in MHGU, which is Low for all three.
    //
    // `desc` and `note` are RAVEN'S to write. The eight above carry his wording
    // and the Monster Hunter's Notes verbatim, so these are left empty on
    // purpose rather than filled with mine.
    'Daimyo Hermitaur': {
      // MHGU-Hermitaur_Icon is the SMALL Hermitaur. The two names differ by one
      // word and the files sit next to each other, which is exactly how the wrong
      // one gets picked.
      name: 'Daimyo Hermitaur', icon: 'MHGU-Daimyo_Hermitaur_Icon.webp', bait: null,
      floor: 'Low', tier: 0.15, line: 'hermitaur',
      desc: '',
      note: 'This large Carapaceon wears a massive monster skull on its back, and '
          + 'uses its large pincers and bubble breath to attack prey.',
    },
    'Shogun Ceanataur': {
      name: 'Shogun Ceanataur', icon: 'MHGU-Shogun_Ceanataur_Icon.webp', bait: null,
      floor: 'Low', tier: 0.35, line: 'ceanataur',
      desc: '',
      note: 'Its long, sharp pincers allow it to pierce volcanic bedrock and '
          + 'travel along ceilings.',
    },
    Mizutsune: {
      name: 'Mizutsune', icon: 'MHGU-Mizutsune_Icon.webp', bait: null,
      floor: 'Low', tier: 0.7, line: 'mizutsune',
      desc: '',
      note: 'Mizutsune can secrete a peculiar fluid that covers its foes in '
          + 'immobilizing bubbles.',
    },
  };

  // Below its floor rank a monster is simply not in the water yet.
  const bossAvailable = (name, hr) => {
    const b = BOSS[name];
    return !!b && rankIndex(curveRank(hr)) >= rankIndex(b.floor);
  };

  // Every rank a monster can genuinely be met at: at or above its floor, and
  // somewhere on that rank's rungs it could plausibly turn up.
  //
  // "Plausibly" is CLIMATE, not habitat. This used to read `loc.boss` — does it
  // live on a rung of that rank — which was right before sightings existed and
  // wrong after, because the whole point of a visitor is that it appears away
  // from home. Habitat-only kept Agnaktor out of Low Rank purely because
  // Volcanic Hollow opens at HR5, even though the Dunes are hot and open at HR3
  // and `Agnaktor Scale` had been sat in MAT_LINES the whole time waiting for a
  // tier to belong to.
  // Where a monster could plausibly wander: the climates it genuinely lives in,
  // read off its real home locales rather than typed. Both the rank it can be met
  // at and the visitor roll read this, so the two can never disagree.
  const bossClimates = (() => {
    const LOCALES = window.MF_LOCALES || [];
    const out = {};
    for (const name of Object.keys(BOSS))
      out[name] = new Set(LOCALES
        .filter(l => (l.boss || []).includes(name))
        .map(l => climateOf(l.id)));
    return out;
  })();

  const bossRanks = (() => {
    const out = {};
    for (const name of Object.keys(BOSS)) out[name] = new Set();
    for (const [hr, ids] of Object.entries(LADDER)) {
      const rank = curveRank(+hr);
      for (const id of ids) {
        const climate = climateOf(id);
        for (const name of Object.keys(BOSS))
          if (bossAvailable(name, +hr) && bossClimates[name].has(climate)) out[name].add(rank);
      }
    }
    // Nakarkos lives at Wyvern's End, which is deliberately NOT on the ladder, so
    // the loop above can never reach it — it would have had no rank at all, been
    // filtered out of every sighting, and the locale would have been impossible to
    // clear. Its rank is its own floor and nothing else.
    for (const [name, b] of Object.entries(BOSS))
      if (b.line === 'nakarkos') out[name].add(b.floor);
    return out;
  })();
  const bossMeetableAt = (name, rank) => !!bossRanks[name] && bossRanks[name].has(rank);

  const ARMORS = (() => {
    const out = [];
    for (const [line, L] of Object.entries(ARMOR_PIECES)) {
      // Every line gets entries, INCLUDING the sixty with no material yet — the
      // benches have to be able to try armor the game cannot yet hand out, and
      // building it here beats a second, divergent list inside a tool.
      //
      // `forgeable` is what separates them. A piece with no material can never be
      // known in the smithy anyway (it filters on holding that material), but the
      // save-maker and the sim both pick out of this list and must say so.
      const mats = MAT_LINES[line];
      // A tier needs BOTH a real part name and a monster you can meet at that
      // rank to drop it. Reading only the first is what produced three suits
      // nobody could ever forge.
      const boss = Object.values(BOSS).find(b => b.line === line);
      const ranks = ['Low', 'High', 'G'].filter(r =>
        L[r] && hasArmorAt(line, r)
        && (!mats || (mats[r] && (!boss || bossMeetableAt(boss.name, r)))));
      ranks.forEach((rank, i) => {
        for (const slot of PIECE_SLOTS) {
          out.push({
            id: `${line}_${slot}_${rank.toLowerCase()}`, line, rank, slot,
            name: `${armorLineName(line)} ${PIECE_LABEL[slot]}${armorSuffix(rank)}`,
            rarity: armorRarity(line, rank),
            ...ARMOR_PIECE_BASE(armorRarity(line, rank)),
            // Levels are the board's now, not the rank's. A G helm can carry a
            // level 2 where its chest carries a 1 — which is the whole reason
            // three pieces are worth having.
            effects: (L[rank][slot] || []).map(e => ({ key: e.k, lvl: e.lvl })),
            mat: mats ? bossMat(line, rank) : null,
            forgeable: !!mats,
            matCount: 1,
            cost: rank === 'Low' ? 600 : rank === 'High' ? 3000 : 11400,
            levelCost: n => Math.round((rank === 'Low' ? 235 : rank === 'High' ? 1070 : 3670) * Math.pow(1.45, n)),
          });
        }
      });
    }
    return out;
  })();
  const armorById = new Map(ARMORS.map(a => [a.id, a]));

  // The monster as you meet it on THIS rung — stats, pay and the part it drops
  // all scaled to the rank. `rod` is what you are holding, and it cuts the sink
  // exactly as it does on a fish; without that a G Rank monster would be
  // unplayable rather than hard.
  function bossAt(name, hr, rod, armor = null, ctx = null) {
    const b = BOSS[name];
    if (!b) return null;
    const rank = curveRank(hr);
    const t = b.tier;
    const rate = RANK_TOP_RATE[rank]
      * (BOSS_RATE_MULT.lo + t * (BOSS_RATE_MULT.hi - BOSS_RATE_MULT.lo));
    const secs = BOSS_SECONDS[rank] * (0.9 + t * 0.2);
    const lift = 0.095 + rodLift(rod);
    const progressPerSec = (1 / secs) * (1 + effectPower(armor, 'progress'));
    return {
      ...b,
      rank,
      durationMs: Math.round(secs * 1000),
      // Bounty is monster pay ONLY, which is what separates it from Fair Price.
      reward: Math.round(RANK_PEAK[rank] * BOSS_REWARD_MULT * (1 + effectPower(armor, 'bounty'))
        * (0.75 + t * 0.5) / 50) * 50,
      xp: Math.round((60 + RANK_HR[rank] * 22) * (0.8 + t * 0.6)),
      mat: bossMat(b.line, rank),
      fight: {
        sinkPerSec: rate * lift * (1 - rodSink(rod)),
        // Same two faces as a fish — see fightFor.
        sinkInBand: rate * lift * (1 - rodSink(rod)) * (1 - effectPower(armor, 'control')),
        liftOutOfBand: lift * (1 + effectPower(armor, 'control')),
        liftPerPress: lift,
        band: Math.max(BOSS_BAND_FLOOR,
          (0.115 - t * 0.05) * (1 + rodBand(rod) + effectPower(armor, 'band') + heatBand(armor, ctx))),
        progressPerSec,
        // The second bar, which bosses never ran at all until now — the reason
        // they were the easiest thing in the water while paying the most.
        escapePerSec: progressPerSec * BOSS_ESCAPE_MULT[rank] * (1 - effectPower(armor, 'escape')),
        strikeWindowMs: Math.max(1200, 1800 - t * 400) * (1 + effectPower(armor, 'strike')),
      },
    };
  }

  // ── Small monsters ────────────────────────────────────────────────────────
  //
  // A locale is not empty while you stand in it. Something small comes at you
  // now and then and it costs HP — which is what finally gives HP a job away
  // from the two hot locales, where heat had been the only thing that ever
  // touched it. Which small monsters live where is real: see `pests` on each
  // locale, taken from the quests that actually run there.
  //
  // A Hunter for Hire stands watch and turns most of them away. Most, not all —
  // HP still has to be managed, the hire only changes how hard.
  // The most of any one item or bait you can hold. Separate from the per-trip
  // carry limits: this is your whole stock, that is what fits in the pouch.
  const STOCK_CAP = 99;


  // ── Sightings ─────────────────────────────────────────────────────────────
  //
  // Which locales are holding a monster THIS time out. Rolled once when you get
  // back to camp and stored; never at render, because the locale list re-renders
  // on every click and the danger tags would shuffle under your hand.
  //
  // The reason it exists: monsters were pinned to their real habitats, and those
  // habitats happen to cluster away from the rank-entry rungs. HR1, HR2, HR4 and
  // HR9 held nothing at all — you were promoted, arrived somewhere new, and met
  // nothing until the rank's second rung.

  // A locale that is the ONLY place some monster lives always holds one, or that
  // monster's armor cannot be farmed at a sensible rate. Derived rather than
  // listed: a hand-kept list of exactly this shape drifted out of step once
  // already and left three suits nobody could forge.
  const soleHomes = (() => {
    const LOCALES = window.MF_LOCALES || [];
    const onLadder = new Set();
    for (let hr = 1; hr <= MAX_LADDER_HR; hr++)
      for (const id of localesAtHR(hr) || []) onLadder.add(id);
    const out = new Set();
    for (const name of Object.keys(BOSS)) {
      const homes = LOCALES.filter(l => onLadder.has(l.id) && (l.boss || []).includes(name));
      if (homes.length === 1) out.add(homes[0].id);
    }
    return out;
  })();

  // How likely a locale is to be holding something. Sole homes always are. The
  // rest sit near a third, leaning on how many monsters call the place home —
  // Deserted Island with three residents reads as worse than the Marshlands with
  // none, which is the character those places already have.
  // Raised from .22/.14 after playtesting: two long trips at Jurassic Frontier
  // and Verdant Hills — both resident-less, both therefore sitting at the bare
  // base — produced no monster at all across 105 fish. The encounter ramp was
  // working the whole time; there was simply nothing out there to meet. A locale
  // with nobody living in it was quiet on four visits out of five, and those are
  // exactly the locales the rank-entry rungs are made of.
  const SIGHT = {
    base: 0.42,          // a locale nothing lives in
    perResident: 0.15,   // ...and what each resident adds
    visitor: 0.20,       // chance the one sighted is a wanderer, not a resident
    pests: 0.7,          // small monsters are about, or the place is quiet
  };

  function sightChance(localeId, rank) {
    // Wyvern's End is one monster's arena. It is always there — a report saying
    // the place is quiet would mean a trip that could not possibly clear it.
    if (localeId === FINAL_LOCALE) return 1;
    if (soleHomes.has(localeId)) return 1;
    const loc = (window.MF_LOCALES || []).find(l => l.id === localeId);
    const residents = ((loc && loc.boss) || []).filter(n => bossMeetableAt(n, rank));
    return Math.min(0.9, SIGHT.base + SIGHT.perResident * residents.length);
  }

  // Everything that could be sighted here, split into the ones that live here and
  // the ones that could only be passing through.
  function sightCandidates(localeId, rank) {
    // Nothing else swims here. Without this the arena reported Royal Ludroth and
    // five others as passing through, which is both wrong and a way to reach a
    // locale that cannot be cleared by what is in it.
    if (localeId === FINAL_LOCALE) return { home: [FINAL_BOSS], visiting: [] };
    const loc = (window.MF_LOCALES || []).find(l => l.id === localeId);
    const home = ((loc && loc.boss) || []).filter(n => bossMeetableAt(n, rank));
    const climate = climateOf(localeId);
    // A final boss does not wander. Without this it would turn up as a visitor in
    // any locale sharing Wyvern's End's climate, which would both spoil it and
    // hand out its parts long before the locale opens.
    const visiting = Object.keys(BOSS).filter(n =>
      !home.includes(n) && n !== FINAL_BOSS
      && bossMeetableAt(n, rank) && bossClimates[n].has(climate));
    return { home, visiting };
  }

  // One locale's report for one rung. `rng` is passed in so a save can be rolled
  // deterministically in a test without touching Math.random.
  function rollSighting(localeId, hr, rng = Math.random) {
    const rank = curveRank(hr);
    const { home, visiting } = sightCandidates(localeId, rank);
    const pool = home.length || visiting.length;
    const boss = (pool && rng() < sightChance(localeId, rank))
      ? (() => {
          // Residents are the norm; a wanderer is worth remarking on. With no
          // residents at all, whatever turns up is by definition passing through.
          const wander = !home.length || (visiting.length && rng() < SIGHT.visitor);
          const from = wander ? visiting : home;
          return from.length ? from[Math.floor(rng() * from.length)] : null;
        })()
      : null;
    // Nothing small pesters you at the arena either; the data gives it no pests,
    // and saying otherwise in the report would promise an attack that never comes.
    return { boss, pests: localeId === FINAL_LOCALE ? false : rng() < SIGHT.pests };
  }

  const sightingKey = (localeId, hr) => `${localeId}@${hr}`;

  const PEST = {
    chancePerCast: 0.20,
    hireCut: 0.85,                          // how much of that a hire removes
    damage: { Low: 16, High: 24, G: 32 },   // by the best table you can read here
  };

  // What the watch costs. Harder water, worse weather and something big already
  // in the locale all price the job up, because all three make it a worse day to
  // be stood there. Climate and danger stack.
  const HIRE = {
    base: { Low: 150, High: 300, G: 700 },
    climate: { temperate: 1, cold: 1.3, hot: 1.3 },
    danger: 1.6,
    round: 50,
  };

  // Encounter chance per cast. Volcano is the outlier on purpose — you go there
  // knowing Lavasioth is the tax on the ore.
  // Nakarkos is not fished FOR — it is what you are there to catch, so it checks
  // in far more readily than anything else. Wyvern's End is one locale with one
  // monster in it, so there is nothing for a low rate to preserve the mystery of.
  const ENCOUNTER_CHANCE = {
    Nakarkos: 0.024,
    Cephadrome: 0.012, 'Royal Ludroth': 0.012, Nibelsnarf: 0.010,
    Plesioth: 0.007, Zamtrios: 0.010, Agnaktor: 0.012,
    Lagiacrus: 0.008, Lavasioth: 0.022,
    // The crabs are in a lot of locales and need no help being met; Mizutsune is
    // scarcer, being the late one of the three.
    'Daimyo Hermitaur': 0.010, 'Shogun Ceanataur': 0.012, Mizutsune: 0.008,
  };

  // ── Wyvern's End ──────────────────────────────────────────────────────────
  //
  // The one locale that is not a fishing spot. It opens only once every rung of
  // the ladder is behind you, it has no zenny goal, and the only thing that
  // clears it is landing Nakarkos.
  //
  // It is kept OUT of LADDER on purpose. Promotion counts ladder locales, so a
  // locale in there would have to be cleared before HR could move — and this one
  // is the thing that moves HR itself.
  const FINAL_LOCALE = 'wyvern_s_end';
  const FINAL_BOSS = 'Nakarkos';

  // ── When a monster checks in ──────────────────────────────────────────────
  //
  // Every monster has a number of casts between CHECKS, and each check is one
  // roll for whether it shows itself. This replaced a per-cast roll, which was
  // sound on paper and dreadful in play: at roughly a percent a cast the maths
  // works out over sixty-five casts, but nothing ever visibly happens, and two
  // full playtest trips in a row met nothing at all. Ten rolls at a third each
  // carry the same expectation and can actually be felt.
  //
  // The interval is per monster and derived from the old per-cast rates, so the
  // relative rarity Raven had already tuned survives the change: Lavasioth was
  // the readiest to surface and still is, Plesioth the shyest and still is.
  // Clamped to 4..10 so nothing checks in on top of itself or goes missing.
  const ENCOUNTER_CHECK_K = 0.072;
  const encounterCheckEvery = name => {
    const base = ENCOUNTER_CHANCE[name] ?? 0;
    if (!base) return Infinity;
    return Math.min(10, Math.max(4, Math.round(ENCOUNTER_CHECK_K / base)));
  };

  // What one check is worth. It climbs with the rung — deeper water, bolder
  // animals — so a G Rank locale is not merely richer but genuinely busier.
  const ENCOUNTER_ODDS = 0.30;
  const ENCOUNTER_RANK_SCALE = 1.0;

  // Staying out longer still matters, but through the number of CHECKS rather
  // than through a rising rate: forty casts is six chances at Royal Ludroth,
  // twenty is three. `castsSince` is casts since one last turned up, and it is
  // reset by meeting one — whatever was circling has arrived and gone.
  //
  // Returns 0 on a cast where no check is due, so the caller stays a single
  // `rng() < chance` and does not have to know about the cadence.
  const encounterChance = (name, hr, castsSince = 0, gear = null) => {
    if (!ENCOUNTER_CHANCE[name]) return 0;
    // Lure shortens the CADENCE rather than fattening the odds: checks come round
    // sooner, so it reads as "they show up more often" instead of "when one was
    // due it was likelier", which is the same number and the wrong feeling.
    const every = Math.max(2, Math.round(encounterCheckEvery(name) * (1 - effectPower(gear, 'lure'))));
    if (castsSince <= 0 || castsSince % every !== 0) return 0;
    const rung = Math.min(1, Math.max(0, ((hr || 1) - 1) / 11));
    return Math.min(0.9, ENCOUNTER_ODDS * (1 + rung * ENCOUNTER_RANK_SCALE));
  };
  // What the cadence actually becomes, for the benches and the skill sheet.
  const encounterEveryFor = (name, gear) =>
    Math.max(2, Math.round(encounterCheckEvery(name) * (1 - effectPower(gear, 'lure'))));

  // Losing a boss fight COSTS YOU HP rather than ending the trip outright. What
  // it costs is set by the rung the locale sits on, so a Plesioth in G-rank water
  // hits far harder than the same Plesioth on the Low ladder.
  //
  // It can still end the trip — if the blow empties the bar you cart, and the
  // haul goes with you exactly as before. The difference is that surviving it is
  // now something you can prepare for, which is what makes HP worth spending on.
  const BOSS_LOSS = { base: 34, perHR: 4 };
  const bossLossDamage = localeHR => BOSS_LOSS.base + BOSS_LOSS.perHR * localeHR;

  // ── Bracing ───────────────────────────────────────────────────────────────
  //
  // Part-way through a fight the monster breaks off and comes at you. HOLD Space
  // and you take the hit on the rod; let go and it lands on you. The whole fight
  // freezes while it happens — indicator, band, both bars — so bracing is a
  // moment of its own rather than one more thing to juggle mid-reel.
  //
  // `holdMs` is what defeats hammering. A player mashing Space at five presses a
  // second is down about as often as they are up, so sampling the key at the
  // moment of impact would let mashing pass half the time; requiring it held for
  // a quarter of a second first means you have to actually stop and press.
  const BOSS_ATTACK = {
    firstMs: 2600,      // earliest it will break off, so a fight opens normally
    everyMs: 5200,      // and again this often
    windupMs: 750,      // it lunges out over this, and the hit lands at the end
    recoverMs: 550,     // then slides back to the middle and reeling resumes
    holdMs: 250,        // Space must already have been down this long at impact
    damageShare: 0.4,   // of a lost fight's damage — several hits still kill
    escapeOnHit: 0.15,  // and it takes this much of the escape bar with it
  };
  const bossAttackDamage = localeHR =>
    Math.max(1, Math.round(bossLossDamage(localeHR) * BOSS_ATTACK.damageShare));

  // ── What the armor moves ──────────────────────────────────────────────────
  //
  // One accessor per tunable an armor skill touches. Consumers call these instead
  // of reading the constant, so a skill is wired in exactly ONE place and the
  // constant underneath stays the plain readable number it always was.
  //
  // Down here on purpose: these close over PEST, BOSS_ATTACK, POND and the rest,
  // and every one of those is declared further up.
  // The tools' way in: gearWith({ band: 3 }) is a set that grants Sure Grip 3.
  const gearWith = levels => ({ __levels: levels });
  const up = (gear, key, base) => base * (1 + effectPower(gear, key));
  const down = (gear, key, base) => base * (1 - effectPower(gear, key));

  const pouchSlots = gear => Math.round(up(gear, 'carry', POUCH_SLOTS));
  const tackleSlots = gear => Math.round(up(gear, 'carry', TACKLE_SLOTS));
  const baitCarry = gear => Math.round(up(gear, 'carry', BAIT_CARRY));

  // No drinkSeconds: a drink's length belongs to Heat Resist and Cold Resist,
  // so Duration deliberately cannot reach it.
  const dashSeconds = gear => up(gear, 'duration', DASH_SECONDS);
  const armorSeconds = gear => up(gear, 'duration', ARMOR_SECONDS);

  const freshChance = gear => Math.min(1, up(gear, 'fresh', FRESH_CHANCE));
  // Whole ingredients, so it steps rather than scales: one more every third level.
  const freshMax = gear => FRESH_MAX + Math.floor(effectLevel(gear, 'fresh') / 3);

  // Closes the GAP to certainty rather than scaling the cut. Scaling it made
  // level 1 alone turn every pest away, because 0.85 x 1.2 is already past 1.
  const hireCut = gear => 1 - (1 - PEST.hireCut) * (1 - effectPower(gear, 'hire'));
  // What the hire, the Palicos and the cart charge.
  const haggle = (gear, cost) => Math.round(down(gear, 'haggle', cost));

  // Fewer fish needed for the full basket. Floored so it can never become
  // something a single good cast satisfies.
  const basketTarget = gear => Math.max(10, Math.round(down(gear, 'basket', BASKET.target)));

  // LOWER is more forgiving: holdMs is how long Space must ALREADY have been down
  // when the blow lands.
  const braceHoldMs = gear => Math.round(down(gear, 'brace', BOSS_ATTACK.holdMs));

  // A second part off the same monster.
  const partsChance = gear => effectPower(gear, 'parts');
  // Keyed by the `site` a material really carries in the data — Gather, Bug, Mine.
  const siteChance = gear => ({
    Gather: effectPower(gear, 'siteGather'),
    Bug: effectPower(gear, 'siteBug'),
    Mine: effectPower(gear, 'siteMine'),
  });

  // XP is worked out from the catch alone at the top of this file, long before
  // there is any notion of what you are wearing, so Experience wraps it here.
  const xpGain = (fish, ore, gear) =>
    Math.round(xpFor(fish, ore) * (1 + effectPower(gear, 'lesson')));

  // The whole pond, tuned to what you have on. Handed to the minigame as one
  // object so fishing.js keeps reading plain fields and knows nothing about armor.
  const pondFor = gear => ({
    ...POND,
    bobberStep: up(gear, 'bobber', POND.bobberStep),
    glideRate: up(gear, 'bobber', POND.glideRate),
    stepCooldownMs: down(gear, 'bobber', POND.stepCooldownMs),
    attract: up(gear, 'reach', POND.attract),
    attractRange: Math.min(1, up(gear, 'reach', POND.attractRange)),
    hookChance: Math.min(0.95, up(gear, 'hook', POND.hookChance)),
  });

  window.MF_GAME = {
    RANKS, rankById, rankAt, hrForRank, tableRanksAt, xpFor, hrThreshold,
    RANK_HR, ORE_RANK_HR, curveRank, fishUnlockHR, oreUnlockHR, itemUnlockHR, baitUnlockHR, unlockLabel,
    ORE_PREFIX, variantName, variantId, variantIcon, variantValue, ORE_HEX, ORE_TINT, ORE_ICON, oreHex,
    ORE_WEIGHT, oresAt, ORE_VALUE_MULT,
    buildBaits, baitIconFor,
    ITEM_EFFECT, effectOf, ITEM_GROUPS,
    COMBO_BASE_ITEM, COMBO_BASES, SPECIES_RECIPE, ORE_MAT,
    comboWorth, comboRecipe, comboMaterial, comboBase, comboRate,
    BOOKS, bookById, bookBonus, PALICO, TRADE, BASKET, basketBonus,
    TRADE_CART, TRADE_CART_MAX, TRADE_CART_UNLOCK_HR, cartAt, cartTierOpen,
    MATERIALS, materialById, isBuyableMat, isQuestRewardMat, MAT_BUYABLE, pouchItems, pouchItemById,
    POUCH_SLOTS, TACKLE_SLOTS, BAIT_CARRY, carryLimit, ownCap, SUPPLY_RANK, SUPPLY_EACH,
    pouchSlots, tackleSlots, baitCarry, dashSeconds, armorSeconds,
    freshChance, freshMax, hireCut, haggle, basketTarget, braceHoldMs,
    partsChance, siteChance, xpGain, pondFor,
    DESIGNED_POOLS, ARENA_POOL, RANK_ORDER, rankIndex, SHOW_DESIGNED_LOCALES,
    SPECIAL_LOCALES, isSpecialLocale, FINAL_LOCALE, FINAL_BOSS, LADDER_RUNGS,
    LADDER, localesAtHR, localesOpenAt, bandOf, openedAtHR, rungsOpenAt, nextHR, MAX_LADDER_HR,
    GOAL_CASTS, GOAL_CASTS_BY_RANK, GOAL_CASTS_BY_HR, goalCasts, GOAL_ROUND,
    CLIMATE, climateOf, WATER, WATER_BY_CLIMATE, waterOf,
    CAST_PRESSES, CAST_PRESS_WINDOW_MS,
    CLIMATE_RATES, CLIMATE_TICK_MS, DRINK_SECONDS,
    DASH_SECONDS, DASH_MULT, ARMOR_SECONDS,
    BOMB, bombCatch, bombValueMult,
    BASE_MAX_HP, BASE_MAX_STAMINA, STAMINA_COST,
    MEALS, mealCost, MEAL_SCALE, ITEM_PRICE, priceOf,
    RETIRED_UPGRADES, refundUpgrades,
    MAT_LINES, MONSTER_MATS, monsterMatById, bossMat, matId,
    TRADE_RATE, tradeRate, matsAtRarity, tradeRarities,
    EFFECTS, EFFECT_MAX, effectName, effectBlurb, isFlagEffect, effectPower, armorEffects,
    effectLevel, climateFor, heatBand, culledOres,
    ARMOR_PIECES, armorLineName, PIECE_SLOTS, PIECE_LABEL, wornSetLine, armorRarity,
    gearWith,
    ARMORS, armorById, armorStat, ARMOR_LEVELS, ARMOR_PER_LEVEL, armorSuffix,
    RODS, rodById, ROD_LEVELS, ROD_PER_LEVEL,
    rodSink, rodBand, rodLift, rodBites, rodSchool, rodStat,
    GEAR_LEVEL_HR, RANK_PAY, payMult, RANK_PEAK,
    bossAt, bossAvailable, bossRanks, bossMeetableAt, RANK_TOP_RATE,
    SIGHT, soleHomes, bossClimates, sightChance, sightCandidates, rollSighting, sightingKey, BOSS_SECONDS, BOSS_ESCAPE_MULT, BOSS_REWARD_MULT,
    CANTEEN, INGREDIENT_CHANCE, ingredientById, ingredientPool, rollIngredient,
    recipeFor, mealAvailable, mealsAvailable,
    MEAL_TIERS, mealPower, mealUnlockHR,
    FRESH, FRESH_CHANCE, FRESH_MAX, FRESH_LABEL, isFresh, freshBonus, freshLines, freshShort,
    freshPick,
    POND, REEL_START, RUNG_TIGHTEN, fightFor, BOSS, BOSS_BAND_FLOOR, PEST, HIRE, ENCOUNTER_CHANCE,
    ENCOUNTER_RANK_SCALE, ENCOUNTER_ODDS, encounterCheckEvery,
    encounterChance, encounterEveryFor, STOCK_CAP,
    BOSS_LOSS, bossLossDamage, BOSS_ATTACK, bossAttackDamage,
  };
})();
