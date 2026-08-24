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
  const variantIcon = ore => `MH4G-Fish_Icon_${ore.color.replace(/ /g, '_')}.png`;

  // Ore colours as hex, for tinting. The real MH4G-Fish_Icon_<Color>.png set is
  // not in hand — Kiranico blocks crawling and the wiki is not trustworthy — so
  // the guide draws a tinted silhouette instead. variantIcon() above already
  // returns the right filename, so dropping the real art in is a one-line change.
  const ORE_HEX = {
    White: '#e9e9e6', Red: '#d64a4a', Green: '#5bb85f', Blue: '#4a7fd6',
    Yellow: '#e3c545', Purple: '#a05fc0', 'Light Blue': '#6fc9e0',
    Orange: '#e08b41', Pink: '#e07ba8', Grey: '#98a0a8', Cyan: '#3fd0c4',
  };
  const oreHex = ore => ORE_HEX[ore.color] || ORE_HEX.Grey;

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
    5:  ['verdant_hills', 'arctic_ridge', 'frozen_seaway', 'deserted_island'],
    6:  ['dunes', 'misty_peaks', 'volcanic_hollow'],
    // Two empty rungs close out High. checkPromotion steps straight over them, so
    // clearing HR6 lands you on HR9 and G Rank.
    7:  [],
    8:  [],
    // G Rank — all eleven return at G tables, plus three new
    9:  ['jurassic_frontier', 'marshlands', 'ancestral_steppe', 'primal_forest'],
    10: ['verdant_hills', 'arctic_ridge', 'frozen_seaway', 'deserted_island'],
    11: ['dunes', 'misty_peaks', 'jungle'],
    12: ['volcanic_hollow', 'ruined_pinnacle', 'desert'],
  };

  // Which HRs belong to the same rank, so a rank's rungs accumulate but do not
  // spill across a promotion.
  const BAND = [[1, 3], [4, 8], [9, 12]];
  const bandOf = hr => BAND.find(([a, b]) => hr >= a && hr <= b);

  const localesAtHR = hr => LADDER[hr] || [];

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
  // GOAL_CASTS is the sizing dial. A bare trip supports ~15 casts, so 18 puts the
  // goal just past a perfect unprovisioned run: you need a meal or some Endurance
  // to clear it, and comfortably so once you have both.
  const GOAL_CASTS = 18;
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

  // How long one drink holds off the climate, measured in fight seconds rather
  // than wall clock — a trip is only as long as the time you spend reeling.
  const DRINK_SECONDS = 90;

  // Dash Juice halves what reeling costs. Same clock as a drink, measured in
  // fight seconds; the Mega version simply runs twice as long.
  const ARMOR_SECONDS = 90;    // one Armorskin; the Mega lasts twice that
  const DASH_SECONDS = 90;
  const DASH_MULT = 0.5;

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
    cool_drink:      { group: 'misc',                           unlock: 1,  carry: 5,  label: 'Increases heat resistance for a short time' },
    hot_drink:       { group: 'misc',                           unlock: 1,  carry: 5,  label: 'Increases cold resistance for a short time' },
    dash_juice:      { group: 'misc',      dash: 1,             unlock: 5,  carry: 5,  label: 'Halves Stamina used while reeling' },
    mega_dash_juice: { group: 'misc',      dash: 2,             unlock: 9,  carry: 2,  label: 'Halves Stamina used while reeling, for twice as long' },
    // Defence, the same currency the Alcohol fresh bonus pays in: a fraction off
    // what small monsters and the two big ones take from you.
    armorskin:       { group: 'misc',      def: 0.15, secs: 1,  unlock: 5,  carry: 5,  label: '+15% Def for a short time' },
    mega_armorskin:  { group: 'misc',      def: 0.25, secs: 2,  unlock: 9,  carry: 2,  label: '+25% Def, for twice as long' },
  };

  // How much you can take at all. A slot holds one KIND of item, up to its own
  // carry limit, so the choice is which six things matter — not how much of
  // everything you can afford.
  // Low Rank gets a free supply box — a few First-aid Meds and Rations — so a new
  // angler is not immediately punished for packing badly. It stops at promotion:
  // from High Rank on, everything you carry is something you chose and paid for.
  const SUPPLY_RANK = 'Low';
  const SUPPLY_EACH = 3;

  const POUCH_SLOTS = 6;
  const TACKLE_SLOTS = 5;      // bait kinds, swapped between casts — the "Bait Pouch"
  const BAIT_CARRY = 10;       // of any one bait

  const carryLimit = id => ITEM_EFFECT[id]?.carry ?? 10;
  const effectOf = id => ITEM_EFFECT[id] || { group: 'misc', label: '' };
  const itemUnlockHR = p => ITEM_EFFECT[p.id]?.unlock ?? 1;

  // Prices are the transcribed ones unless overridden here. Rare Steak and Energy
  // Drink have both their effect and their price swapped: the steak is the bigger,
  // dearer, later one and the drink is the cheap early standby. Straight off the
  // real numbers the steak was half the price AND stronger, which left the drink
  // with no reason to exist after HR5.
  const ITEM_PRICE = { rare_steak: 60, energy_drink: 30 };
  const priceOf = p => ITEM_PRICE[p.id] ?? p.buy;

  // A group with an explicit order lists its items that way; the rest sort by
  // price. Misc is spelled out because price order buries Ancient Potion at the
  // bottom, when it is the one people are looking for.
  const ITEM_GROUPS = [
    ['hp', 'HP Items'],
    ['stamina', 'Stamina Items'],
    ['misc', 'Misc', ['ancient_potion', 'cool_drink', 'hot_drink', 'dash_juice', 'mega_dash_juice',
                      'armorskin', 'mega_armorskin']],
  ];

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

  const INGREDIENT_CHANCE = 0.06;

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
  const FRESH = {
    Meat:       { hp: 8 },        // even a stamina-only dish comes with HP on it
    Vegetables: { stamina: 8 },
    Fish:       { zenny: 0.06 },  // a fraction of every catch's value
    Alcohol:    { guard: 0.10 },  // defence: a fraction off what monsters take
  };
  const FRESH_LABEL = {
    hp: n => `+${n} HP`,
    stamina: n => `+${n} Stamina`,
    zenny: n => `+${Math.round(n * 100)}% zenny per catch`,
    guard: n => `+${Math.round(n * 100)}% Def`,
  };

  const ingredientById = new Map(CANTEEN.ingredients.map(i => [i.id, i]));

  // Held as `true` when found and `'fresh'` when found fresh. Both are truthy, so
  // every recipe check still reads the same and saves from before freshness load
  // unchanged — they simply have no fresh ingredients yet.
  const isFresh = (held, id) => held[id] === 'fresh';

  // Anything you have not found, plus anything you have found but not FRESH.
  // A find is therefore always worth something: a new ingredient early on, and a
  // freshness upgrade once the pantry fills up.
  const ingredientPool = (hr, held) => CANTEEN.ingredients
    .filter(i => hr >= RANK_HR[i.rank] && !isFresh(held, i.id));

  function rollIngredient(hr, held, rng = Math.random) {
    if (rng() >= INGREDIENT_CHANCE) return null;
    const pool = ingredientPool(hr, held);
    if (!pool.length) return null;
    const found = pool[Math.floor(rng() * pool.length)];
    // Already in the pantry? Then the only reason it came up is to be upgraded.
    const fresh = held[found.id] ? true : rng() < FRESH_CHANCE;
    return { ...found, fresh, upgrade: !!held[found.id] };
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
  const FRESH_SHORT = {
    hp: n => `+${n} HP`,
    stamina: n => `+${n} Sta`,
    zenny: n => `+${Math.round(n * 100)}% z`,
    guard: n => `+${Math.round(n * 100)}% Def`,
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

  function mealAvailable(meal, held, hr) {
    if (meal.id === 'none') return true;
    if (meal.cut) return false;
    if (meal.baseline) return hr >= (RANK_HR[meal.rank] || 1);
    const r = recipeFor.get(meal.name);
    return !!r && !!held[r.a] && !!held[r.b];
  }

  const mealsAvailable = (held, hr) => MEALS.filter(m => mealAvailable(m, held, hr));

  // ── Permanent upgrades ────────────────────────────────────────────────────
  const UPGRADES = [
    { id: 'vitality', name: 'Vitality',  max: 20, per: 5,
      icon: 'assets/ItemIcons/MH4G-Medicine_Icon_Green.png',
      cost: n => Math.round(1200 * Math.pow(1.38, n)), desc: '+5 max HP per level.' },
    { id: 'endurance', name: 'Endurance', max: 20, per: 8,
      icon: 'assets/ItemIcons/MH4G-Meat_Icon_Orange.png',
      cost: n => Math.round(1000 * Math.pow(1.36, n)), desc: '+8 max Stamina per level.' },
    { id: 'line', name: 'Line Strength', max: 10, per: 1,
      icon: 'assets/BaitIcons/MH4G-Bait_Icon_Yellow.png',
      cost: n => Math.round(2600 * Math.pow(1.55, n)),
      desc: 'Widens the stretch where the line holds, and it slackens more slowly.' },
    { id: 'lure', name: 'Lure Quality', max: 10, per: 1,
      icon: 'assets/ItemIcons/MH4G-Book_Icon_Yellow.png',
      cost: n => Math.round(3000 * Math.pow(1.58, n)),
      desc: 'Draws a bigger school and makes fish readier to take the hook.' },
  ];

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

  function fightFor(fish, ore, lineLevel) {
    const r = fish.rarity, o = ore.rank;
    const durationMs = 3200 + r * 700 + o * 1400;
    return {
      durationMs,
      // How fast the line falls slack when you stop pulling.
      sinkPerSec: Math.max(0.18, 0.30 + r * 0.014 + o * 0.022 - lineLevel * 0.010),
      // What one press buys. Flat, so the rhythm is the skill, not the timing.
      liftPerPress: 0.085,
      // Half-width of the good stretch either side of centre.
      band: Math.min(0.34, Math.max(0.10, 0.24 - r * 0.009 - o * 0.014) + lineLevel * 0.010),
      // Ground is only gained inside that stretch. A clean fight runs a little
      // under the nominal duration, so playing well beats the stamina you paid.
      progressPerSec: 1000 / (durationMs * 0.6),
      // The window has to be long enough to NOTICE, not just long enough to
      // react to. Anything under a second is a reflex test you can only pass by
      // already expecting it, which is the opposite of watching for a bite.
      strikeWindowMs: Math.max(1600, 2800 - r * 80 - o * 100),
    };
  }

  // Bosses are a different animal: they sink fast, hold a narrow stretch, and
  // they cart you on a loss.
  const BOSS = {
    Plesioth: {
      // bait: 'frog' — withheld; nothing raises the odds deliberately right now.
      name: 'Plesioth', icon: 'MHGU-Plesioth_Icon.webp', bait: null,
      durationMs: 26000, reward: 14000,
      fight: { sinkPerSec: 0.48, liftPerPress: 0.095, band: 0.13,
               progressPerSec: 1 / 7, strikeWindowMs: 1500 },
      xp: 260, desc: 'It takes the line and does not let go.',
    },
    Lavasioth: {
      name: 'Lavasioth', icon: 'MHGU-Lavasioth_Icon.webp', bait: null,
      durationMs: 32000, reward: 26000,
      fight: { sinkPerSec: 0.52, liftPerPress: 0.095, band: 0.115,
               progressPerSec: 1 / 8, strikeWindowMs: 1400 },
      xp: 420, desc: 'Something moves under the lava, and the line goes tight.',
    },
  };

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
  const ENCOUNTER_CHANCE = { Plesioth: 0.007, Lavasioth: 0.022 };

  // Losing a boss fight COSTS YOU HP rather than ending the trip outright. What
  // it costs is set by the rung the locale sits on, so a Plesioth in G-rank water
  // hits far harder than the same Plesioth on the Low ladder.
  //
  // It can still end the trip — if the blow empties the bar you cart, and the
  // haul goes with you exactly as before. The difference is that surviving it is
  // now something you can prepare for, which is what makes HP worth spending on.
  const BOSS_LOSS = { base: 34, perHR: 4 };
  const bossLossDamage = localeHR => BOSS_LOSS.base + BOSS_LOSS.perHR * localeHR;

  window.MF_GAME = {
    RANKS, rankById, rankAt, hrForRank, tableRanksAt, xpFor, hrThreshold,
    RANK_HR, ORE_RANK_HR, fishUnlockHR, oreUnlockHR, itemUnlockHR, baitUnlockHR, unlockLabel,
    ORE_PREFIX, variantName, variantId, variantIcon, variantValue, ORE_HEX, oreHex,
    ORE_WEIGHT, oresAt, ORE_VALUE_MULT,
    buildBaits, baitIconFor,
    ITEM_EFFECT, effectOf, ITEM_GROUPS,
    POUCH_SLOTS, TACKLE_SLOTS, BAIT_CARRY, carryLimit, SUPPLY_RANK, SUPPLY_EACH,
    DESIGNED_POOLS, ARENA_POOL, RANK_ORDER, rankIndex, SHOW_DESIGNED_LOCALES,
    LADDER, localesAtHR, localesOpenAt, bandOf, openedAtHR, rungsOpenAt, nextHR, MAX_LADDER_HR,
    GOAL_CASTS, GOAL_ROUND,
    CLIMATE, climateOf, CLIMATE_RATES, CLIMATE_TICK_MS, DRINK_SECONDS,
    DASH_SECONDS, DASH_MULT, ARMOR_SECONDS,
    BASE_MAX_HP, BASE_MAX_STAMINA, STAMINA_COST,
    MEALS, mealCost, MEAL_SCALE, UPGRADES, ITEM_PRICE, priceOf,
    CANTEEN, INGREDIENT_CHANCE, ingredientById, ingredientPool, rollIngredient,
    recipeFor, mealAvailable, mealsAvailable,
    FRESH, FRESH_CHANCE, FRESH_LABEL, isFresh, freshBonus, freshLines, freshShort,
    POND, REEL_START, fightFor, BOSS, PEST, HIRE, ENCOUNTER_CHANCE, STOCK_CAP,
    BOSS_LOSS, bossLossDamage,
  };
})();
