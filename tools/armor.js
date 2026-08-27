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

  // Skills that do not exist in the game yet. Kept as data so they can be
  // arranged alongside the real ones; the notes that used to sit on these are
  // deliberately gone from both the data and the display — one of them was long
  // enough to break the grid.
  //
  // parts   an extra monster part per kill        strike  longer strike window
  // control smaller lift per press, finer reeling lure    monsters check in sooner
  // brace   more leeway when bracing              haggle  cheaper dock services
  // lesson  more XP per catch                     rich    better ore varieties
  // vigor   raw HP and Stamina, with a name
  const PROPOSED = {
    parts:   'Extra Parts',
    control: 'Reel Control',
    strike:  'Strike Window',
    lure:    'Monster Lure',
    brace:   'Brace Leeway',
    haggle:  'Cheaper Services',
    lesson:  'Extra XP',
    rich:    'Better Ore',
    vigor:   'Vigor',
  };
  const isProposed = k => Object.prototype.hasOwnProperty.call(PROPOSED, k);
  // A skill's display name. Shipped skills still carry a tiers[] ladder in
  // game.js; under the new scheme only the base name survives and the level is
  // shown as a number, so the first tier is the name.
  const nameOf = k => (isProposed(k) ? PROPOSED[k] : G.EFFECTS[k].tiers[0]);

  const lineIds = Object.keys(G.ARMOR_LINES);
  const lineName = id => G.ARMOR_LINES[id].name;
  const skillKeys = [...Object.keys(G.EFFECTS), ...Object.keys(PROPOSED)];

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
  let board = blank();
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
      return `<div class="chip${cls}" draggable="true" data-key="${k}">`
        + `<span>${nameOf(k)}</span>`
        + `<small>${placed.has(k) ? 'placed' : '&mdash;'}</small></div>`;
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
    const head = `<div class="ghead"></div>`
      + PIECES.map(p => `<div class="ghead">${p.label}</div>`).join('')
      + `<div class="ghead">Set bonus &middot; all three</div>`;

    const rows = lineIds.map(id => {
      const cells = PIECES.map(p => {
        const list = cellOf(id, rank, p.key);
        return `<div class="cell ${p.key}" data-line="${id}" data-rank="${rank}" data-piece="${p.key}">`
          + (list.length
              ? list.map((e, i) => entryHTML(e, id, rank, p.key, i)).join('')
              : `<span class="none">drop a skill</span>`)
          + `</div>`;
      }).join('');
      const sb = board[id].setBonus;
      const setCell = `<div class="cell setb" data-line="${id}" data-rank="set" data-piece="set">`
        + (sb ? entryHTML(sb, id, 'set', 'set', 0) : `<span class="none">none</span>`)
        + `</div>`;
      return `<div class="lname">${lineName(id)}</div>` + cells + setCell;
    }).join('');

    el('grid').innerHTML = head + rows;

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
        + 'Drag a skill from the left into a piece.</div>';
      return;
    }

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
      const ranks = RANKS.map(r => '      ' + (r + ':').padEnd(6) + '{ '
        + PIECES.map(p => `${p.key}: ${entries(cellOf(id, r, p.key))}`).join(', ') + ' },').join('\n');
      const sb = board[id].setBonus;
      return '    ' + id + ': {\n' + ranks + '\n'
        + '      setBonus: ' + (sb ? `{ k: '${sb.k}', lvl: ${sb.lvl} }` : 'null') + ',\n'
        + '    },';
    }).join('\n');
    const used = [...placedKeys()].filter(isProposed);
    let txt = '  const ARMOR_PIECES = {\n' + body + '\n  };';
    if (used.length)
      txt += '\n\n  // Not in EFFECTS yet, add before this will build:\n  // '
        + used.map(k => `${k} (${PROPOSED[k]})`).join(', ');
    el('out').textContent = txt;
  }

  function renderAll() { renderPal(); renderGrid(); renderTotals(); renderChecks(); renderOut(); }

  el('rankSegs').addEventListener('click', e => {
    const b = e.target.closest('[data-rank]');
    if (!b) return;
    rank = b.dataset.rank;
    for (const x of el('rankSegs').querySelectorAll('[data-rank]'))
      x.setAttribute('aria-pressed', String(x === b));
    renderAll();
  });
  el('clear').onclick = () => { board = blank(); renderAll(); };
  el('copy').onclick = () => {
    navigator.clipboard.writeText(el('out').textContent).then(
      () => { el('copy').textContent = 'Copied'; setTimeout(() => el('copy').textContent = 'Copy output', 1200); },
      () => { el('copy').textContent = 'Select it yourself'; });
  };

  renderAll();
})();
