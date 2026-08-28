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
    { k: 'control',    name: 'Control',    group: 'The reel', at: 'lift per press — how far one tap moves the line' },
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
    { k: 'carry',      name: 'Carrying',   group: 'The trip', at: 'POUCH_SLOTS / TACKLE_SLOTS / BAIT_CARRY' },
    { k: 'duration',   name: 'Duration',   group: 'The trip', at: 'DRINK_SECONDS / DASH_SECONDS / ARMOR_SECONDS' },
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

  window.MF_SKILLS = {
    list: SKILLS,
    groups: GROUPS,
    byKey: Object.fromEntries(SKILLS.map(s => [s.k, s])),
    // game.js is the source of a skill's NAME now that it holds exactly one per
    // skill. The `name` in the list above is only the fallback for a skill the
    // game has not declared yet, so the two cannot drift.
    nameOf: k => (window.MF_GAME && window.MF_GAME.EFFECTS[k] || {}).name
              || (window.MF_SKILLS.byKey[k] || {}).name || k,
    // Shipped means the game already reads it. Everything else is a proposal.
    isShipped: k => !!(window.MF_GAME && window.MF_GAME.EFFECTS[k]),
  };
})();
