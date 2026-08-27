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

  const SHIPPED = JSON.parse(JSON.stringify(G.ARMOR_LINES));
  let lines = JSON.parse(JSON.stringify(G.ARMOR_LINES));

  const lineIds = Object.keys(lines);
  const effectKeys = Object.keys(G.EFFECTS);

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
      const e = G.EFFECTS[key];
      const lv = used[key];
      const need = lv ? Math.max(...lv) : 0;
      // Levels 1 and 3 with no 2 is the deliberate two-tier shape, not a gap.
      const twoStep = lv && [...lv].sort().join(',') === '1,3';
      const short = need > e.tiers.length && !twoStep;
      const cls = !lv ? ' unused' : (short ? ' short' : '');
      return `<div class="chip${cls}" draggable="true" data-key="${key}">`
        + `<span>${e.tiers[0]}</span>`
        + `<small>${lv ? 'lv ' + [...lv].sort().join('/') : 'unused'} &middot; ${e.tiers.length}&nbsp;names</small></div>`;
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
            const e = key && G.EFFECTS[key];
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

    const orphans = effectKeys.filter(k => !used[k]);
    if (orphans.length)
      notes.push(['bad', `Carried by nothing, so never appears in the game: `
        + orphans.map(k => G.EFFECTS[k].tiers[0]).join(', ')]);

    for (const [key, lv] of Object.entries(used)) {
      const e = G.EFFECTS[key];
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
        notes.push(['warn', `${G.EFFECTS[k].tiers[0]} climbs on ${on.length} lines: ${on.join(', ')}.`]);

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
    el('out').textContent = '  const ARMOR_LINES = {\n'
      + '    //           two that climb together        one more at G, level 1\n'
      + body + '\n  };';
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
