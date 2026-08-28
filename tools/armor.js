// armor.js — the armor bench.
//
// Assign skills to armor PIECES. Eight lines, three ranks, three pieces each, so
// 72 cells; the rank tabs show 24 at a time. A piece holds any number of
// {skill, level} entries and the level is set explicitly rather than inferred
// from rank — that is the whole point of the new shape.
//
// Levels STACK across worn pieces and clamp at CAP, so the number that decides
// whether an arrangement is sane is not what one piece carries but what a whole
// set totals. That is what the totals table is for, and it is the reason this
// exists rather than a spreadsheet.
//
// Nothing here writes to the app. It reads the real EFFECTS and ARMOR_LINES for
// names and ids, and prints a block to paste back into game.js.

(function () {
  const G = window.MF_GAME;
  const el = id => document.getElementById(id);

  const CAP = 5;                                  // stacked skill level ceiling
  const RANKS = ['Low', 'High', 'G'];
  const PIECES = [
    { key: 'helm', label: 'Helm' },
    { key: 'chest', label: 'Chest' },
    { key: 'waist', label: 'Waist' },
  ];

  // Skills that do not exist in the game yet, kept as data so they can be
  // arranged alongside the real ones. The notes that used to sit on these are
  // gone from the data as well as the display — one was long enough to break
  // the grid.
  const PROPOSED = ['parts', 'control', 'strike', 'lure', 'brace',
                    'haggle', 'lesson', 'rich', 'vigor',
                    // one per gathering site: every material in fish.js carries a
                    // `site` of Gather, Bug or Mine, so the three are the game's
                    // own taxonomy rather than categories invented here.
                    'siteGather', 'siteBug', 'siteMine',
                    // and one per remaining tunable nothing reads yet — see the
                    // comments beside each name below for what it moves.
                    'bobber', 'reach', 'hook', 'carry', 'duration',
                    'cats', 'hire', 'fresh', 'bounty', 'salvage', 'basket',
                    // bombs and traps — designed, not built; see MHGU-TASKS.md
                    'blast', 'bruising', 'trapping', 'trapsize'];
  const isProposed = k => PROPOSED.includes(k);

  // WORKING NAMES — one word for the thing the skill affects, nothing more.
  // Raven names these properly once the allotment is settled; until then a label
  // has to read as obviously temporary and never be mistaken for a decision.
  //
  // Only the skills that are a simple dial on one quantity get a generic name.
  // Shock Bobber, Heat Hunter and Guts are left alone: their effects are not
  // "more or less of X" — one indexes a rank band, one is conditional on heat
  // and stacks onto grip, and one is a once-a-trip flag. Genericising those
  // would misdescribe them.
  const SPECIFIC = { cull: 'Shock Bobber', hotblood: 'Heat Hunter', guts: 'Guts' };
  const NAMES = {
    // taking fish without the rod
    blast:    'Blast',       // how wide a bomb reaches
    bruising: 'Bruising',    // value lost to a blast, and to a Shock Trap
    trapping: 'Trapping',    // a trap's odds of catching
    trapsize: 'Capacity',    // how many fish a trap holds for the trip.
                             // Not Carrying, which is pouch and bait slots
    // before the hook — a whole phase with nothing on it today
    bobber:   'Bobber',      // POND.bobberStep / stepCooldownMs / glideRate
    reach:    'Reach',       // POND.attract / attractRange, how far bait pulls
    hook:     'Hooking',     // POND.hookChance, a nibble becoming a bite
    // the reel
    band:     'Sweetspot',   // how wide the sweet spot is
    progress: 'Capture',     // how fast the capture bar fills inside it
    escape:   'Escape',      // how fast the escape bar fills outside it
    control:  'Control',     // how far one press moves the line
    strike:   'Strike',      // how long you have to strike a nibble
    // the water
    bites:    'Bites',       // how eagerly fish take the line
    rich:     'Ore',         // which ore varieties turn up
    lure:     'Lure',        // how soon a large monster checks in
    repel:    'Pests',       // how often small monsters attack
    parts:    'Parts',       // what a monster leaves behind
    // What the Palicos bring back. `gather` is the existing one and lifts the
    // whole haul; the three below each favour one gathering site.
    gather:   'Palicos',     // how much the Palicos bring back at all
    siteGather: 'Gathering', // Huskberry, Honey, Whetstone, the mushrooms, berries
    siteBug:  'Bugs',        // Bitterbug, the crickets, King Scarab, Divine Rhino
    siteMine: 'Mining',      // every ore, crystal and stone
    // the trip
    stamina:  'Stamina',     // what a cast costs
    vigor:    'Vitality',    // how much HP and Stamina you carry
    defense:  'Defense',     // how hard a hit lands
    brace:    'Brace',       // how much leeway a brace allows
    heat:     'Heat',        // heat protection
    cold:     'Cold',        // cold protection
    // what you carry and what it lasts
    carry:    'Carrying',    // POUCH_SLOTS / TACKLE_SLOTS / BAIT_CARRY
    duration: 'Duration',    // DRINK_SECONDS / DASH_SECONDS / ARMOR_SECONDS.
                             // Distinct from Items, which is potency not length
    // who comes with you
    cats:     'Cats',        // PALICO.max, how many you may bring
    hire:     'Hire',        // PEST.hireCut, how much the watch turns away
    fresh:    'Fresh',       // FRESH_CHANCE / FRESH_MAX at camp
    // the ledger
    bounty:   'Bounty',      // BOSS_REWARD_MULT, monster pay only
    basket:   'Basket',      // BASKET.target, fish needed for the bonus
    salvage:  'Salvage',     // what survives a cart — nothing softens that today
    zenny:    'Value',       // what a catch is worth
    trade:    'Trade',       // what the Trade Cart brings back
    haggle:   'Costs',       // what services charge
    saver:    'Saver',       // whether an item is consumed
    effectup: 'Items',       // how much an item does
    combo:    'Combining',   // combine success
    lesson:   'Experience',  // XP per catch
    ...SPECIFIC,
  };
  const nameOf = k => NAMES[k] || k;
  const isSpecific = k => Object.prototype.hasOwnProperty.call(SPECIFIC, k);

  // Every other large monster in MHGU. Their parts are not fished; they come
  // from the Trader, exchanged for parts of the eight that are. Listed by
  // MONSTER name: the armor set's real name often differs (Deviljho's is Vangis,
  // Teostra's is Kaiser) and mapping those is a separate job from skills.
  //
  // Two categories are deliberately absent, and neither is missing by accident:
  //
  //   DEVIANTS — Redhelm Arzuros, Dreadking Rathalos, Hellblade Glavenus and the
  //   other fifteen. They ARE in mhgu.db, in class 2; the roster is built from
  //   class 0, which is what leaves them out. (An earlier comment here claimed
  //   the database had none of them. It has all eighteen.)
  //
  //   VARIANTS — Savage Deviljho, Furious Rajang, Raging Brachydios and Chaotic
  //   Gore Magala. All four out, for now.
  //
  // Subspecies need no filter: MHGU has none. The generation dropped them for
  // Deviants and Hyper states, so Gold Rathian and Silver Rathalos are rare
  // species rather than subspecies, and they stay.
  // [name, floor] — the floor is the lowest rank the set exists at, seeded from
  // the EARLIEST QUEST RANK each monster actually appears at in MHGU. Derived
  // from monster_to_quest joined to quests in mhgu.db, so Fatalis is G and
  // Yian Kut-Ku is Low without anyone deciding it here. Every floor is editable
  // in the grid; these are a starting point, not a rule.
  const EXCHANGE = [
    ['Ahtal-Ka', 'G'], ['Akantor', 'High'], ['Alatreon', 'High'],
    ['Amatsu', 'High'], ['Arzuros', 'Low'], ['Astalos', 'Low'],
    ['Barioth', 'High'], ['Barroth', 'High'], ['Basarios', 'High'],
    ['Blangonga', 'Low'], ['Brachydios', 'Low'], ['Bulldrome', 'Low'],
    ['Chameleos', 'Low'], 
    ['Congalala', 'High'], ['Crimson Fatalis', 'G'],
['Deviljho', 'High'],
    ['Diablos', 'High'], ['Duramboros', 'High'], ['Fatalis', 'G'],
     ['Gammoth', 'Low'], ['Gendrome', 'Low'],
    ['Giadrome', 'High'], ['Glavenus', 'Low'], ['Gold Rathian', 'High'],
    ['Gore Magala', 'Low'], ['Gravios', 'High'], ['Great Maccao', 'Low'],
    ['Gypceros', 'Low'], ['Iodrome', 'Low'], ['Kecha Wacha', 'High'],
    ['Khezu', 'Low'], ['Kirin', 'Low'], ['Kushala Daora', 'Low'],
    ['Lagombi', 'Low'], ['Lao-Shan Lung', 'G'], ['Malfestio', 'Low'],
    ['Najarala', 'Low'], ['Nakarkos', 'Low'],
    ['Nargacuga', 'Low'], ['Nerscylla', 'High'], ['Old Fatalis', 'G'],
     ['Rajang', 'High'], ['Rathalos', 'Low'],
    ['Rathian', 'Low'],  ['Seltas', 'High'],
    ['Seltas Queen', 'High'], ['Seregios', 'Low'],
    ['Shagaru Magala', 'Low'],     ['Silver Rathalos', 'High'], ['Teostra', 'Low'],
    ['Tetsucabra', 'Low'], ['Tigrex', 'Low'], ['Ukanlos', 'High'],
    ['Uragaan', 'Low'], ['Valstrax', 'High'], ['Velocidrome', 'Low'],
    ['Volvidon', 'Low'], ['Yian Garuga', 'Low'], ['Yian Kut-Ku', 'Low'],
    ['Zinogre', 'Low'],
  ];
  const keyOf = n => n.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  // Fishable is decided by having a BOSS entry, not by ARMOR_LINES — a monster
  // can be in the water before anyone has assigned its armor any skills, which
  // is exactly the state the crabs and Mizutsune are in.
  const FISHED = Object.values(G.BOSS).map(b => b.line);
  const NAME = {}, FLOOR = {};
  for (const b of Object.values(G.BOSS)) {
    // The line's display name comes from its material line, which is where the
    // set's real name lives (Daimyo Hermitaur's armor is just "Hermitaur").
    NAME[b.line] = (G.MAT_LINES[b.line] || {}).name || b.name;
    // Those in the water keep the floor the GAME gives them, which is Raven's
    // decision and not the DB's — Zamtrios is Low here on purpose.
    FLOOR[b.line] = b.floor;
  }
  for (const [n, f] of EXCHANGE) { NAME[keyOf(n)] = n; FLOOR[keyOf(n)] = f; }
  const lineIds = [...FISHED, ...EXCHANGE.map(e => keyOf(e[0]))];
  const lineName = id => NAME[id];
  const isFished = id => FISHED.includes(id);
  const rankIndex = r => RANKS.indexOf(r);
  const atOrAbove = (id, r) => rankIndex(r) >= rankIndex(FLOOR[id]);
  let filter = '';
  // How the 71 lines are ordered. 'water' is the default and puts what you can
  // fish at the top, since those are the sets a player reaches first.
  let sortMode = 'water';
  const skillKeys = [...Object.keys(G.EFFECTS), ...PROPOSED];

  // ── The board ─────────────────────────────────────────────────────────
  //
  // board[line][rank][piece] = [{ k, lvl }]   and   setBonus[line] = {k,lvl}|null
  const blank = () => {
    const b = {};
    for (const id of lineIds) {
      b[id] = { setBonus: null };
      for (const r of RANKS) {
        b[id][r] = {};
        for (const p of PIECES) b[id][r][p.key] = [];
      }
    }
    return b;
  };
  // ── Persistence ───────────────────────────────────────────────────────
  //
  // 71 lines x 3 ranks x 3 pieces is far too much work to lose to a reload.
  // Saved on every change, restored on load.
  //
  // The restore MERGES into a fresh blank board rather than replacing it,
  // because the roster moves underneath this file — three monsters joined the
  // water and four Variants left in one afternoon. A saved line that no longer
  // exists is reported and dropped; a line that did not exist when you saved
  // simply comes up empty.
  const KEY = 'mhgu-armor-bench';
  let restoreNote = '';

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 1, board, floors: FLOOR, sort: sortMode }));
    } catch (e) { /* private window, blocked storage — the tool still works */ }
  }

  function load() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
    if (!saved || !saved.board) return null;
    const fresh = blank();
    let placed = 0, dropped = [];
    for (const [id, data] of Object.entries(saved.board)) {
      if (!fresh[id]) { dropped.push(id); continue; }
      for (const r of RANKS)
        for (const p of PIECES) {
          const list = ((data[r] || {})[p.key] || [])
            .filter(e => e && typeof e.k === 'string');
          fresh[id][r][p.key] = list.map(e => ({ k: e.k, lvl: Math.max(1, Math.min(CAP, e.lvl | 0)) }));
          placed += list.length;
        }
      if (data.setBonus) fresh[id].setBonus = { ...data.setBonus };
    }
    for (const [id, f] of Object.entries(saved.floors || {}))
      if (fresh[id] && RANKS.includes(f)) FLOOR[id] = f;
    if (saved.sort && ['water', 'rank', 'name'].includes(saved.sort)) sortMode = saved.sort;
    restoreNote = placed
      ? `Restored ${placed} assignment${placed === 1 ? '' : 's'}`
        + (dropped.length ? ` &middot; dropped ${dropped.length} line${dropped.length === 1 ? '' : 's'} `
           + `no longer in the roster (${dropped.join(', ')})` : '')
      : '';
    return fresh;
  }

  let board = load() || blank();
  let rank = 'Low';

  const cellOf = (line, r, piece) => board[line][r][piece];

  // ── Palette ───────────────────────────────────────────────────────────
  function placedKeys() {
    const seen = new Set();
    for (const id of lineIds) {
      for (const r of RANKS)
        for (const p of PIECES)
          for (const e of cellOf(id, r, p.key)) seen.add(e.k);
      if (board[id].setBonus) seen.add(board[id].setBonus.k);
    }
    return seen;
  }

  function renderPal() {
    const placed = placedKeys();
    el('pal').innerHTML = skillKeys.map(k => {
      const cls = (isProposed(k) ? ' proposed' : '') + (placed.has(k) ? '' : ' unused');
      const tag = isSpecific(k) ? 'own name' : (placed.has(k) ? 'placed' : '&mdash;');
      return `<div class="chip${cls}" draggable="true" data-key="${k}">`
        + `<span>${nameOf(k)}</span>`
        + `<small>${tag}</small></div>`;
    }).join('');
    for (const c of el('pal').querySelectorAll('.chip')) wireDrag(c, null);
  }

  // ── Grid ──────────────────────────────────────────────────────────────
  function entryHTML(e, line, r, piece, i) {
    const at = `data-line="${line}" data-rank="${r}" data-piece="${piece}" data-i="${i}"`;
    return `<div class="ent">`
      + `<span class="nm" draggable="true" data-key="${e.k}" ${at}>${nameOf(e.k)}</span>`
      + `<span class="lv">`
      + `<button data-step="-1" ${at}>&minus;</button><b>${e.lvl}</b>`
      + `<button data-step="1" ${at}>+</button></span>`
      + `<button class="rm" data-rm="1" ${at}>&times;</button></div>`;
  }

  function renderGrid() {
    // Every drop re-renders the whole grid, and the grid lives in its own
    // scroller. Without this, dropping on a line near the bottom would throw you
    // back to the top — which is most of the way back to the problem the
    // scroller was added to fix.
    const scroller = document.querySelector('.grid-scroll');
    const keepScroll = scroller ? scroller.scrollTop : 0;

    const head = `<div class="ghead"></div>`
      + PIECES.map(p => `<div class="ghead">${p.label}</div>`).join('')
      + `<div class="ghead">Set bonus &middot; all three</div>`;

    // 71 lines is a long scroll; the filter is how you reach one and the sort is
    // how you work through them in an order that suits the pass you are making.
    const byName = (a, b) => lineName(a).localeCompare(lineName(b));
    const SORTS = {
      water: (a, b) => (isFished(b) - isFished(a)) || byName(a, b),
      rank:  (a, b) => (rankIndex(FLOOR[a]) - rankIndex(FLOOR[b])) || byName(a, b),
      name:  byName,
    };
    const shown = lineIds
      .filter(id => !filter || lineName(id).toLowerCase().includes(filter))
      .sort(SORTS[sortMode] || SORTS.water);
    const rows = shown.map(id => {
      const open = atOrAbove(id, rank);
      const cells = PIECES.map(p => {
        const list = cellOf(id, rank, p.key);
        // Below the line's floor the set does not exist, so there is nothing to
        // drop onto. Anything already assigned stays visible rather than being
        // silently binned — the checks say it will not export.
        if (!open && !list.length)
          return `<div class="cell ${p.key} shut"><span class="none">&mdash;</span></div>`;
        return `<div class="cell ${p.key}${open ? '' : ' shut'}"`
          + (open ? ` data-line="${id}" data-rank="${rank}" data-piece="${p.key}"` : '')
          + `>`
          + (list.length
              ? list.map((e, i) => entryHTML(e, id, rank, p.key, i)).join('')
              : `<span class="none">drop a skill</span>`)
          + `</div>`;
      }).join('');
      const sb = board[id].setBonus;
      const setCell = `<div class="cell setb" data-line="${id}" data-rank="set" data-piece="set">`
        + (sb ? entryHTML(sb, id, 'set', 'set', 0) : `<span class="none">none</span>`)
        + `</div>`;
      const floorCtl = `<span class="floor">` + RANKS.map(r =>
        `<button data-floor="${r}" data-fline="${id}"`
        + (FLOOR[id] === r ? ' class="on"' : '') + `>`
        + (r === 'High' ? 'H' : r === 'Low' ? 'L' : 'G') + `</button>`).join('') + `</span>`;
      return `<div class="lname${isFished(id) ? ' fished' : ''}">`
        + `<span class="ln">${lineName(id)}</span>${floorCtl}</div>`
        + cells + setCell;
    }).join('');

    el('grid').innerHTML = head + rows;
    if (scroller) scroller.scrollTop = keepScroll;
    el('shownCount').textContent = shown.length + ' of ' + lineIds.length + ' lines';

    // Sorting by rank while changing a floor would jump the row out from under
    // the click, so the sort is applied at render and the floor buttons simply
    // re-render — the row moves once, after the change, which reads as feedback.
    el('grid').querySelectorAll('[data-floor]').forEach(b => b.onclick = () => {
      FLOOR[b.dataset.fline] = b.dataset.floor;
      renderAll();
    });

    for (const n of el('grid').querySelectorAll('.nm[draggable]'))
      wireDrag(n, { line: n.dataset.line, rank: n.dataset.rank,
                    piece: n.dataset.piece, i: +n.dataset.i });
    for (const c of el('grid').querySelectorAll('.cell')) wireDrop(c);

    el('grid').querySelectorAll('[data-step]').forEach(b => b.onclick = () => {
      const t = target(b);
      t.lvl = Math.max(1, Math.min(CAP, t.lvl + Number(b.dataset.step)));
      renderAll();
    });
    el('grid').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
      const d = b.dataset;
      if (d.rank === 'set') board[d.line].setBonus = null;
      else cellOf(d.line, d.rank, d.piece).splice(+d.i, 1);
      renderAll();
    });
  }

  const target = node => {
    const d = node.dataset;
    return d.rank === 'set' ? board[d.line].setBonus : cellOf(d.line, d.rank, d.piece)[+d.i];
  };

  // ── Drag and drop ─────────────────────────────────────────────────────
  //
  // The payload carries where it came from, so dragging an entry between cells
  // MOVES it rather than leaving a copy behind.
  let payload = null;

  function wireDrag(node, from) {
    node.addEventListener('dragstart', e => {
      payload = { key: node.dataset.key, from };
      node.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', node.dataset.key);   // Firefox needs data
    });
    node.addEventListener('dragend', () => { node.classList.remove('dragging'); payload = null; });
  }

  function wireDrop(cell) {
    cell.addEventListener('dragover', e => { e.preventDefault(); cell.classList.add('over'); });
    cell.addEventListener('dragleave', () => cell.classList.remove('over'));
    cell.addEventListener('drop', e => {
      e.preventDefault();
      cell.classList.remove('over');
      if (!payload) return;
      const d = cell.dataset;
      const f = payload.from;
      // Take the level with it when moving; a fresh drop from the palette is 1.
      const lvl = f
        ? (f.rank === 'set' ? board[f.line].setBonus.lvl : cellOf(f.line, f.rank, f.piece)[f.i].lvl)
        : 1;
      if (f) {
        if (f.rank === 'set') board[f.line].setBonus = null;
        else cellOf(f.line, f.rank, f.piece).splice(f.i, 1);
      }
      // The set bonus is a single slot; a piece takes any number.
      if (d.rank === 'set') board[d.line].setBonus = { k: payload.key, lvl };
      else cellOf(d.line, d.rank, d.piece).push({ k: payload.key, lvl });
      payload = null;
      renderAll();
    });
  }

  // ── Totals: what a full set of one line actually grants ───────────────
  //
  // Three pieces of the same line at the SAME rank, plus the set bonus, summed
  // and clamped. A mixed-rank set is legal too, but this is the case that
  // decides whether the numbers are sane.
  function setTotals(line, r) {
    const out = {};
    if (!atOrAbove(line, r)) return out;
    for (const p of PIECES)
      for (const e of cellOf(line, r, p.key)) out[e.k] = (out[e.k] || 0) + e.lvl;
    const sb = board[line].setBonus;
    if (sb) out[sb.k] = (out[sb.k] || 0) + sb.lvl;
    return out;
  }

  function renderTotals() {
    const fmt = tot => Object.entries(tot).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `<span class="${v > CAP ? 'over5' : ''}">${nameOf(k)} ${Math.min(CAP, v)}`
        + (v > CAP ? ` (${v})` : '') + `</span>`).join(', ') || '<span style="opacity:.35">&mdash;</span>';
    el('totals').innerHTML =
      '<tr><th>Line</th>' + RANKS.map(r => `<th>${r}</th>`).join('') + '</tr>'
      + lineIds.map(id => `<tr><td class="n">${lineName(id)}</td>`
          + RANKS.map(r => `<td>${fmt(setTotals(id, r))}</td>`).join('') + '</tr>').join('');
  }

  // ── Checks ────────────────────────────────────────────────────────────
  function renderChecks() {
    const notes = [];
    const placed = placedKeys();

    let filled = 0, cells = 0;
    for (const id of lineIds)
      for (const r of RANKS)
        for (const p of PIECES) { cells++; if (cellOf(id, r, p.key).length) filled++; }

    if (!filled) {
      el('checks').innerHTML = '<div class="warn">Blank slate &mdash; nothing assigned. '
        + 'Drag a skill from the left into a piece. Work is saved in this browser '
        + 'as you go.</div>';
      return;
    }
    if (restoreNote) notes.push(['ok', restoreNote]);

    // The clamp is silent in play, so say it here instead.
    for (const id of lineIds)
      for (const r of RANKS)
        for (const [k, v] of Object.entries(setTotals(id, r)))
          if (v > CAP)
            notes.push(['bad', `${lineName(id)} ${r}: a full set totals ${nameOf(k)} ${v}, `
              + `over the cap of ${CAP} &mdash; ${v - CAP} level${v - CAP === 1 ? '' : 's'} wasted.`]);

    const building = filled < cells;
    if (building) {
      const missing = skillKeys.filter(k => !placed.has(k)).length;
      notes.push(['warn', `${filled} of ${cells} pieces have a skill`
        + (missing ? ` &middot; ${missing} skill${missing === 1 ? '' : 's'} not placed yet` : '')]);
    } else {
      const orphans = skillKeys.filter(k => !placed.has(k));
      if (orphans.length)
        notes.push(['bad', 'Carried by nothing: ' + orphans.map(nameOf).join(', ')]);
    }

    // Raising a floor over existing work is easy to do by accident and the
    // export drops those ranks, so say it rather than losing them quietly.
    for (const id of lineIds)
      for (const r of RANKS) {
        if (atOrAbove(id, r)) continue;
        const n = PIECES.reduce((a, p) => a + cellOf(id, r, p.key).length, 0);
        if (n) notes.push(['bad', `${lineName(id)} is ${FLOOR[id]}+ but has `
          + `${n} skill${n === 1 ? '' : 's'} assigned at ${r} — those will not export.`]);
      }

    // A piece carrying the same skill twice is always a slip, never a plan.
    for (const id of lineIds)
      for (const r of RANKS)
        for (const p of PIECES) {
          const list = cellOf(id, r, p.key);
          const dup = list.map(e => e.k).filter((k, i, a) => a.indexOf(k) !== i);
          if (dup.length)
            notes.push(['bad', `${lineName(id)} ${r} ${p.label} carries `
              + `${nameOf(dup[0])} twice.`]);
        }

    if (!notes.length) notes.push(['ok', 'Every piece has a skill, every skill has a home, '
      + `and no full set goes over ${CAP}.`]);
    el('checks').innerHTML = notes.map(([k, t]) =>
      `<div class="warn ${k === 'bad' ? 'bad' : k === 'ok' ? 'ok' : ''}">${t}</div>`).join('');
  }

  // ── Output ────────────────────────────────────────────────────────────
  function renderOut() {
    const entries = list => '[' + list.map(e => `{ k: '${e.k}', lvl: ${e.lvl} }`).join(', ') + ']';
    const body = lineIds.map(id => {
      // Ranks below the line's floor are not exported at all: that set does
      // not exist there.
      const ranks = RANKS.filter(r => atOrAbove(id, r))
        .map(r => '      ' + (r + ':').padEnd(6) + '{ '
        + PIECES.map(p => `${p.key}: ${entries(cellOf(id, r, p.key))}`).join(', ') + ' },')
        .join('\n');
      const sb = board[id].setBonus;
      return '    ' + id + ': {' + (isFished(id) ? '' : '   // exchange') + '\n'
        + `      floor: '${FLOOR[id]}',\n`
        + ranks + '\n'
        + '      setBonus: ' + (sb ? `{ k: '${sb.k}', lvl: ${sb.lvl} }` : 'null') + ',\n'
        + '    },';
    }).join('\n');
    const used = [...placedKeys()].filter(isProposed);
    let txt = '  const ARMOR_PIECES = {\n' + body + '\n  };';
    if (used.length)
      txt += '\n\n  // Not in EFFECTS yet, add before this will build:\n  // '
        + used.map(k => `${k} (${nameOf(k)})`).join(', ');
    el('out').textContent = txt;
  }

  function renderAll() {
    renderPal(); renderGrid(); renderTotals(); renderChecks(); renderOut();
    save();
  }

  el('sortSegs').addEventListener('click', e => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    sortMode = b.dataset.sort;
    for (const x of el('sortSegs').querySelectorAll('[data-sort]'))
      x.setAttribute('aria-pressed', String(x === b));
    renderAll();
  });

  el('rankSegs').addEventListener('click', e => {
    const b = e.target.closest('[data-rank]');
    if (!b) return;
    rank = b.dataset.rank;
    for (const x of el('rankSegs').querySelectorAll('[data-rank]'))
      x.setAttribute('aria-pressed', String(x === b));
    renderAll();
  });
  el('lineFilter').addEventListener('input', e => {
    filter = e.target.value.trim().toLowerCase();
    renderGrid();
  });
  // Most sets will want the same skills at every rank, differing only in level,
  // so assigning Low three times is busywork. Copies the rank you are looking at
  // onto the others — but never into a rank below a line's floor, where the set
  // does not exist.
  el('applyAll').onclick = () => {
    const others = RANKS.filter(r => r !== rank);
    // Count BEFORE touching anything, so cancelling really cancels.
    const doable = lineIds.filter(id =>
      atOrAbove(id, rank)
      && PIECES.some(p => cellOf(id, rank, p.key).length)
      && others.some(r => atOrAbove(id, r)));
    if (!doable.length) { alert('Nothing on this rank to copy.'); return; }
    if (!confirm(`Copy ${rank} Rank onto the other ranks for ${doable.length} line`
        + `${doable.length === 1 ? '' : 's'}? This replaces whatever is on them.`)) return;
    for (const id of doable)
      for (const r of others) {
        if (!atOrAbove(id, r)) continue;
        for (const p of PIECES)
          board[id][r][p.key] = cellOf(id, rank, p.key).map(e => ({ ...e }));
      }
    renderAll();
  };

  el('clear').onclick = () => {
    if (!confirm('Clear every assignment on every line and rank?')) return;
    board = blank();
    restoreNote = '';
    renderAll();
  };
  el('copy').onclick = () => {
    navigator.clipboard.writeText(el('out').textContent).then(
      () => { el('copy').textContent = 'Copied'; setTimeout(() => el('copy').textContent = 'Copy output', 1200); },
      () => { el('copy').textContent = 'Select it yourself'; });
  };

  renderAll();
})();
