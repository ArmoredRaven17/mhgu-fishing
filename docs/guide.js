// guide.js — the Fish Guide: every fish x every ore, and how much of it you have seen.
//
// A variant is the real MHGU fish icon in its ore's colour. Those tinted icons
// ship with the save editor (mhgu-editor/public/icons/colored) under exactly the
// names game.js's variantIcon() generates, so an ore variant is a real asset
// rather than a CSS filter over one shape.

(function () {
  const G = window.MF_GAME;
  const A = window.MF_APP;
  const R = window.MF_ROLL;

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
    // count sits beside it so a small grid does not read as a broken one — and
    // says nothing once the whole guide is open, since there is no shortfall left
    // to explain.
    const total = A.guideTotal(), found = A.guideFound();
    const reachable = fish.length * ores.length;
    document.getElementById('guideCount').textContent = `${found} / ${total}`;
    document.getElementById('guideFill').style.width = (100 * found / total) + '%';
    const note = document.getElementById('guideReach');
    if (note) note.textContent = reachable < total
      ? `${reachable} reachable at HR ${hr}`
      : '';
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
            <span class="nm">${held[i.id] ? i.name : '<span class="unknown">?????</span>'}${
              G.isFresh(held, i.id) ? ' <span class="fresh-tag">Fresh</span>' : ''}</span>
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

  // ── Where things came from ────────────────────────────────────────────────
  //
  // A locale you have fished, and which of its species you have actually pulled
  // out of it. The ones you have NOT are listed too — that is the useful half,
  // because it says where to go for a fish you are still missing.
  function renderLocaleCatch() {
    const wrap = document.getElementById('localeCatch');
    if (!wrap) return;
    const fished = A.fishedLocales();

    if (!fished.length) {
      wrap.innerHTML = '<p class="hint">Nothing caught yet. ' +
        'Fish a locale and what you take from it is recorded here.</p>';
      return;
    }

    const byId = new Map(window.MF_FISH.fish.map(f => [f.id, f]));
    const nameOf = f => (byId.get(f) || {}).name || f;
    const RANKS = ['Low', 'High', 'G'];

    wrap.innerHTML = fished.map(id => {
      const loc = R.localeById.get(id);
      if (!loc) return '';
      const got = A.caughtAtLocale(id);
      const perRank = R.speciesByRank(id);
      // A rank's water is only shown once you have fished it. Nothing here may
      // hint at what a rank you have not reached holds — not the species, and
      // not the count, which is why the totals below are built from the shown
      // ranks rather than from the locale's full pool.
      const shown = RANKS.filter(r => perRank[r].length && A.revealedRanks(id)[r]);
      const known = [...new Set(shown.flatMap(r => perRank[r]))];
      const caughtAll = known.filter(f => got[f]);
      // Anything caught here that no SHOWN rank lists — designed pools and old
      // saves can both produce this, so it is kept rather than silently dropped.
      const extra = Object.keys(got).filter(f => !known.includes(f));

      // Counts are per LOCALE, not per rank — the save does not record which rank
      // a fish came from. So they appear exactly once, in the haul, and the rank
      // blocks below are pools rather than tallies.
      const row = f => `<li><span class="nm">${nameOf(f)}</span>` +
        `<span class="n">x${got[f]}</span></li>`;

      // A locale's pool is not a superset of the rank below it — Jurassic Frontier
      // trades Brocadefish for King Brocadefish at High — so each is its own list.
      const blocks = shown.map(r => {
        const list = perRank[r];
        const have = list.filter(f => got[f]).length;
        const chips = list.map(f =>
          `<span class="chip${got[f] ? ' has' : ''}">${nameOf(f)}</span>`).join('');
        return `<div class="rank-catch">
          <h4 class="rank-head">${r} Rank
            <span class="cnt">${have} / ${list.length}</span></h4>
          <div class="chips">${chips}</div>
        </div>`;
      }).join('');

      const total = caughtAll.length + extra.length;
      return `<section class="panel watered" style="--water:${G.waterOf(id)}">
        <h3 class="panel-head">${loc.name}
          <span class="cnt">${total} / ${known.length} species &middot; ${A.caughtTotalAt(id)} caught</span></h3>
        <div class="panel-body">
          <ul class="catch-list">${caughtAll.concat(extra).map(row).join('')}</ul>
          ${blocks}
        </div>
      </section>`;
    }).join('');
  }

  // ── Combine materials ─────────────────────────────────────────────────────
  //
  // What each material makes, and where it comes from. The locales are the
  // game's own gathering data rather than anything designed, so this doubles as
  // the answer to "where do I actually go for Ultimas Crystal" — Volcanic Hollow,
  // and nowhere else.
  //
  // Grouped by what it is rather than by what it costs: ore for the variety
  // baits, bugs for the species ones. A material you hold is lit; one you have
  // never seen still shows its sources, because the whole point of the list is
  // to tell you where to go.
  function renderMaterials() {
    const wrap = document.getElementById('materialGrid');
    if (!wrap) return;
    const S = A.state;
    const src = (window.MF_FISH.materialSources) || {};
    const oreIds = new Set(Object.values(G.ORE_MAT));

    // Grouped by where the thing comes out of the ground, which is the game's own
    // classification rather than anything read off the names: Insect Husk is a
    // Gather item and Royal Rhino is a Bug one, and the words do not tell you.
    // The three bases sit in Misc with everything else you pick up.
    const isOre = m => oreIds.has(m.id);
    const isBug = m => m.site === 'Bug';
    const groups = [
      ['Ore', G.MATERIALS.filter(isOre)],
      ['Insects', G.MATERIALS.filter(m => !isOre(m) && isBug(m))],
      ['Misc', G.MATERIALS.filter(m => !isOre(m) && !isBug(m))],
    ];

    wrap.innerHTML = groups.filter(([, list]) => list.length).map(([label, list]) => {
      const have = list.filter(m => A.matSeen(m.id) || G.isBuyableMat(m.id)).length;
      return `<section class="panel">
        <h3 class="panel-head">${label}
          <span class="cnt">${have} / ${list.length} found</span></h3>
        <div class="panel-body"><ul class="mat-list">${
          list.map(m => {
            const n = S.pouch[m.id] || 0;
            const s = src[m.id] || {};
            // Where, and how often. The figure is the material's share of what a
            // Palico can bring back at that locale and rank — not the raw node
            // percentage, which is a slice of a node mostly full of things the
            // cats ignore. Sorted best first, so the top line is where to go.
            // A material you have never held is not named, and a locale you have
            // never fished does not give up what it holds. You learn the map by
            // walking it, so the page fills in as you go rather than handing you
            // the whole answer at HR1.
            const seen = A.matSeen(m.id) || G.isBuyableMat(m.id);
            const fished = A.everFished();
            const rates = G.isBuyableMat(m.id) ? [] : R.materialShares(m.id);
            const where = G.isBuyableMat(m.id) ? '<span class="shop">Sold at the shop</span>'
              : rates.length
                ? (() => {
                    // Best five, then a count. A material in fifteen locales does
                    // not need fifteen lines — it needs the ones worth the trip.
                    const SHOW = 5;
                    const top = rates.slice(0, SHOW);
                    const rest = rates.length - top.length;
                    return top.map(r => `<span class="at"><b>${fished[r.locale]
                        ? r.locale : '<span class="unknown">????</span>'}</b>` +
                      `<i>${r.rank}</i><em>${(r.share * 100).toFixed(1)}%</em></span>`).join('')
                      + (rest ? `<span class="more">and ${rest} more</span>` : '');
                  })()
                : (s.questReward ? 'Quest reward — the Palicos still find it' : 'Nowhere yet');
            // What it MAKES is not listed here — the Combos tab is the recipe
            // book, and repeating it turned this page into a worse copy of that
            // one. This page answers the other question: where do I get it.
            return `<li class="${n ? 'have' : ''}">
              <img src="assets/ItemIcons/${m.icon}" alt="">
              <div class="minfo">
                <span class="nm">${seen
                  ? m.name : '<span class="unknown">????</span>'}${n ? `<span class="n">x${n}</span>` : ''}</span>
                <div class="src">${where}</div>
              </div>
            </li>`;
          }).join('')
        }</ul></div>
      </section>`;
    }).join('');
  }

  // ── Every recipe you can reach ────────────────────────────────────────────
  //
  // BASE rates only. What the books add is stated once at the top rather than
  // folded into every row: a rate that silently moves with what you happen to
  // own is a number you cannot check anything against, and the books only do
  // anything when they are actually packed anyway.
  //
  // Locked recipes are listed rather than hidden. Knowing a Guardfish Bait needs
  // a Stygian Worm is the point of the page, even at HR1.

  // ── The monster log ───────────────────────────────────────────────────────
  //
  // A list, one line per monster, in the order you meet them — so it reads down
  // the page as a record rather than a wall of cards. Nothing at all is shown
  // about one you have not met: not its name, not its water, not what it pays.
  // Same rule the Materials page follows. A monster you HAVE met shows the lot,
  // because by then you have earned the entry.
  function renderMonsters() {
    const wrap = document.getElementById('monsterGrid');
    if (!wrap) return;
    const RANKS = ['Low', 'High', 'G'];
    const names = Object.keys(G.BOSS);
    const met = names.filter(n => A.monsterMet(n));

    // The special locale has to be admitted here too, or the one monster that
    // lives in exactly one place is the only one whose row cannot say where.
    const localesFor = name => (window.MF_LOCALES || [])
      .filter(l => (l.boss || []).includes(name)
        && (l.hasFishing || G.isSpecialLocale(l.id) || G.SHOW_DESIGNED_LOCALES))
      .map(l => l.name);

    const rows = names.map(name => {
      const b = G.BOSS[name];
      const log = A.monsterLog(name);
      if (!log) {
        return `<tr class="unmet">
          <td class="ic"><img src="assets/MonsterIcons/MHGU-Question_Mark_Icon.webp" alt="" width="28" height="28"></td>
          <td class="nm">????</td>
          <td class="dt" colspan="5"></td></tr>`;
      }
      // Pay and part are quoted for the highest rank you have ACTUALLY met it at.
      // Quoting a G Rank purse for a monster you have only fought at Low would be
      // a promise the water has not made you yet.
      const top = RANKS.filter(r => log.ranks[r]).pop() || b.floor;
      const at = G.bossAt(name, G.RANK_HR[top], null, null);
      const lost = log.met - log.landed;
      const rate = log.met ? Math.round(100 * log.landed / log.met) : 0;
      return `<tr>
        <td class="ic"><img src="assets/MonsterIcons/${b.icon}" alt="" width="28" height="28"></td>
        <td class="nm">${name}</td>
        <td class="dt">${b.note || b.desc}</td>
        <td class="rk">${RANKS.filter(r => log.ranks[r]).join(' &middot; ')}</td>
        <td class="tally"><b>${log.landed}</b> caught <i>/</i> <b>${lost}</b> lost
          <span class="rate">${rate}%</span></td>
        <td class="pr">${at.reward.toLocaleString()}z</td>
        <td class="wh">${localesFor(name).join(' &middot; ') || '&mdash;'}</td></tr>`;
    }).join('');

    wrap.innerHTML = `<section class="panel"><h3 class="panel-head">Monster Log
        <span class="cnt">${met.length} / ${names.length} met</span></h3>
      <div class="panel-body table-wrap">
        <table class="shop-table mon-table"><tbody>${rows}</tbody></table>
      </div></section>`;
  }

  function renderCombos() {
    const wrap = document.getElementById('comboGrid');
    if (!wrap) return;
    const S = A.state;

    // Read as a combo list is normally read: the result, then the two things it
    // is made of. Bait icons carry their own folder, material icons do not.
    const pic = (icon, alt) => `<img src="${icon.includes('/') ? icon : 'assets/ItemIcons/' + icon}" alt="${alt}">`;

    const row = b => {
      const rec = G.comboRecipe(b) || {};
      const base = G.materialById.get(rec.base);
      const mat = G.materialById.get(rec.mod);
      const held = S.pouch[rec.mod] || 0;
      const flies = S.pouch[rec.base] || 0;
      const unlocked = S.hr >= G.baitUnlockHR(b);
      const ready = unlocked && held > 0 && flies > 0;
      const stock = n => n ? `<i class="own">x${n}</i>` : '';
      const hidden = '<span class="ing unknown">????</span>';
      // A material you have never held is ???? here too. The Materials page and
      // this one have to agree — being told the recipe for something you cannot
      // name would give away exactly what that page is withholding.
      const knownMod = A.matSeen(rec.mod) || G.isBuyableMat(rec.mod);
      return `<tr class="${ready ? 'have' : ''} ${unlocked ? '' : 'locked'}">
        <td class="res"><span class="ing">${pic(b.icon, b.name)}<b>${b.name}</b></span></td>
        <td class="op">=</td>
        <td>${unlocked
          ? `<span class="ing">${base ? pic(base.icon, base.name) : ''}${base ? base.name : rec.base}${stock(flies)}</span>`
          : hidden}</td>
        <td class="op">+</td>
        <td>${unlocked && knownMod
          ? `<span class="ing">${mat ? pic(mat.icon, mat.name) : ''}${mat ? mat.name : rec.mod}${stock(held)}</span>`
          : hidden}</td>
        <td class="n">${unlocked ? G.comboBase(b) + '%' : 'HR ' + G.baitUnlockHR(b)}</td>
      </tr>`;
    };

    const groups = [
      ['Species Bait', A.BAITS.filter(b => b.family === 'species')],
      ['Variety Bait', A.BAITS.filter(b => b.family === 'ore')],
    ];
    // No explainer panel above the tables. It told the player the tier system, the
    // three bases and the whole book ladder before they had combined anything —
    // and the recipes underneath already show every one of those things.
    wrap.innerHTML =
      groups.map(([label, list]) => {
        return `<section class="panel">
          <h3 class="panel-head">${label}</h3>
          <div class="panel-body table-wrap"><table class="combo-table"><tbody>${
            [...list].filter(b => S.hr >= G.baitUnlockHR(b))
              .sort((a, b) => G.comboBase(b) - G.comboBase(a)).map(row).join('')
            || '<tr><td class="res" colspan="6">Nothing yet.</td></tr>'
          }</tbody></table></div>
        </section>`;
      }).join('');
  }

  window.MF_GUIDE = { render, renderPantry, renderLocaleCatch, renderMaterials,
                      renderMonsters, renderCombos, fishImg };
})();
