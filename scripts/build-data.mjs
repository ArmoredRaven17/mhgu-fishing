// build-data.mjs — generate the fishing sim's data from two first sources:
//
//   1. data-src/locales/*.html  — saved Kiranico locale pages. These are the ONLY
//      access to per-locale fishing tables: the community DB has no fish rows in
//      `gathering` at all, the RomFS dump is missing the root arc\ tree, and
//      Kiranico blocks crawling. Do not delete them.
//   2. mhgu.db                  — the community MHGU database, for item stats.
//
// Run manually; commit the outputs.
//
//   node scripts/build-data.mjs [--db <path>]
//
// Zero npm deps, Node >= 22 (uses node:sqlite).
//
// Everything written here is transcribed fact. The game-design layer — ore
// variants, ore baits, tension curves, stamina/HP rates, encounter rates — lives
// in docs/game.js, deliberately kept apart. Same split ores.js uses.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const SRC = join(REPO, 'data-src', 'locales');
const OUT = join(REPO, 'docs', 'data');

const args = process.argv.slice(2);
const dbIdx = args.indexOf('--db');
const DB_PATH = dbIdx >= 0 ? args[dbIdx + 1]
  : 'C:/Coding Repos/mhgu-collection-tracker/data-src/mhgu.db';
const edIdx = args.indexOf('--editor');
const EDITOR = edIdx >= 0 ? args[edIdx + 1] : 'C:/Coding Repos/mhgu-editor';
const ICON_SRC = join(EDITOR, 'public', 'icons', 'colored');
const ICON_OUT = join(REPO, 'docs', 'assets', 'ItemIcons');

// An item's icon is not derivable from icon_name + icon_color on its own — the
// save editor keeps an explicit name -> file map and that is the authority.
// Deriving it by hand gets bait right and everything else wrong, because a
// Potion is "Medicine", a Ration is "Meat" and a Max Potion is a "Sac".
const ITEM_ICONS = (() => {
  const f = join(EDITOR, 'src', 'assets', 'item_colored_icons.json');
  try { return JSON.parse(readFileSync(f, 'utf8')); }
  catch (e) { warn(`item_colored_icons.json unreadable at ${f}: ${e.message}`); return {}; }
})();

// Icons the game layer uses but the item data never names — gear art, mostly.
// Listed here so the copy step keeps them in step with docs/game.js.
const EXTRA_ICONS = [
  'MH4G-Book_Icon_Yellow.png',    // Book of Combos 5
  // The three Books of Fishing Combos are re-iconed off the game's five: grey,
  // then the light grey its third and fourth wear, then cyan. Only the cyan is a
  // file no real item names, so only the cyan needs listing here.
  'MH4G-Book_Icon_Light_Blue.png',
  // The four rods wear bait icons. Grey, Yellow and Red are the game's own;
  // MH4G-Bait_Icon_White.png is NOT — the family ships no white, so it is
  // generated from the real glyph with the icon set's own white (247,243,246)
  // and the same 100/81/61 shading every other bait variant uses. It is committed
  // rather than rebuilt, so this script must not try to copy it from the source.
  'MH4G-Bait_Icon_Grey.png', 'MH4G-Bait_Icon_Yellow.png', 'MH4G-Bait_Icon_Red.png',
  // Monster parts. These are real items with real icons, but nothing in the
  // FISHING data names them — they are forge stock, defined in game.js — so the
  // copy step cannot discover them and has to be told. Same gap that lost the
  // third Book its icon.
  'MH4G-Scale_Icon_Light_Blue.png',   // Cephalos, Lagiacrus, Zamtrios
  'MH4G-Scale_Icon_Yellow.png',       // R.Ludroth
  'MH4G-Scale_Icon_Blue.png',         // Plesioth
  'MH4G-Scale_Icon_Grey.png',         // Lavasioth
  'MH4G-Scale_Icon_Red.png',          // Agnaktor, Low tier
  'MH4G-Hide_Icon_Brown.png',         // Nibelsnarf
  'MH4G-Hide_Icon_Red.png',           // Agnaktor
];

const wantedIcons = new Set(EXTRA_ICONS);
function iconOf(name) {
  const file = ITEM_ICONS[name];
  if (!file) { warn(`no icon mapped for "${name}"`); return null; }
  wantedIcons.add(file);
  return file;
}

const warnings = [];
const warn = m => { warnings.push(m); };

// ── Kiranico abbreviates locale names; map back to the DB's full names ───────
const FULL_NAME = {
  'A. Ridge': 'Arctic Ridge',
  'A. Steppe': 'Ancestral Steppe',
  'D. Island': 'Deserted Island',
  'F. Seaway': 'Frozen Seaway',
  'J. Frontier': 'Jurassic Frontier',
  'M. Peaks': 'Misty Peaks',
  'V. Hills': 'Verdant Hills',
  'V. Hollow': 'Volcanic Hollow',
};

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

// ── Page parsing ────────────────────────────────────────────────────────────
//
// Each rank's table is a flat <tr> list broken into groups. A group opens with
//   <tr><td rowspan="N" [attrs]>HEADER</td></tr>
// and the following N-1 rows are its items. The header tells you what it is:
//
//   class="text-muted", header carries a quantity (x4-6)  -> GATHERING node, skip
//   header is <small><a>Some Bait</a></small>             -> that bait's pool
//   header is empty                                       -> the no-bait rod pool
//
// Every fishing group's percentages sum to exactly 100. Treating the trailing
// empty group as part of the preceding bait is what made blocks appear to sum
// to 200% — they are two separate pools.

const GROUP = /^<tr><td rowspan="(\d+)"([^>]*)>([\s\S]*?)<\/td><\/tr>$/;
const BAIT_IN_HEADER = /<small><a href="[^"]*\/item\/[^"]*">([^<]+)<\/a><\/small>/;
const ITEM_ROW = /<td[^>]*><a href="[^"]*\/item\/([0-9a-f]+)">([^<]+)<\/a><\/td><td class="text-right">(\d+)%<\/td>/;

const NO_BAIT = 'No Bait';

const unescapeHtml = s => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, String.fromCharCode(39))
  .replace(/&nbsp;/g, ' ');

// Returns BOTH halves of the table. Fishing pools are headed by a bait; the
// gathering, mining and bug nodes are the ones Kiranico greys out with
// text-muted, and their header is a quantity rather than a bait. They were
// skipped outright until the Palicos needed somewhere to gather from — the real
// percentages had been sitting in these files unread the whole time.
function parseRankTable(tableHtml, ctx) {
  const rows = tableHtml.match(/<tr>[\s\S]*?<\/tr>/g) || [];
  const pools = [];
  const gathers = [];
  let i = 0;
  while (i < rows.length) {
    const m = rows[i].match(GROUP);
    if (!m) { i++; continue; }            // stray row outside any group
    const span = Number(m[1]);
    const attrs = m[2];
    const header = m[3];
    const items = rows.slice(i + 1, i + span);
    i += span;

    // A gathering node: keep it, with the quantity its header states.
    if (/text-muted/.test(attrs)) {
      const qty = header.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const got = [];
      for (const row of items) {
        const r = row.match(ITEM_ROW);
        if (r) got.push({ name: unescapeHtml(r[2]), pct: Number(r[3]) });
      }
      if (got.length) gathers.push({ qty, entries: got });
      continue;
    }

    const baitMatch = header.match(BAIT_IN_HEADER);
    const bait = baitMatch ? unescapeHtml(baitMatch[1])
      : (header.trim() === '' ? NO_BAIT : null);
    if (bait === null) {
      warn(`${ctx}: unrecognised group header ${JSON.stringify(header.slice(0, 80))}`);
      continue;
    }

    const entries = [];
    for (const row of items) {
      const r = row.match(ITEM_ROW);
      if (!r) { warn(`${ctx} [${bait}]: unparsed row ${JSON.stringify(row.slice(0, 90))}`); continue; }
      entries.push({ name: unescapeHtml(r[2]), pct: Number(r[3]) });
    }
    if (!entries.length) continue;

    const total = entries.reduce((a, e) => a + e.pct, 0);
    if (total !== 100) warn(`${ctx} [${bait}]: percentages sum to ${total}, not 100`);

    pools.push({ bait, entries });
  }
  return { pools, gathers };
}

function parseLocalePage(file) {
  const short = file.split(' - MHGU')[0];
  const name = FULL_NAME[short] || short;
  // Collapse whitespace between tags. Kiranico pretty-prints its markup, so a
  // newline between a fish cell and its percent cell would otherwise defeat the
  // row regex. Text inside a tag is untouched, so gathering headers still read.
  const html = readFileSync(join(SRC, file), 'utf8').replace(/>\s+</g, '><');

  const areas = {};
  const gather = {};                       // rank -> the locale's gathering nodes
  const byArea = html.split(/<h4>Area(\d+)<\/h4>/);
  for (let a = 1; a < byArea.length; a += 2) {
    const area = Number(byArea[a]);
    const byRank = byArea[a + 1].split(/<h5>(Low|High|G) Rank<\/h5>/);
    for (let r = 1; r < byRank.length; r += 2) {
      const rank = byRank[r];
      const table = byRank[r + 1].split('</table>')[0];
      const { pools, gathers } = parseRankTable(table, `${name} Area${area} ${rank}`);
      if (gathers.length) {
        gather[rank] ??= [];
        gather[rank].push(...gathers);
      }
      if (!pools.length) continue;
      areas[area] ??= {};
      areas[area][rank] = pools;
    }
  }
  return { name, areas, gather };
}

// ── Meals ───────────────────────────────────────────────────────────────────
//
// data-src/meals.html is Kiranico's Meal List. Same rowspan-group idiom as the
// locale pages: a name row opens the group, then one row for Hunter and one for
// Palico. Columns after the label are HP, Stamina, Attack, Defense, and the five
// resistances; only HP and Stamina mean anything to an angler.
//
// This is why meals did not need a RomFS decode. The kitchen tables are in the
// dump but the dump has no eng/ directory, so the numbers were reachable and the
// names were not. Kiranico has both.

function parseMeals() {
  const html = readFileSync(join(REPO, 'data-src', 'meals.html'), 'utf8')
    .replace(/>\s+</g, '><');
  const rows = html.match(/<tr>[\s\S]*?<\/tr>/g) || [];
  const text = h => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const numOf = v => (v === '-' || v === '') ? 0 : Number(v.replace('+', '')) || 0;

  const out = [];
  let name = null;
  for (const row of rows) {
    const head = row.match(/^<tr><td rowspan="\d+"[^>]*><div>([\s\S]*?)<\/div><\/td><\/tr>$/);
    if (head) { name = text(head[1]); continue; }
    if (!name) continue;
    const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || []).map(text);
    if (cells[0] !== 'Hunter') continue;
    const hp = numOf(cells[1]), stamina = numOf(cells[2]);
    out.push({ id: slug(name), name, hp, stamina });
    name = null;
  }
  const seen = new Set();
  return out.filter(m => !seen.has(m.id) && seen.add(m.id))
    .sort((a, b) => (a.hp + a.stamina) - (b.hp + b.stamina) || a.name.localeCompare(b.name));
}

// ── Canteen ─────────────────────────────────────────────────────────────────
//
// data-src/canteen.html is the wiki's Canteen page. It carries the two things the
// other sources do not: what each ingredient unlocks from, and the 92 recipes as
// ingredient pairs. It corroborates the game's own table exactly — 45 ingredients
// against kitchenListMenu.kcm's 45 indices, and 92 recipes against its 92 meals
// that carry a pair — which is why it is trusted here.
//
// Rank mapping, decided rather than derived:
//   Village 1-6 Low, 7-10 High.  Hub 1-3 Low, 4-7 High.  Any G star is G Rank.
//   Ingredients unlocked outside the quest ladder (five trade requests and
//   "Speak to Harth Chief") are DROPPED along with the recipes needing them —
//   there is enough redundancy that nothing unique is lost.

const HTML_CELL = h => h.replace(/<[^>]+>/g, '').replace(/&#160;/g, ' ')
  .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// Rowspan-aware: a cell spanning N rows refills its column on the next N-1.
function parseTable(tbl) {
  const rows = [];
  const pending = new Map();
  for (const tr of tbl.match(/<tr[\s\S]*?<\/tr>/g) || []) {
    const out = [];
    let ci = 0;
    const drain = () => {
      while (pending.has(ci)) {
        const e = pending.get(ci);
        out.push(e.text);
        if (--e.left === 0) pending.delete(ci);
        ci++;
      }
    };
    drain();
    for (const m of tr.matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/g)) {
      const text = HTML_CELL(m[2]);
      const span = Number((m[1].match(/rowspan="?(\d+)/) || [])[1] || 1);
      out.push(text);
      if (span > 1) pending.set(ci, { text, left: span - 1 });
      ci++;
      drain();
    }
    if (out.length) rows.push(out);
  }
  return rows;
}

function rankOfUnlock(u) {
  if (u === 'Default') return 'Low';
  const m = u.match(/Complete (G?)(\d+)★ (Village|Hub) Quest/);
  if (!m) return null;                                   // outside the quest ladder
  if (m[1]) return 'G';
  const n = Number(m[2]);
  return m[3] === 'Village' ? (n <= 6 ? 'Low' : 'High') : (n <= 3 ? 'Low' : 'High');
}

function parseCanteen() {
  const html = readFileSync(join(REPO, 'data-src', 'canteen.html'), 'utf8');
  const tables = html.match(/<table[\s\S]*?<\/table>/g) || [];
  if (tables.length < 3) { warn('canteen.html: expected 3 tables'); return null; }

  const ingredients = [];
  const dropped = [];
  for (const r of parseTable(tables[0])) {
    if (r.length < 3 || r[0] === 'Group') continue;
    const [group, name, unlock] = r;
    const rank = rankOfUnlock(unlock);
    if (rank === null) { dropped.push({ name, unlock }); continue; }
    ingredients.push({ id: slug(name), name, group, rank, unlock });
  }

  const gone = new Set(dropped.map(d => d.name));
  const known = new Set(ingredients.map(i => i.id));

  // The recipe table and the ingredient table are typed out separately on the
  // wiki, so a name can be spelled one way in one and another way in the other.
  // "Cather Flying Fish" appears once against "Cathar Flying Fish" twice, and
  // slugging both literally left a recipe pointing at an ingredient that does not
  // exist — which silently made that dish impossible to ever cook. Resolve by
  // slug, and where that misses, fall back to the closest ingredient by edit
  // distance so a one-character typo repairs itself.
  const dist = (a, b) => {
    const m = a.length, n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++)
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  };
  const repaired = [];
  const resolve = (name, dish) => {
    const id = slug(name);
    if (known.has(id)) return id;
    let best = null, bestD = Infinity;
    for (const k of known) { const d = dist(id, k); if (d < bestD) { bestD = d; best = k; } }
    if (best && bestD <= 2) { repaired.push(`${dish}: "${name}" -> ${best}`); return best; }
    return id;                       // leave it; the check below will shout
  };

  const recipes = [];
  const lostRecipes = [];
  for (const r of parseTable(tables[2])) {
    if (r.length < 4 || r[0] === 'Ingredient 1') continue;
    const [a, b, dish, effect] = r;
    if (gone.has(a) || gone.has(b)) { lostRecipes.push(dish); continue; }
    recipes.push({ a: resolve(a, dish), b: resolve(b, dish), dish, effect });
  }
  // A recipe pointing at nothing is a dish no player can ever cook, so it is a
  // build error rather than a curiosity.
  for (const r of recipes)
    for (const side of ['a', 'b'])
      if (!known.has(r[side])) warn(`recipe "${r.dish}" wants unknown ingredient "${r[side]}"`);

  return { ingredients, recipes, dropped, lostRecipes, repaired };
}

// ── Hub quest gating ────────────────────────────────────────────────────────
//
// data-src/hub-quests.html is Kiranico's Quest List. Its tab panes are id'd
// s<group>-<star>; group s1 is the Hub, panes 1-7 are Hub stars and 11-14 are
// G1-G4. A locale unlocks at the FIRST Hub star that runs a quest there, which
// is closer to how the game opens up than reading it off the fishing tables.
//
// Star to rank follows the mapping already used for ingredients:
//   Hub 1-3 -> Low,  Hub 4-7 -> High,  any G star -> G.
// A locale no Hub quest ever visits is marked 'Gplus' — it is not on the Hub
// ladder at all, so it cannot sit anywhere on it.

const KIRA_LOCALE = [
  'J. Frontier', 'V. Hills', 'A. Ridge', 'M. Peaks', 'Dunes', 'D. Island', 'Marshlands',
  'Volcano', 'A. Steppe', 'V. Hollow', 'Primal Forest', 'F. Seaway', 'Desert', 'Jungle',
  'Ruined Pinnacle', 'Arena', 'V. Slayground', 'F. Slayground', 'Sanctuary',
  'Forlorn Arena', 'Sacred Pinnacle', 'Ingle Isle', 'Polar Field', "Wyvern's End",
  'Castle Schrade', 'Fortress', 'Forlorn Citadel',
];
// Kiranico abbreviates; the DB does not.
const KIRA_TO_DB = {
  'J. Frontier': 'Jurassic Frontier', 'V. Hills': 'Verdant Hills', 'A. Ridge': 'Arctic Ridge',
  'M. Peaks': 'Misty Peaks', 'D. Island': 'Deserted Island', 'A. Steppe': 'Ancestral Steppe',
  'V. Hollow': 'Volcanic Hollow', 'F. Seaway': 'Frozen Seaway',
};

function parseHubGating() {
  const html = readFileSync(join(REPO, 'data-src', 'hub-quests.html'), 'utf8')
    .replace(/>\s+</g, '><');

  // Slice each s1-* pane out of the tab content.
  const panes = new Map();
  for (const m of html.matchAll(/id="(s1-\d+)"[^>]*role="tabpanel"[^>]*>/g)) {
    const from = m.index + m[0].length;
    const rest = html.slice(from);
    const next = rest.search(/<div[^>]*role="tabpanel"/);
    panes.set(m[1], next >= 0 ? rest.slice(0, next) : rest);
  }

  const rankOfStar = n => (n >= 11 ? 'G' : n <= 3 ? 'Low' : 'High');
  const order = [1, 2, 3, 4, 5, 6, 7, 11, 12, 13, 14];
  const firstStar = new Map();

  for (const n of order) {
    const body = panes.get(`s1-${n}`);
    if (!body) { warn(`hub-quests.html: pane s1-${n} missing`); continue; }
    for (const tr of body.match(/<tr[\s\S]*?<\/tr>/g) || []) {
      const first = (tr.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/) || [])[1];
      if (!first) continue;
      const head = HTML_CELL(first);
      // The cell is a quest-type prefix glued to the locale, e.g. "UrgentHuntDunes".
      const loc = KIRA_LOCALE.find(L => head.endsWith(L));
      if (loc && !firstStar.has(loc)) firstStar.set(loc, n);
    }
  }

  const out = {};
  for (const L of KIRA_LOCALE) {
    const name = KIRA_TO_DB[L] || L;
    const star = firstStar.get(L);
    out[name] = star ? { star: star >= 11 ? `G${star - 10}` : `Hub ${star}`, rank: rankOfStar(star) }
      : { star: null, rank: 'Gplus' };
  }
  return out;
}

// ── Parse every page ────────────────────────────────────────────────────────
const files = readdirSync(SRC).filter(f => f.endsWith('.html')).sort();
const parsed = files.map(parseLocalePage);
const meals = parseMeals();
if (!meals.length) warn('meals.html produced no meals');
const canteen = parseCanteen();
const hubGating = parseHubGating();

// ── DB lookups ──────────────────────────────────────────────────────────────
const db = new DatabaseSync(DB_PATH, { readOnly: true });
const q = (sql) => db.prepare(sql).all();

const COLOR = {
  0: 'White', 1: 'Red', 2: 'Green', 3: 'Blue', 4: 'Yellow', 5: 'Purple',
  6: 'Light Blue', 7: 'Orange', 8: 'Pink', 9: 'Black', 10: 'Grey', 11: 'Cyan',
};
const iconFor = (kind, colorId) =>
  `MH4G-${kind}_Icon_${(COLOR[colorId] || 'Grey').replace(/ /g, '_')}.png`;

// icon_fish is an ICON, not a category, and the items wearing it are a mixed bag:
// real fish, cooked food (Burnt Fish is "a fish burnt to a crisp", Rare Fish is
// "lightly braised", Gourmet Fish is a heal item) and one crystal.
//
// Rather than hand-judging each one, the roster is defined by the game itself:
// A FISH IS SOMETHING THAT APPEARS IN A REAL FISHING TABLE. The 15 saved pages
// cover every gathering locale at all three ranks, so anything fishable in MHGU
// turns up in them. Everything else is dropped, whatever its icon says.
//
// This keeps one genuine oddity that a hand-list would have thrown out: Premium
// Sashimi is plainly prepared food, but the game really does let you fish it up
// in Verdant Hills, so it stays.
const NOT_ACTUALLY_FISH = new Set([
  'Sunmarge Crystal',   // a crystal that happens to be fish-shaped
]);

const itemRows = q(`SELECT _id, name, rarity, buy, sell, description, icon_name, icon_color
                    FROM items WHERE icon_name IN ('icon_fish','icon_bait')`)
  .filter(r => !NOT_ACTUALLY_FISH.has(r.name));
const byName = new Map(itemRows.map(r => [r.name, r]));

// Every fish named anywhere in the pages, and the earliest rank each shows up at.
// That rank is what gates the fish in-game, so it is fact worth carrying, not a
// balance decision.
const caughtNames = new Set();
const RANK_ORDER = ['Low', 'High', 'G'];
const firstRankOf = new Map();
for (const loc of parsed)
  for (const area of Object.values(loc.areas))
    for (const [rank, pools] of Object.entries(area))
      for (const p of pools)
        for (const e of p.entries) {
          caughtNames.add(e.name);
          const seen = firstRankOf.get(e.name);
          if (!seen || RANK_ORDER.indexOf(rank) < RANK_ORDER.indexOf(seen))
            firstRankOf.set(e.name, rank);
        }

const fishIconItems = itemRows.filter(r => r.icon_name === 'icon_fish');
const dropped = fishIconItems.filter(r => !caughtNames.has(r.name)).map(r => r.name);

const fish = fishIconItems
  .filter(r => caughtNames.has(r.name))       // see NOT_ACTUALLY_FISH above
  .map(r => ({
    id: slug(r.name), gid: r._id, name: r.name,
    rarity: r.rarity, sell: r.sell, color: COLOR[r.icon_color] || 'Grey',
    icon: iconFor('Fish', r.icon_color),
    firstRank: firstRankOf.get(r.name),     // earliest rank this fish appears at
  }))
  .sort((a, b) => a.rarity - b.rarity || a.name.localeCompare(b.name));

for (const n of caughtNames) if (!byName.has(n)) warn(`fish "${n}" has no row in mhgu.db`);

const baits = itemRows
  .filter(r => r.icon_name === 'icon_bait')
  .map(r => ({
    id: slug(r.name), gid: r._id, name: r.name,
    rarity: r.rarity, buy: r.buy, sell: r.sell,
    color: COLOR[r.icon_color] || 'Grey',
    icon: iconOf(r.name),
    desc: r.description || '',
  }))
  .sort((a, b) => a.rarity - b.rarity || a.name.localeCompare(b.name));

// Prep items — each one's role is taken from its own in-game description.
const PREP_ROLE = {
  272: 'heal', 1716: 'heal', 9: 'heal', 10: 'heal', 28: 'heal', 29: 'heal',
  1718: 'stamina', 49: 'stamina', 50: 'stamina', 30: 'stamina',
  15: 'endure', 16: 'endure',
  23: 'cool', 24: 'hot',
  20: 'defence', 21: 'defence',       // Armorskin, Mega Armorskin
  52: 'chill', 53: 'warm',            // Chilled Meat, Hot Meat
};
const PREP_IDS = Object.keys(PREP_ROLE).join(',');
const prep = q(`SELECT _id, name, rarity, buy, sell, description, icon_name, icon_color
                FROM items WHERE _id IN (${PREP_IDS})`)
  .map(r => ({
    id: slug(r.name), gid: r._id, name: r.name, role: PREP_ROLE[r._id],
    rarity: r.rarity, buy: r.buy, sell: r.sell,
    color: COLOR[r.icon_color] || 'Grey', desc: r.description || '',
    icon: iconOf(r.name),
  }))
  .sort((a, b) => a.buy - b.buy || a.name.localeCompare(b.name));

// Combine materials — the real items every bait recipe is made from. Which
// material makes which bait is INVENTED and lives in docs/game.js; this is only
// the transcription of the items themselves, so their names, prices, rarities
// and icons are the game's own. Twelve ores (an ore bait is ground from its own
// ore) and nine bugs. Mega Fishing Fly is already in `baits` above — it is the
// one material the shop sells outright and every recipe consumes.
const MATERIAL_NAMES = [
  // The twelve ores, one per variety bait.
  'Iron Ore', 'Earth Crystal', 'Machalite Ore', 'Dragonite Ore', 'Carbalite Ore',
  'Fucium Ore', 'Lightcrystal', 'Firecell Stone', 'Eltalite Ore', 'Allfire Stone',
  'Purecrystal', 'Ultimas Crystal',
  // The three bases, all sold at the shop. Insect Husk is both a base and the
  // modifier in one recipe, which is fine — a pair is what identifies a combo,
  // and "Insect Husk + Sleep Herb" is not "Mega Fishing Fly + Insect Husk".
  'Insect Husk', 'Worm',
  // One modifier per species bait, every one gatherable in four locales or more.
  'Huskberry', 'Flashbug', 'Choice Mushroom', 'Whetstone', 'Sleep Herb',
  'Nitroshroom', 'Bitterbug', 'Needleberry', 'Bomberry', 'Scatternut',
  'Unique Mushroom', 'Gold Cricket', 'Honey', 'Paintberry', 'Stinkhopper',
  'Silver Cricket', 'Mopeshroom', 'King Scarab', 'Divine Rhino',
];
const matList = MATERIAL_NAMES.map(n => "'" + n.replace(/'/g, "''") + "'").join(',');
// Which kind of node an item comes out of — Bug, Mine or Gather. Taken from the
// game rather than guessed from the name, because "Insect Husk" is a Gather item
// and "Royal Rhino" is a Bug one, and no amount of reading the words tells you.
const siteOf = new Map(q(`SELECT i.name AS name, g.site AS site, COUNT(*) n
                          FROM gathering g JOIN items i ON i._id = g.item_id
                          GROUP BY i.name, g.site ORDER BY n DESC`)
  .reduce((m, r) => (m.has(r.name) ? m : m.set(r.name, r.site)), new Map()));

const materials = q(`SELECT _id, name, rarity, buy, sell, description, icon_name, icon_color
                     FROM items WHERE name IN (${matList})`)
  .map(r => ({
    id: slug(r.name), gid: r._id, name: r.name,
    rarity: r.rarity, buy: r.buy, sell: r.sell,
    site: siteOf.get(r.name) || 'Gather',
    color: COLOR[r.icon_color] || 'Grey', desc: r.description || '',
    icon: iconOf(r.name),
  }))
  .sort((a, b) => a.sell - b.sell || a.name.localeCompare(b.name));
for (const n of MATERIAL_NAMES)
  if (!materials.some(m => m.name === n)) warn(`material "${n}" has no row in mhgu.db`);

// Where each material actually comes from — read off the SAME saved pages the
// fishing tables come from, not out of mhgu.db. The pages are the fuller source:
// they list Snakebee Larva at Volcanic Hollow where the database does not, and
// they carry the percentage on every row.
//
// A few materials appear in no gathering node anywhere. They are quest rewards
// rather than things you pick up; they are kept and flagged, because the
// alternative is a recipe whose material can never reach you.
const materialSources = (() => {
  const out = {};
  const wanted = new Map(materials.map(m => [m.name, m.id]));
  const hits = new Map();                       // id -> Map(locale -> Set(rank))
  for (const p of parsed) {
    for (const [rank, nodes] of Object.entries(p.gather || {}))
      for (const node of nodes)
        for (const e of node.entries) {
          const id = wanted.get(e.name);
          if (!id) continue;
          if (!hits.has(id)) hits.set(id, new Map());
          const byLoc = hits.get(id);
          if (!byLoc.has(p.name)) byLoc.set(p.name, new Set());
          byLoc.get(p.name).add(rank);
        }
  }
  for (const m of materials) {
    const byLoc = hits.get(m.id);
    out[m.id] = byLoc
      ? { locales: [...byLoc.keys()].sort(),
          ranks: [...new Set([...byLoc.values()].flatMap(s => [...s]))] }
      : { locales: [], ranks: [], questReward: true };
  }
  return out;
})();
{
  const gathered = Object.values(materialSources).filter(s => !s.questReward).length;
  console.log(`material sources  ${gathered} gathered, ${materials.length - gathered} quest-reward only`);
  const only = Object.entries(materialSources)
    .filter(([, s]) => s.locales.length === 1)
    .map(([id, s]) => `${id} (${s.locales[0]})`);
  if (only.length) console.log(`  single-locale    ${only.join(', ')}`);
}

// Books of Combos — real items at their real prices. The app offers three of the
// game's five; which three, and what each is worth, is decided in docs/game.js.
const books = q(`SELECT _id, name, rarity, buy, sell, description, icon_name, icon_color
                 FROM items WHERE name LIKE 'Book of Combos%' ORDER BY buy`)
  .map(r => ({
    id: slug(r.name), gid: r._id, name: r.name,
    rarity: r.rarity, buy: r.buy, sell: r.sell,
    color: COLOR[r.icon_color] || 'Grey', desc: r.description || '',
    icon: iconOf(r.name),
  }));

// Locales — all 27, flagged by whether the pages gave them a fishing table.
const dbLocales = q(`SELECT _id, name FROM locations WHERE _id <= 27 ORDER BY _id`);
const gatherCount = new Map(
  q(`SELECT location_id AS id, COUNT(*) AS n FROM gathering GROUP BY location_id`)
    .map(r => [r.id, r.n]));
const parsedByName = new Map(parsed.map(p => [p.name, p]));

// Real monster_habitat data decides where the boss encounters live.
//
// This list had drifted badly: it named only Plesioth and Lavasioth while the
// committed locales.js carried eight, so re-running this script would have
// quietly stripped six monsters' habitats. Every monster the game can fish up
// belongs here, and adding one to game.js means adding it here too.
const FISHABLE = [
  'Cephadrome', 'Royal Ludroth', 'Nibelsnarf', 'Plesioth', 'Zamtrios',
  'Agnaktor', 'Lagiacrus', 'Lavasioth',
  // The crabs and Mizutsune: aquatic enough to be fished rather than traded for.
  'Daimyo Hermitaur', 'Shogun Ceanataur', 'Mizutsune',
];
const habitats = q(`SELECT m.name AS monster, l.name AS locale
                    FROM monster_habitat mh
                    JOIN monsters m ON m._id = mh.monster_id
                    JOIN locations l ON l._id = mh.location_id
                    WHERE m.name IN (${FISHABLE.map(n => "'" + n + "'").join(',')})`);
// Placements that are NOT habitat fact, and are marked so because everything
// else in this file is.
//
// Lavasioth lives only in the Volcano, which sits on no rung of the ladder, so
// on the real data it is unreachable. Raven's reasoning for moving it: it is not
// out of the question for a Lavasioth to move into an area once the volcano
// became more active, given it can reach the place or has some reason to venture
// out of its own. Volcanic Hollow is where it went, and Agnaktor genuinely
// shares it.
//
// This lived only as a hand-edit to the generated file, which is why the first
// regeneration dropped it. Anything invented has to be HERE or it does not
// survive the next run — this list is the sanctioned place for a placement the
// habitat data does not give us.
//
// Nakarkos has NO habitat row in the db at all — it is an arena-only monster, so
// there is nothing to transcribe. Wyvern's End is where the game actually fights
// it, so the placement is faithful even though the data cannot say so.
const EXTRA_HABITAT = [
  ['Lavasioth', 'Volcanic Hollow'],
  ['Nakarkos', "Wyvern's End"],
];

const bossAt = new Map();
for (const h of [...habitats, ...EXTRA_HABITAT.map(([monster, locale]) => ({ monster, locale }))]) {
  if (!bossAt.has(h.locale)) bossAt.set(h.locale, []);
  if (!bossAt.get(h.locale).includes(h.monster)) bossAt.get(h.locale).push(h.monster);
}

// Small monsters that pester an angler. monster_habitat carries nothing for
// class 1, so their placement comes from the quests that actually run at each
// locale — a small monster listed on a Jurassic Frontier quest is a small monster
// you can meet at the Jurassic Frontier. Day and night lists are merged, since
// the app has no time of day.
//
// Anteka are excluded by hand: they are herbivores and do not attack a hunter.
// Everything else on the list does.
const PASSIVE = new Set(['Anteka']);
const pestRows = q(`SELECT l.name AS locale, m.name AS monster, COUNT(*) AS n
                    FROM monster_to_quest mq
                    JOIN monsters m ON m._id = mq.monster_id
                    JOIN quests q ON q._id = mq.quest_id
                    JOIN locations l ON l._id = q.location_id
                    WHERE m.class = 1
                    GROUP BY l.name, m.name`);
const pestsAt = new Map();
for (const r of pestRows) {
  if (PASSIVE.has(r.monster)) continue;
  const base = r.locale.replace(/ \(N\)$/, '');       // merge the night variant
  if (!pestsAt.has(base)) pestsAt.set(base, new Map());
  const m = pestsAt.get(base);
  m.set(r.monster, (m.get(r.monster) || 0) + r.n);
}

const locales = dbLocales.map(l => {
  const p = parsedByName.get(l.name);
  const areas = p ? p.areas : {};
  const gate = hubGating[l.name] || { star: null, rank: 'Gplus' };
  return {
    id: slug(l.name), gid: l._id, name: l.name,
    sourced: !!p,                              // a saved page exists for it
    hasFishing: Object.keys(areas).length > 0, // ...and it defined fishing pools
    // Every gathering, mining and bug node the page lists, by rank, with the
    // game's own percentages. This is what the Palicos work from.
    gather: p ? p.gather : {},
    gatherRows: gatherCount.get(l._id) || 0,
    boss: bossAt.get(l.name) || [],
    // Weighted by how many quests bring them here, so the common pest is common.
    pests: [...(pestsAt.get(l.name) || new Map())]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, w]) => ({ name, w })),
    hubStar: gate.star,                        // first Hub quest run here
    rank: gate.rank,                           // the rank that opens it
    areas,
  };
});

// ── Armor line names ──────────────────────────────────────────
//
// Every large monster gets an armor line, so the names have to come from the
// game rather than from splitting an id on underscores -- that turns Yian Kut-Ku
// into "Yian Kut Ku" and Lao-Shan Lung into "Lao Shan Lung".
//
// Deviants are class 2 and excluded because Raven asked for large monsters only.
// The four Variants are excluded by name: the db files them as class 0 beside
// their base forms, so nothing structural separates them.
const VARIANTS = ['Furious Rajang', 'Savage Deviljho', 'Raging Brachydios', 'Chaotic Gore Magala'];
// Four lines are named for the SPECIES, not the individual -- the pattern Raven
// already set with Cephalos for Cephadrome and Ludroth for Royal Ludroth. The
// crabs follow it because they are the same shape of name.
const LINE_ALIAS = {
  'Cephadrome':        ['cephalos',  'Cephalos'],
  'Royal Ludroth':     ['ludroth',   'Ludroth'],
  'Daimyo Hermitaur':  ['hermitaur', 'Hermitaur'],
  'Shogun Ceanataur':  ['ceanataur', 'Ceanataur'],
};
const armorLineNames = {};
for (const m of q(`SELECT name FROM monsters WHERE class = '0' ORDER BY name`)) {
  if (VARIANTS.includes(m.name)) continue;
  const [id, label] = LINE_ALIAS[m.name] || [slug(m.name), m.name];
  armorLineNames[id] = label;
}

// ── Monster parts for the exchange lines ─────────────────────────────
//
// Sixty of the seventy-one armor lines have no material, so they cannot be
// forged. The marketplace trades for them, and it trades on RARITY, so the parts
// have to come from the game rather than be invented: real names, real rarities.
//
// The ladder the data actually has is r4 / r6 / r8, which maps exactly onto
// Low / High / G, plus r9 on twenty-four G Rank monsters. Nothing above r9
// exists — r10 and r11 in this db are EQUIPMENT rarities, not parts.
//
// One part per tier, chosen as the cheapest non-Scrap at that rarity: that is the
// plain Scale or Hide or Shell rather than the gem, which is what a set is
// actually built out of.
const PART_TIERS = [['Low', 4], ['High', 6], ['G', 8], ['top', 9]];
// The editor already maps every item to its real icon and iconOf registers the
// file for copying, so there is nothing to guess at: a Tigrex Shard gets the
// Tigrex Shard icon rather than a generic scale in a rank colour. Falls back to a
// kind-and-rank guess only where the editor has no mapping.
const partIcon = (name, iconName, rank) => {
  const real = ITEM_ICONS[name];
  if (real) { wantedIcons.add(real); return real; }
  const kind = { icon_scale: 'Scale', icon_hide: 'Hide', icon_shell: 'Shell',
                 icon_carapace: 'Shell', icon_webbing: 'Webbing', icon_web: 'Webbing',
                 icon_husk: 'Husk' }[iconName] || 'Scale';
  const colour = { Low: 'Grey', High: 'Blue', G: 'Red', top: 'White' }[rank] || 'Grey';
  const want = `MH4G-${kind}_Icon_${colour}.png`;
  if (existsSync(join(ICON_OUT, want))) return want;
  return `MH4G-Scale_Icon_${colour}.png`;
};
// Read off hunting_rewards, the db's own monster-to-item link, NOT off the name.
// A monster's parts are frequently not called after it: Cephadrome drops Cephalos
// parts, Royal Ludroth drops "R.Ludroth", Daimyo Hermitaur just "Hermitaur". A
// name prefix missed thirteen lines outright.
//
// Generic drops have to come out — Monster Bone M and Wyvern Tear fall off half
// the roster. Rather than hand-list them, an item counts as a PART only if few
// monsters drop it; anything widely shared is a general material.
const dropCount = new Map();
for (const r of q(`SELECT h.item_id, COUNT(DISTINCT h.monster_id) n
                   FROM hunting_rewards h GROUP BY h.item_id`))
  dropCount.set(r.item_id, r.n);
const SPECIFIC = 3;
// Hide, scale, shell, carapace, webbing, husk: the kinds a set is built from.
// Fang and bone belong here as well as hide and scale — they are what half the
// roster's armor is actually made of, and leaving them out cost a lot of lines
// their Low tier for no reason.
const CORE_PART_ICONS = new Set(['icon_scale', 'icon_hide', 'icon_shell',
                                 'icon_carapace', 'icon_webbing', 'icon_husk',
                                 'icon_fang', 'icon_bone']);
const partPick = db.prepare(`SELECT i._id, i.name, i.icon_name FROM hunting_rewards h
   JOIN items i ON i._id = h.item_id
   JOIN monsters m ON m._id = h.monster_id
   WHERE m.name = ? AND i.rarity = ? AND i.sell > 0
     AND i.name NOT LIKE '%Scrap%' AND i.name NOT LIKE '%Ticket%'
   GROUP BY i._id ORDER BY i.sell ASC`);
const monsterParts = {};
for (const m of q(`SELECT name FROM monsters WHERE class = '0' ORDER BY name`)) {
  if (VARIANTS.includes(m.name)) continue;
  const [id] = LINE_ALIAS[m.name] || [slug(m.name)];
  const tiers = {};
  for (const [rank, rarity] of PART_TIERS) {
    const rows = partPick.all(m.name, String(rarity))
      .filter(r => (dropCount.get(r._id) || 99) <= SPECIFIC);
    // The things armor is made OF, and NOTHING else. Falling back to "cheapest
    // whatever" put an Aqua Sac in the marketplace as a Kecha Wacha part: a real
    // drop, a generic item the combine system already owns, and no kind of
    // material to build a set from. A monster with no proper part at a rarity
    // simply has no tier there.
    const row = rows.find(r => CORE_PART_ICONS.has(r.icon_name));
    if (row) tiers[rank] = { name: row.name, rarity,
                             icon: partIcon(row.name, row.icon_name, rank) };
  }
  if (Object.keys(tiers).length) monsterParts[id] = tiers;
}
db.close();

// ── Emit ────────────────────────────────────────────────────────────────────
const header = (what, from) => `// ${what}
// GENERATED by scripts/build-data.mjs — do not edit by hand.
// Source: ${from}
//
// Transcribed fact only. Invented balance lives in docs/game.js.
`;

writeFileSync(join(OUT, 'fish.js'),
  header('MHGU fish, baits and prep items', 'mhgu.db (items table)') +
  `window.MF_FISH = ${JSON.stringify({ fish, baits, prep, materials, materialSources, books }, null, 2)};\n`);

// Meals with no recipe are the baseline seven; they gate by rank instead, on a
// power ladder, so the strongest meal in the game is not free from cast one.
if (canteen) {
  const cooked = new Set(canteen.recipes.map(r => r.dish));
  const allDishes = new Set([...cooked, ...canteen.lostRecipes]);
  const baseline = meals.filter(m => !allDishes.has(m.name))
    .sort((a, b) => (a.hp + a.stamina) - (b.hp + b.stamina));
  baseline.forEach((m, i) => {
    m.baseline = true;
    m.rank = i < 3 ? 'Low' : i < 5 ? 'High' : 'G';
  });
  for (const m of meals) if (!m.baseline && !cooked.has(m.name)) m.cut = true;
}

writeFileSync(join(OUT, 'canteen.js'),
  header('MHGU canteen — ingredients and the recipes they cook',
    'data-src/canteen.html (Monster Hunter Wiki) + the rank mapping in build-data.mjs') +
  `window.MF_CANTEEN = ${JSON.stringify(canteen
    ? { ingredients: canteen.ingredients, recipes: canteen.recipes }
    : { ingredients: [], recipes: [] }, null, 1)};\n`);

writeFileSync(join(OUT, 'meals.js'),
  header('MHGU meals — Hunter HP and Stamina bonuses',
    'data-src/meals.html (Kiranico Meal List)') +
  `window.MF_MEALS = ${JSON.stringify(meals, null, 1)};
`);


writeFileSync(join(OUT, 'monsterparts.js'),
  header('MHGU monster parts by armor line and rarity',
    'mhgu.db items table — cheapest non-Scrap part at each rarity') +
  `window.MF_MONSTER_PARTS = ${JSON.stringify(monsterParts, null, 1)};
`);

writeFileSync(join(OUT, 'armorlines.js'),
  header('MHGU armor line names — every large monster bar Deviants and Variants',
    'mhgu.db monsters table') +
  `window.MF_ARMOR_LINE_NAMES = ${JSON.stringify(armorLineNames, null, 1)};
`);

writeFileSync(join(OUT, 'locales.js'),
  header('MHGU locales and their real fishing tables',
    'saved Kiranico locale pages in data-src/locales/ + mhgu.db') +
  `window.MF_LOCALES = ${JSON.stringify(locales, null, 1)};\n`);

// ── Copy the icons the data references ──────────────────────────────────────
mkdirSync(ICON_OUT, { recursive: true });
let copied = 0;
for (const file of wantedIcons) {
  const from = join(ICON_SRC, file);
  if (!existsSync(from)) { warn(`icon file missing: ${file}`); continue; }
  copyFileSync(from, join(ICON_OUT, file));
  copied++;
}

// ── Report ──────────────────────────────────────────────────────────────────
let poolCount = 0, rowCount = 0;
const baitsSeen = new Set(), ranksSeen = new Set();
for (const l of locales)
  for (const ranks of Object.values(l.areas))
    for (const [rank, pools] of Object.entries(ranks)) {
      ranksSeen.add(rank);
      for (const p of pools) { poolCount++; rowCount += p.entries.length; baitsSeen.add(p.bait); }
    }

console.log(`pages parsed      ${files.length}`);
console.log(`locales total     ${locales.length}  (with fishing: ${locales.filter(l => l.hasFishing).length})`);
console.log(`fishing pools     ${poolCount}`);
console.log(`fishing rows      ${rowCount}`);
console.log(`ranks             ${[...ranksSeen].join(', ')}`);
console.log(`baits in tables   ${[...baitsSeen].sort().join(', ')}`);
console.log(`fish              ${fish.length} (in real fishing tables)`);
{
  const byRank = {};
  for (const f of fish) (byRank[f.firstRank] ||= []).push(f.name);
  for (const r of RANK_ORDER)
    if (byRank[r]) console.log(`  first at ${r.padEnd(5)} ${byRank[r].length}: ${byRank[r].join(', ')}`);
}
console.log(`  not fish, cut   ${dropped.length}: ${dropped.join(', ')}`);
console.log(`bait items        ${baits.length}`);
console.log(`prep items        ${prep.length}`);
console.log(`item icons        ${copied} of ${wantedIcons.size} copied to docs/assets/ItemIcons/`);
if (canteen) {
  const byRank = {};
  for (const i of canteen.ingredients) byRank[i.rank] = (byRank[i.rank] || 0) + 1;
  console.log(`ingredients       ${canteen.ingredients.length} ` +
    `(Low ${byRank.Low || 0} / High ${byRank.High || 0} / G ${byRank.G || 0})`);
  console.log(`  dropped         ${canteen.dropped.length}: ${canteen.dropped.map(d => d.name).join(', ')}`);
  console.log(`recipes           ${canteen.recipes.length} kept, ${canteen.lostRecipes.length} lost with them`);
  for (const r of canteen.repaired) console.log(`  name repaired   ${r}`);
  const baseline = meals.filter(m => m.baseline);
  console.log(`baseline meals    ${baseline.length}: ` +
    baseline.map(m => `${m.name} (${m.rank})`).join(', '));
  console.log(`cookable meals    ${meals.filter(m => !m.cut && !m.baseline).length}`);
}
{
  const byRank = {};
  for (const l of locales) (byRank[l.rank] ||= []).push(l.name);
  console.log(`hub gating        Low ${(byRank.Low || []).length} / High ${(byRank.High || []).length} / ` +
    `G ${(byRank.G || []).length} / off-ladder ${(byRank.Gplus || []).length}`);
  for (const r of ['Low', 'High', 'G', 'Gplus'])
    if (byRank[r]) console.log(`  ${r.padEnd(6)} ${byRank[r].join(', ')}`);
}
console.log(`meals             ${meals.length}  (HP up to +${Math.max(...meals.map(m => m.hp))}, ` +
  `Stamina up to +${Math.max(...meals.map(m => m.stamina))})`);
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings.slice(0, 40)) console.log('  ! ' + w);
  if (warnings.length > 40) console.log(`  ... and ${warnings.length - 40} more`);
} else {
  console.log('\nno warnings — every fishing pool sums to exactly 100%');
}
