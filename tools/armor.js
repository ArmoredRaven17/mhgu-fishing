// armor.js — the armor bench.
//
// Drag skills onto slots and see what the game would build from it. Nothing here
// writes to the app: it reads the real ARMOR_LINES and EFFECTS, lets you shuffle
// a copy, and prints the block to paste back into game.js.
//
// The checks are the point as much as the dragging is. Two mistakes have already
// been made by hand in this table and both are silent — an effect that no line
// carries simply never appears in the game, and an effect used at level 2 with
// only two names in its ladder shows its level-3 name a rank early. Both are
// listed live under Checks.

(function () {
  const G = window.MF_GAME;
  const el = id => document.getElementById(id);

  // The three places a skill can sit on a line. `third` only ever lands at
  // level 1, and only on the G suit.
  const SLOTS = [
    { key: 'a', label: 'A' },
    { key: 'b', label: 'B' },
    { key: 'third', label: 'Third' },
  ];

  // ── Skills that do not exist yet ──────────────────────────────────────
  //
  // Every one of these fills a mechanic nothing currently reads: monster parts,
  // the strike window, whether large monsters turn up at all, the brace, service
  // costs, XP, and the pool's upper end. They are here to be dragged around and
  // argued with, NOT because the names are settled — naming is Raven's.
  //
  // `real` marks a name that exists in MHGU, checked against the game's own skill
  // list. The rest are invented and say so. Ladder follows the house rule: Base,
  // Base+, then a new name at G.
  const PROPOSED = {
    parts: {
      tiers: ['Carving Pro', 'Carving Pro+', 'Carving Celebrity'], per: 0.34, real: true,
      note: 'Real MHGU skills. A monster sometimes leaves a second part behind. '
          + 'Fills the biggest hole in the set: nothing at all affects part drops, '
          + 'and parts are the whole armor loop.',
      blurbs: ['A monster sometimes leaves an extra part',
               'A monster often leaves an extra part',
               'A monster very often leaves an extra part'],
    },
    control: {
      tiers: ['Light Touch', 'Light Touch+', 'Feather Touch'], per: 0.16, real: false,
      note: 'Invented, and the one genuinely missing REEL skill. Sure Grip widens '
          + 'the target; this makes your adjustments smaller so you can settle '
          + 'inside it. At G Rank one press already moves you 53% of the band, so '
          + 'there is no such thing as a small correction — you overshoot or you '
          + 'sink. Rods only ever raise lift-per-press, never lower it. Note it is '
          + 'not a pure buff: smaller pulls mean pressing more often to outpace '
          + 'the sink, so it trades tempo for precision. MHGU has Recoil Down for '
          + 'exactly this idea if a real name is wanted, though it reads as a gun '
          + 'word on a rod.',
      blurbs: ['Each pull moves the line a little less, for finer control',
               'Each pull moves the line less, for finer control',
               'Each pull moves the line much less, for the finest control'],
    },
    strike: {
      tiers: ['Keen Eye', 'Keen Eye+', 'Hawkeye'], per: 0.2, real: false,
      note: 'Invented. Lengthens the window to strike after a nibble. The only way '
          + 'to lose a fish that no rod, armor or skill can currently help with.',
      blurbs: ['A little longer to strike when a fish bites',
               'Longer to strike when a fish bites',
               'Much longer to strike when a fish bites'],
    },
    lure: {
      tiers: ['Ripple Sense', 'Ripple Sense+', 'Leviathan Caller'], per: 0.25, real: false,
      note: 'Invented. Large monsters check in more often. The counterpart to '
          + "Fisherman's Talisman, which only ever pushed the small ones away.",
      blurbs: ['Large monsters take an interest a little sooner',
               'Large monsters take an interest sooner',
               'Large monsters take an interest much sooner'],
    },
    brace: {
      tiers: ['Evade Extender', 'Evade Extender+', 'Unshakeable'], per: 0.3, real: true,
      note: 'Evade Extender is real and genuinely means "your defensive window '
          + 'lasts longer", which is exactly this. Widens the moment in which a '
          + 'brace counts, so an honest reaction is not punished as a fumble.',
      blurbs: ['A little more leeway when bracing',
               'More leeway when bracing',
               'Much more leeway when bracing'],
    },
    haggle: {
      tiers: ['Fair Dealing', 'Fair Dealing+', "Guildmaster's Word"], per: 0.15, real: false,
      note: 'Invented. Cuts what the hire, the Palicos and the Trade Cart charge. '
          + 'Every money skill is currently yield-side; nothing touches spending.',
      blurbs: ['Services at the dock cost a little less',
               'Services at the dock cost less',
               'Services at the dock cost much less'],
    },
    lesson: {
      tiers: ['Quick Study', 'Quick Study+', 'Old Hand'], per: 0.2, real: false,
      note: 'Invented. More XP from a catch. Nothing reads addXP today, so rank '
          + 'progress is the one currency gear cannot influence.',
      blurbs: ['You learn a little faster from every catch',
               'You learn faster from every catch',
               'You learn much faster from every catch'],
    },
    rich: {
      tiers: ['Prospector', 'Prospector+', 'Ore Sense'], per: 0.18, real: false,
      note: 'Invented. Nudges the ore pool UPWARD. Shock Bobber only ever cuts the '
          + 'bottom off; nothing raises the top.',
      blurbs: ['Better ore varieties turn up a little more often',
               'Better ore varieties turn up more often',
               'Better ore varieties turn up much more often'],
    },
    vigor: {
      tiers: ['Constitution', 'Constitution+', 'Iron Constitution'], per: 0.12, real: true,
      note: 'Constitution is real. Raw HP and Stamina come from the tier and the '
          + 'level today, as bare numbers with no name a player can recognise.',
      blurbs: ['You carry a little more HP and Stamina',
               'You carry more HP and Stamina',
               'You carry much more HP and Stamina'],
    },
  };
  // One table for the bench. The app only knows G.EFFECTS; anything from PROPOSED
  // that ends up placed has to be added there too — the export says so.
  const EFFECTS = { ...G.EFFECTS, ...PROPOSED };
  const isProposed = k => Object.prototype.hasOwnProperty.call(PROPOSED, k);

  const SHIPPED = JSON.parse(JSON.stringify(G.ARMOR_LINES));
  let lines = JSON.parse(JSON.stringify(G.ARMOR_LINES));

  const lineIds = Object.keys(lines);
  const effectKeys = Object.keys(EFFECTS);

  // ── What a given arrangement would produce ────────────────────────────
  //
  // Mirrors the ARMORS builder in game.js: a line runs one tier per rank its
  // monster can be met at, two skills climbing together, plus a third at level 1
  // on the G suit. A line with only two tiers uses levels 1 and 3, skipping the
  // `+` — which is why an effect can be used at level 3 without ever needing a
  // level-2 name.
  function tiersFor(lineId) {
    const boss = Object.values(G.BOSS).find(b => b.line === lineId);
    return ['Low', 'High', 'G'].filter(r =>
      G.MAT_LINES[lineId][r] && (!boss || G.bossMeetableAt(boss.name, r)));
  }

  function build() {
    const out = [];
    for (const id of lineIds) {
      const L = lines[id];
      const ranks = tiersFor(id);
      ranks.forEach((rank, i) => {
        const lvl = ranks.length === 3 ? { Low: 1, High: 2, G: 3 }[rank] : (i === 0 ? 1 : 3);
        const eff = [{ key: L.a, lvl }, { key: L.b, lvl }];
        if (rank === 'G' && L.third) eff.push({ key: L.third, lvl: 1 });
        out.push({ line: id, rank, name: L.name + G.armorSuffix(i, ranks.length), eff });
      });
    }
    return out;
  }

  // Which levels each effect ends up being used at, across every suit.
  function usage() {
    const used = {};
    for (const a of build())
      for (const e of a.eff) (used[e.key] = used[e.key] || new Set()).add(e.lvl);
    return used;
  }

  // ── Palette ───────────────────────────────────────────────────────────
  function renderPal() {
    const used = usage();
    el('pal').innerHTML = effectKeys.map(key => {
      const e = EFFECTS[key];
      const lv = used[key];
      const need = lv ? Math.max(...lv) : 0;
      // Levels 1 and 3 with no 2 is the deliberate two-tier shape, not a gap.
      const twoStep = lv && [...lv].sort().join(',') === '1,3';
      const short = need > e.tiers.length && !twoStep;
      const prop = isProposed(key);
      const cls = (prop ? ' proposed' : '') + (short ? ' short' : (!lv && !prop ? ' unused' : ''));
      const state = lv ? 'lv ' + [...lv].sort().join('/') : (prop ? 'proposal' : 'unused');
      return `<div class="chip${cls}" draggable="true" data-key="${key}"`
        + (prop ? ` title="${e.note.replace(/"/g, '&quot;')}"` : '') + `>`
        + `<span>${e.tiers[0]}${prop ? (e.real ? ' <i>real</i>' : ' <i>new</i>') : ''}</span>`
        + `<small>${state} &middot; ${e.tiers.length}&nbsp;names</small></div>`;
    }).join('');
    for (const c of el('pal').querySelectorAll('.chip')) wireDrag(c, null);
  }

  // ── Lines and slots ───────────────────────────────────────────────────
  function renderLines() {
    el('lines').innerHTML = lineIds.map(id => {
      const L = lines[id];
      const ranks = tiersFor(id);
      return `<div class="line" data-line="${id}">`
        + `<div class="line-name">${L.name}<span>${ranks.length} tier${ranks.length === 1 ? '' : 's'}</span></div>`
        + SLOTS.map(s => {
            const key = L[s.key];
            const e = key && EFFECTS[key];
            return `<div class="slot ${s.key}${e ? '' : ' empty'}" data-line="${id}" data-slot="${s.key}">`
              + `<span class="tag">${s.label}</span>`
              + (e
                  ? `<span class="filled" draggable="true" data-key="${key}" data-from-line="${id}" data-from-slot="${s.key}">${e.tiers[0]}</span>`
                    + `<span class="ladder">${e.tiers.join(' &rarr; ')}</span>`
                  : `<span class="filled">&mdash; empty &mdash;</span>`)
              + `</div>`;
          }).join('')
        + `</div>`;
    }).join('');

    for (const f of el('lines').querySelectorAll('.filled[draggable]'))
      wireDrag(f, { line: f.dataset.fromLine, slot: f.dataset.fromSlot });
    for (const s of el('lines').querySelectorAll('.slot')) wireDrop(s);
  }

  // ── Drag and drop ─────────────────────────────────────────────────────
  //
  // The payload carries where it came FROM as well as what it is, so dropping a
  // slot's skill onto another slot swaps the two rather than duplicating one and
  // leaving a hole.
  let payload = null;

  function wireDrag(node, from) {
    node.addEventListener('dragstart', e => {
      payload = { key: node.dataset.key, from };
      node.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      // Firefox will not start a drag without data set.
      e.dataTransfer.setData('text/plain', node.dataset.key);
    });
    node.addEventListener('dragend', () => {
      node.classList.remove('dragging');
      payload = null;
    });
  }

  function wireDrop(slot) {
    slot.addEventListener('dragover', e => { e.preventDefault(); slot.classList.add('over'); });
    slot.addEventListener('dragleave', () => slot.classList.remove('over'));
    slot.addEventListener('drop', e => {
      e.preventDefault();
      slot.classList.remove('over');
      if (!payload) return;
      const toLine = slot.dataset.line, toSlot = slot.dataset.slot;
      const displaced = lines[toLine][toSlot];
      lines[toLine][toSlot] = payload.key;
      // Came from another slot? Give it whatever it displaced, so a drag between
      // two filled slots is a swap and never loses a skill.
      if (payload.from && !(payload.from.line === toLine && payload.from.slot === toSlot))
        lines[payload.from.line][payload.from.slot] = displaced;
      payload = null;
      renderAll();
    });
  }

  // ── Checks ────────────────────────────────────────────────────────────
  function renderChecks() {
    const used = usage();
    const notes = [];

    // An unplaced PROPOSAL is not an orphan - it does not exist in the game yet.
    const orphans = effectKeys.filter(k => !used[k] && !isProposed(k));
    if (orphans.length)
      notes.push(['bad', `Carried by nothing, so never appears in the game: `
        + orphans.map(k => EFFECTS[k].tiers[0]).join(', ')]);

    for (const [key, lv] of Object.entries(used)) {
      const e = EFFECTS[key];
      const need = Math.max(...lv);
      const twoStep = [...lv].sort().join(',') === '1,3';
      if (need > e.tiers.length && !twoStep)
        notes.push(['bad', `${e.tiers[0]} is used at level ${need} but has only `
          + `${e.tiers.length} names — level ${e.tiers.length} onward would all read `
          + `"${e.tiers[e.tiers.length - 1]}".`]);
      if (need > e.blurbs.length && !twoStep)
        notes.push(['bad', `${e.tiers[0]} is used at level ${need} but has only `
          + `${e.blurbs.length} descriptions.`]);
    }

    // A skill on two climbing lines shows up on a lot of suits; worth seeing,
    // not necessarily wrong.
    const climbCount = {};
    for (const id of lineIds)
      for (const k of [lines[id].a, lines[id].b])
        if (k) (climbCount[k] = climbCount[k] || []).push(lines[id].name);
    for (const [k, on] of Object.entries(climbCount))
      if (on.length > 1)
        notes.push(['warn', `${EFFECTS[k].tiers[0]} climbs on ${on.length} lines: ${on.join(', ')}.`]);

    for (const id of lineIds) {
      const L = lines[id];
      if (L.a && L.a === L.b)
        notes.push(['bad', `${L.name} carries the same skill in both climbing slots.`]);
      if (!L.a || !L.b) notes.push(['bad', `${L.name} has an empty climbing slot.`]);
    }

    if (!notes.length) notes.push(['ok', 'Every skill has a home, and every level it is used at has a name and a description.']);
    el('checks').innerHTML = notes.map(([k, t]) =>
      `<div class="warn ${k === 'bad' ? 'bad' : k === 'ok' ? 'ok' : ''}">${t}</div>`).join('');
  }

  // ── Preview ───────────────────────────────────────────────────────────
  function renderPreview() {
    el('preview').innerHTML = build().map(a =>
      `<div><b>${a.name}</b> <span class="sub">${a.rank}</span> &mdash; `
      + a.eff.map(e => G.effectName(e.key, e.lvl)).join(' + ') + `</div>`).join('');
  }

  // ── Output ────────────────────────────────────────────────────────────
  function renderOut() {
    const pad = (s, n) => (s + "'," + ' '.repeat(40)).slice(0, n);
    const body = lineIds.map(id => {
      const L = lines[id];
      return '    ' + (id + ':').padEnd(12)
        + '{ a: ' + pad("'" + L.a, 14)
        + 'b: ' + pad("'" + L.b, 14)
        + 'third: ' + pad("'" + L.third, 18)
        + "name: '" + L.name + "' },";
    }).join('\n');
    // Anything proposed that got placed needs its EFFECTS entry pasted too, or
    // the block above refers to a skill the game has never heard of.
    const placed = new Set();
    for (const id of lineIds) for (const k of [lines[id].a, lines[id].b, lines[id].third])
      if (k && isProposed(k)) placed.add(k);
    let txt = '  const ARMOR_LINES = {\n'
      + '    //           two that climb together        one more at G, level 1\n'
      + body + '\n  };';
    if (placed.size) {
      txt += '\n\n  // ...and these do not exist yet. Add them to EFFECTS before the block\n'
        + '  // above will build, and wire each one to the mechanic it names.\n';
      for (const k of placed) {
        const e = EFFECTS[k];
        txt += '\n  // ' + e.note + '\n'
          + '  ' + (k + ':').padEnd(11) + '{ tiers: ' + JSON.stringify(e.tiers) + ', per: ' + e.per + ',\n'
          + ' '.repeat(15) + 'blurbs: [' + e.blurbs.map(b => "'" + b + "'").join(',\n' + ' '.repeat(23)) + '] },\n';
      }
    }
    el('out').textContent = txt;
  }

  function renderAll() { renderPal(); renderLines(); renderChecks(); renderPreview(); renderOut(); }

  el('reset').onclick = () => { lines = JSON.parse(JSON.stringify(SHIPPED)); renderAll(); };
  el('copy').onclick = () => {
    navigator.clipboard.writeText(el('out').textContent).then(
      () => { el('copy').textContent = 'Copied'; setTimeout(() => el('copy').textContent = 'Copy ARMOR_LINES', 1200); },
      () => { el('copy').textContent = 'Select it yourself'; });
  };

  renderAll();
})();
