// skills-data.js — the one list of skills the tools share.
//
// Both the armor bench and the skill list read this, so a skill added in one
// place cannot go missing from the other.
//
// `name` is a WORKING name: one word for the thing the skill affects, meant to
// read as obviously temporary. Raven names these properly once the allotment is
// settled. Three keep their own names instead — see `own` below.
//
// `at` names the constant a skill would move, so nothing here is a mechanic
// invented to justify a skill. Where it says a file and field, that is a real
// tunable in the shipped game.

(function () {
  const SKILLS = [
    // ── Taking fish without the rod ───────────────────────────────────────
    // Designed but unbuilt; the decisions live in MHGU-TASKS.md.
    { k: 'blast',      name: 'Blast',      group: 'Bombs and traps', at: 'bomb blast radius' },
    { k: 'bruising',   name: 'Bruising',   group: 'Bombs and traps', at: 'value lost to a blast, and to a Shock Trap' },
    { k: 'trapping',   name: 'Trapping',   group: 'Bombs and traps', at: "a trap's odds of catching" },
    { k: 'trapsize',   name: 'Capacity',   group: 'Bombs and traps', at: 'how many fish a trap holds for the trip' },

    // ── Before the hook ───────────────────────────────────────────────────
    { k: 'bobber',     name: 'Bobber',     group: 'Before the hook', at: 'POND.bobberStep / stepCooldownMs / glideRate' },
    { k: 'reach',      name: 'Reach',      group: 'Before the hook', at: 'POND.attract / attractRange' },
    { k: 'hook',       name: 'Hooking',    group: 'Before the hook', at: 'POND.hookChance' },

    // ── The reel ──────────────────────────────────────────────────────────
    { k: 'band',       name: 'Sweetspot',  group: 'The reel', at: 'how wide the sweet spot is' },
    { k: 'progress',   name: 'Capture',    group: 'The reel', at: 'how fast the capture bar fills inside it' },
    { k: 'escape',     name: 'Escape',     group: 'The reel', at: 'how fast the escape bar fills outside it' },
    { k: 'control',    name: 'Control',    group: 'The reel', at: 'sink while held, and lift per press' },
    { k: 'strike',     name: 'Strike',     group: 'The reel', at: 'strikeWindowMs, the moment to strike a nibble' },

    // ── The water ─────────────────────────────────────────────────────────
    { k: 'bites',      name: 'Bites',      group: 'The water', at: 'how eagerly fish take the line' },
    { k: 'rich',       name: 'Ore',        group: 'The water', at: 'which ore varieties turn up' },
    { k: 'lure',       name: 'Lure',       group: 'The water', at: 'how soon a large monster checks in' },
    { k: 'repel',      name: 'Pests',      group: 'The water', at: 'how often small monsters attack' },
    { k: 'parts',      name: 'Parts',      group: 'The water', at: 'what a monster leaves behind' },

    // ── The Palicos ───────────────────────────────────────────────────────
    { k: 'gather',     name: 'Palicos',    group: 'The Palicos', at: 'how much they bring back at all' },
    { k: 'siteGather', name: 'Gathering',  group: 'The Palicos', at: 'Gather sites — 14 materials, the berries, mushrooms, Honey, Whetstone' },
    { k: 'siteBug',    name: 'Bugs',       group: 'The Palicos', at: 'Bug sites — 7 materials, the crickets, King Scarab, Divine Rhino' },
    { k: 'siteMine',   name: 'Mining',     group: 'The Palicos', at: 'Mine sites — 12 materials, every ore, crystal and stone' },
    { k: 'cats',       name: 'Cats',       group: 'The Palicos', at: 'PALICO.max, how many you may bring' },

    // ── The trip ──────────────────────────────────────────────────────────
    { k: 'stamina',    name: 'Stamina',    group: 'The trip', at: 'what a cast costs' },
    { k: 'vigor',      name: 'Vitality',   group: 'The trip', at: 'how much HP and Stamina you carry' },
    { k: 'defense',    name: 'Defense',    group: 'The trip', at: 'how hard a hit lands' },
    { k: 'brace',      name: 'Brace',      group: 'The trip', at: 'BOSS_ATTACK.holdMs, the leeway a brace allows' },
    { k: 'heat',       name: 'Heat',       group: 'The trip', at: 'heat protection' },
    { k: 'cold',       name: 'Cold',       group: 'The trip', at: 'cold protection' },
    { k: 'carry',      name: 'Carrying',   group: 'The trip', at: 'POUCH_SLOTS / TACKLE_SLOTS — how many different things' },
    { k: 'stack',      name: 'Stacks',     group: 'The trip', at: 'carryLimit / BAIT_CARRY — how many of each' },
    { k: 'duration',   name: 'Duration',   group: 'The trip', at: 'DASH_SECONDS / ARMOR_SECONDS — not drinks' },
    { k: 'hire',       name: 'Hire',       group: 'The trip', at: 'PEST.hireCut, how much the watch turns away' },
    { k: 'fresh',      name: 'Fresh',      group: 'The trip', at: 'FRESH_CHANCE / FRESH_MAX at camp' },

    // ── The ledger ────────────────────────────────────────────────────────
    { k: 'zenny',      name: 'Value',      group: 'The ledger', at: 'what a catch is worth' },
    { k: 'bounty',     name: 'Bounty',     group: 'The ledger', at: 'BOSS_REWARD_MULT — monster pay only' },
    { k: 'trade',      name: 'Trade',      group: 'The ledger', at: 'what the Trade Cart brings back' },
    { k: 'haggle',     name: 'Costs',      group: 'The ledger', at: 'what the hire, the Palicos and the cart charge' },
    { k: 'saver',      name: 'Saver',      group: 'The ledger', at: 'whether an item is consumed' },
    { k: 'effectup',   name: 'Items',      group: 'The ledger', at: 'how much an item does' },
    { k: 'combo',      name: 'Combining',  group: 'The ledger', at: 'combine success' },
    { k: 'lesson',     name: 'Experience', group: 'The ledger', at: 'XP per catch' },
    { k: 'basket',     name: 'Basket',     group: 'The ledger', at: 'BASKET.target, fish needed for the bonus' },
    { k: 'salvage',    name: 'Salvage',    group: 'The ledger', at: 'what survives a cart — nothing softens that today' },

    // ── Kept their own names ──────────────────────────────────────────────
    // Not "more or less of X", so a generic one-word label would misdescribe
    // them: one indexes a rank band, one is conditional on heat and stacks onto
    // grip, and one is a once-a-trip flag.
    { k: 'cull',       name: 'Shock Bobber', group: 'Own name', own: true, at: 'which ore varieties are kept out of the water' },
    { k: 'hotblood',   name: 'Heat Hunter',  group: 'Own name', own: true, at: 'heat comfort, and grip while hot' },
    { k: 'guts',       name: 'Guts',         group: 'Own name', own: true, at: 'whether a fatal blow kills you' },
  ];

  const GROUPS = ['The reel', 'Before the hook', 'The water', 'The Palicos',
                  'The trip', 'The ledger', 'Bombs and traps', 'Own name'];

  // ── What a level actually DOES ────────────────────────────────────────
  //
  // Computed from the live game rather than described, so this sheet cannot say
  // one thing while the game does another. Each probe is handed a synthetic set
  // granting exactly that level and reports the number the game would use.
  //
  // A skill with no probe here is not wired: nothing in the game reads it yet.
  const n1 = x => Math.round(x * 10) / 10;
  const pct = x => Math.round(x * 100) + '%';
  const PROBES = {
    band:       (G, g) => 'sweet spot +' + pct(G.effectPower(g, 'band')),
    progress:   (G, g) => 'capture +' + pct(G.effectPower(g, 'progress')),
    escape:     (G, g) => 'escape -' + pct(G.effectPower(g, 'escape')),
    control:    (G, g) => 'every press is ' + pct(G.effectPower(g, 'control'))
                        + ' smaller, and the line falls ' + pct(G.effectPower(g, 'control'))
                        + ' slower while held — smaller steps, so a narrow sweet spot is sittable',
    strike:     (G, g) => 'strike window +' + pct(G.effectPower(g, 'strike')),
    bites:      (G, g) => 'bite rate +' + pct(G.effectPower(g, 'bites')),
    hook:       (G, g) => 'hook ' + pct(G.pondFor(g).hookChance) + ' (from ' + pct(G.POND.hookChance) + ')',
    reach:      (G, g) => 'draws from ' + n1(G.pondFor(g).attractRange * 100) + '% of the pond'
                        + ' (from ' + n1(G.POND.attractRange * 100) + '%)',
    bobber:     (G, g) => 'nudge every ' + Math.round(G.pondFor(g).stepCooldownMs) + 'ms'
                        + ' (from ' + G.POND.stepCooldownMs + 'ms)',
    carry:      (G, g) => G.pouchSlots(g) + ' pouch slots and ' + G.tackleSlots(g) + ' bait kinds',
    stack:      (G, g) => G.baitCarry(g) + ' bait of each, and '
                        + G.carryLimit('barrel_bomb_l', g) + ' Barrel Bomb L against '
                        + G.carryLimit('barrel_bomb_l') + ' bare',
    duration:   (G, g) => 'Dash and Armorskin last ' + Math.round(G.dashSeconds(g))
                        + 's (from ' + G.DASH_SECONDS + 's), drinks unaffected',
    vigor:      (G, g) => 'HP and Stamina +' + pct(G.effectPower(g, 'vigor')),
    defense:    (G, g) => 'damage -' + pct(G.effectPower(g, 'defense')),
    brace:      (G, g) => 'brace by ' + G.braceHoldMs(g) + 'ms (from ' + G.BOSS_ATTACK.holdMs + 'ms)',
    stamina:    (G, g) => 'casts cost -' + pct(G.effectPower(g, 'stamina')),
    fresh:      (G, g) => G.freshMax(g) + ' fresh ingredients (from ' + G.FRESH_MAX + ')',
    hire:       (G, g) => 'the watch turns away ' + pct(G.hireCut(g)) + ' (from ' + pct(G.PEST.hireCut) + ')',
    repel:      (G, g) => 'pests -' + pct(G.effectPower(g, 'repel')),
    zenny:      (G, g) => 'every catch +' + pct(G.effectPower(g, 'zenny')),
    bounty:     (G, g) => 'monster pay +' + pct(G.effectPower(g, 'bounty')),
    trade:      (G, g) => 'the cart brings +' + pct(G.effectPower(g, 'trade')),
    haggle:     (G, g) => '1000z of hire costs ' + G.haggle(g, 1000) + 'z',
    saver:      (G, g) => pct(G.effectPower(g, 'saver')) + ' chance an item is not used',
    // Says what it touches, because it deliberately does NOT touch drinks —
    // Heat Resist and Cold Resist own those.
    effectup:   (G, g) => 'potions, rations, Dash and Armorskin +'
                        + pct(G.effectPower(g, 'effectup')) + ' (not drinks)',
    combo:      (G, g) => 'combining +' + pct(G.effectPower(g, 'combo')),
    lesson:     (G, g) => 'XP +' + pct(G.effectPower(g, 'lesson')),
    basket:     (G, g) => G.basketTarget(g) + ' fish for a full basket (from ' + G.BASKET.target + ')',
    gather:     (G, g) => pct(G.effectPower(g, 'gather')) + ' chance of a second find',
    siteGather: (G, g) => pct(G.siteChance(g).Gather) + ' chance of a second of what was gathered',
    siteBug:    (G, g) => pct(G.siteChance(g).Bug) + ' chance of a second bug',
    siteMine:   (G, g) => pct(G.siteChance(g).Mine) + ' chance of a second of what was mined',
    parts:      (G, g) => pct(G.partsChance(g)) + ' chance of a second monster part',
    lure:       (G, g) => 'Royal Ludroth checks in every '
                        + G.encounterEveryFor('Royal Ludroth', g) + ' casts (from '
                        + G.encounterCheckEvery('Royal Ludroth') + ')',
    heat:       (G, g) => G.climateFor(g, 'hot').immune ? 'heat cannot touch you'
                        : 'Cool Drinks last ' + n1(G.climateFor(g, 'hot').drinkMult) + 'x',
    cold:       (G, g) => G.climateFor(g, 'cold').immune ? 'cold cannot touch you'
                        : 'Hot Drinks last ' + n1(G.climateFor(g, 'cold').drinkMult) + 'x',
    // Reports the CONTRIBUTION and says so, because fightFor clamps the finished
    // sweet spot to 0.34 however much is poured into it. Without that note this
    // sheet would advertise +180% of something the game never grants.
    hotblood:   (G, g) => 'sweet spot +' + pct(G.heatBand(g, { climate: 'hot', hotDrink: true }))
                        + ' somewhere hot with a Hot Drink, before the sweet spot’s own ceiling',
    guts:       () => 'a fatal blow leaves you on 1 HP, once a trip',
    cull:       (G, g) => 'repels up to the lower varieties of '
                        + ['Low', 'High', 'G'][Math.min(2, G.EFFECTS.cull.band[
                            Math.min(G.EFFECTS.cull.band.length - 1, G.effectLevel(g, 'cull') - 1)])] + ' Rank',
  };

  window.MF_SKILLS = {
    list: SKILLS,
    groups: GROUPS,
    byKey: Object.fromEntries(SKILLS.map(s => [s.k, s])),
    // game.js is the source of a skill's NAME now that it holds exactly one per
    // skill. The `name` in the list above is only the fallback for a skill the
    // game has not declared yet, so the two cannot drift.
    nameOf: k => (window.MF_GAME && window.MF_GAME.EFFECTS[k] || {}).name
              || (window.MF_SKILLS.byKey[k] || {}).name || k,
    // Declared means game.js has an entry for it. WIRED means something actually
    // reads it — the distinction that matters, because a skill can be declared,
    // named, assignable and still do nothing at all.
    isShipped: k => !!(window.MF_GAME && window.MF_GAME.EFFECTS[k]),
    isWired: k => !!PROBES[k],
    // What level `lvl` of skill `k` does, as the game would compute it. Null if
    // nothing reads the skill.
    effectAt: (k, lvl) => {
      const G = window.MF_GAME;
      if (!G || !PROBES[k]) return null;
      try { return PROBES[k](G, G.gearWith({ [k]: lvl })); }
      catch (e) { return 'probe failed: ' + e.message; }
    },
  };
})();
