// guide.js — the Fish Guide: every fish x every ore, and how much of it you have seen.
//
// A variant is the real MHGU fish icon in its ore's colour. Those tinted icons
// ship with the save editor (mhgu-editor/public/icons/colored) under exactly the
// names game.js's variantIcon() generates, so an ore variant is a real asset
// rather than a CSS filter over one shape.

(function () {
  const G = window.MF_GAME;
  const A = window.MF_APP;

  // The variant's icon: the game's own fish icon, in the ore's colour.
  function fishImg(ore, size = 28, alt = '') {
    return `<img src="assets/FishIcons/${G.variantIcon(ore)}" width="${size}" height="${size}"` +
      ` alt="${alt}" loading="lazy">`;
  }

  function render() {
    const grid = document.getElementById('guideGrid');
    const caught = A.state.caught;
    const hr = A.state.hr;
    const allOres = window.CF_ORES.list;

    // Nothing is shown before you could have caught it. A fish appears at the
    // rank it first swims at, a variety at its ore's rank, so the grid grows in
    // both directions as you climb rather than sitting there as a wall of grey.
    const ores = allOres.filter(o => hr >= G.oreUnlockHR(o));
    const fish = window.MF_FISH.fish.filter(f => hr >= G.fishUnlockHR(f));

    grid.innerHTML = fish.map(f => {
      const cells = ores.map(o => {
        const id = G.variantId(f, o);
        const n = caught[id] || 0;
        const name = G.variantName(f, o);
        return `<div class="variant ${n ? 'caught' : ''}" title="${name}${n ? ` — caught ${n}` : ' — not yet caught'}">
          ${fishImg(o, 30, name)}
          <span class="vn">${G.ORE_PREFIX[o.id]}</span>
        </div>`;
      }).join('');
      const have = ores.filter(o => caught[G.variantId(f, o)]).length;
      return `<section class="panel guide-row">
        <h3 class="panel-head">${f.name}
          <span class="r">Rarity ${f.rarity}</span>
          <span class="cnt">${have} / ${ores.length}</span>
        </h3>
        <div class="panel-body"><div class="variants">${cells}</div></div>
      </section>`;
    }).join('');

    // The bar tracks the whole guide, because that is the goal. The reachable
    // count sits beside it so a small grid does not read as a broken one.
    const total = A.guideTotal(), found = A.guideFound();
    const reachable = fish.length * ores.length;
    document.getElementById('guideCount').textContent = `${found} / ${total}`;
    document.getElementById('guideFill').style.width = (100 * found / total) + '%';
    const note = document.getElementById('guideReach');
    if (note) note.textContent = reachable < total
      ? `${reachable} reachable at HR ${hr}`
      : 'all reachable';
  }

  // Locked varieties are laid out on a fixed 12 columns so the grid does not
  // reflow into a different shape every time a rank opens.
  // ── Pantry ────────────────────────────────────────────────────────────────
  // The other collection: 39 ingredients, found while fishing rather than bought.
  // Locked ranks are hidden like everything else, so the shelf fills as you climb.
  const GROUP_ORDER = ['Meat', 'Vegetables', 'Fish', 'Alcohol'];

  function renderPantry() {
    const wrap = document.getElementById('pantryGrid');
    if (!wrap) return;
    const held = A.state.pantry, hr = A.state.hr;
    const all = (window.MF_CANTEEN || { ingredients: [] }).ingredients;
    const shown = all.filter(i => hr >= G.RANK_HR[i.rank]);

    const byGroup = new Map();
    for (const i of shown) {
      if (!byGroup.has(i.group)) byGroup.set(i.group, []);
      byGroup.get(i.group).push(i);
    }
    // A list rather than a chip cloud: 39 names read far better in a column, and
    // it leaves room to say which rank each one starts turning up at.
    const RANK_LABEL = { Low: 'Low Rank', High: 'High Rank', G: 'G Rank' };
    wrap.innerHTML = GROUP_ORDER.filter(g => byGroup.has(g)).map(g => {
      const list = byGroup.get(g);
      const have = list.filter(i => held[i.id]).length;
      const fresh = list.filter(i => G.isFresh(held, i.id)).length;
      return `<section class="panel">
        <h3 class="panel-head">${g}
          <span class="cnt">${fresh ? `${fresh} fresh &middot; ` : ''}${have} / ${list.length}</span></h3>
        <div class="panel-body"><ul class="ingr-list">${
          list.map(i => `<li class="${held[i.id] ? 'have' : ''} ${G.isFresh(held, i.id) ? 'fresh' : ''}">
            <span class="dot"></span>
            <span class="nm">${i.name}${G.isFresh(held, i.id) ? ' <span class="fresh-tag">Fresh</span>' : ''}</span>
            <span class="rk">${RANK_LABEL[i.rank] || i.rank}</span>
          </li>`).join('')
        }</ul></div>
      </section>`;
    }).join('');

    const total = all.length, found = A.pantryCount();
    const c = document.getElementById('pantryCount');
    if (c) c.textContent = `${found} / ${total}`;
    const f = document.getElementById('pantryFill');
    if (f) f.style.width = (100 * found / total) + '%';
  }

  window.MF_GUIDE = { render, renderPantry, fishImg };
})();
