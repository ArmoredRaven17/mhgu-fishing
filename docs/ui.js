// ui.js — screens, shop, upgrades, modal, and the wiring between them.

(function () {
  const G = window.MF_GAME;
  const A = window.MF_APP;
  const el = id => document.getElementById(id);
  const z = n => Math.round(n).toLocaleString() + 'z';

  const SCREENS = ['camp', 'quest', 'guide', 'shop'];
  const TABS = { camp: 'navCamp', guide: 'navGuide', shop: 'navShop' };

  function show(name) {
    for (const s of SCREENS) el(s).classList.toggle('active', s === name);
    for (const [s, tab] of Object.entries(TABS)) el(tab).classList.toggle('active', s === name);
    // The quest is modal by nature — you cannot browse the shop mid-trip.
    const questing = window.MF_QUEST.active;
    for (const tab of Object.values(TABS)) el(tab).disabled = questing && name === 'quest';
    if (name === 'guide') showCollectables(collectView);
    if (name === 'shop') renderShop();
    if (name === 'camp') window.MF_PREP.renderAll();
  }

  function renderHeader() {
    const S = A.state;
    el('hrValue').textContent = S.hr;
    el('rankName').textContent = G.rankAt(S.hr).name;
    el('zenny').textContent = S.zenny.toLocaleString();

    // Below G Rank+ the bar tracks promotion — locales fished at this rank —
    // because that is what actually moves you up. XP only means something once
    // there is nowhere left to be promoted to.
    if (S.hr >= G.MAX_LADDER_HR) {
      const need = A.xpNeeded();
      el('xpFill').style.width = Math.min(100, 100 * S.xp / need) + '%';
      el('xpText').textContent = `${S.xp} / ${need} XP`;
      el('xpText').title = 'Experience toward the next HR';
    } else {
      const done = A.visitedCount(S.hr), total = A.hrTotal(S.hr);
      el('xpFill').style.width = total ? (100 * done / total) + '%' : '100%';
      el('xpText').textContent = `${done} / ${total} locales`;
      const n = G.nextHR(S.hr);
      el('xpText').title = `Complete a quest at every HR ${S.hr} locale to reach ` +
        (n >= G.MAX_LADDER_HR ? 'G Rank+' : `HR ${n}`);
    }
  }

  function refresh() {
    renderHeader();
    if (el('camp').classList.contains('active')) window.MF_PREP.renderAll();
  }

  // ── Shop ──────────────────────────────────────────────────────────────────
  //
  // One table, in the order you spend money: what you keep forever, then what you
  // burn on a trip, then what decides where the fish come from.
  const img = (src, alt) => src ? `<img src="${src}" alt="${alt || ''}">` : '';
  const itemIcon = p => img(p.icon ? `assets/ItemIcons/${p.icon}` : '', p.name);

  // `buys` is one button per amount. Upgrades pass a single unlabelled Buy;
  // anything you stockpile passes 1 / 10 / 99.
  const row = ({ icon = '', name, detail = '', price, have, buys }) => `
    <tr>
      <td class="ic">${icon}</td>
      <td class="nm">${name}</td>
      <td class="dt">${detail}</td>
      <td class="pr">${price}</td>
      <td class="hv">${have}</td>
      <td class="bt"><span class="buys">${buys.map(b =>
        `<button class="btn tiny" ${b.attr} ${b.disabled ? 'disabled' : ''}>${b.label}</button>`
      ).join('')}</span></td>
    </tr>`;

  // The three amounts every stockpiled thing offers. Each buys as many as it can
  // — capped by STOCK_CAP and by your zenny — so a greyed-out button means
  // "none of these would land", not "you cannot afford all of them".
  const BUY_AMOUNTS = [1, 10, G.STOCK_CAP];
  const buyButtons = (attrName, id, can) => BUY_AMOUNTS.map(n => ({
    label: `Buy ${n}`,
    attr: `data-${attrName}="${id}" data-n="${n}"`,
    disabled: can(id, n) === 0,
  }));

  // Say when a stock is full, so a row of dead buttons explains itself.
  const stockLabel = n => n >= G.STOCK_CAP ? `${G.STOCK_CAP} max` : String(n);
  const section = label => `<tr class="sect"><th colspan="6">${label}</th></tr>`;

  // What a provision does, and — only if it was gated — when it opened up. An
  // item available from the start has no unlock worth mentioning.
  function itemDetail(p) {
    const hr = G.itemUnlockHR(p);
    const label = G.effectOf(p.id).label;
    return hr > 1 ? `${label} <span class="unlock">Unlocked at HR ${hr}</span>` : label;
  }

  function renderShop() {
    const S = A.state;
    const rows = [];

    rows.push(section('Upgrades'));
    for (const u of G.UPGRADES) {
      const lvl = S.upgrades[u.id], maxed = lvl >= u.max;
      const cost = maxed ? 0 : A.upgradeCost(u);
      rows.push(row({
        icon: img(u.icon, u.name), name: u.name, detail: u.desc,
        price: maxed ? '&mdash;' : z(cost),
        have: `${lvl} / ${u.max}`,
        buys: [{ label: 'Buy', attr: `data-up="${u.id}"`, disabled: maxed || S.zenny < cost }],
      }));
    }

    for (const [group, label, order] of G.ITEM_GROUPS) {
      const items = window.MF_FISH.prep.filter(p =>
        p.buy && G.effectOf(p.id).group === group && S.hr >= G.itemUnlockHR(p));
      if (!items.length) continue;
      items.sort(order
        ? (a, b) => order.indexOf(a.id) - order.indexOf(b.id)
        : (a, b) => a.buy - b.buy);
      rows.push(section(label));
      for (const p of items) {
        const cost = G.priceOf(p);
        rows.push(row({
          icon: itemIcon(p), name: p.name, detail: itemDetail(p),
          price: z(cost), have: stockLabel(A.itemStock(p.id)),
          buys: buyButtons('buy-item', p.id, A.canBuyItem),
        }));
      }
    }

    // Two families, one idea each: pick the fish and let the variety roll, or
    // pick the variety and let the fish roll. Frog is neither — it is for a
    // monster, not a fish.
    const fams = [
      ['species', 'Species Bait'],
      ['ore', 'Variety Bait'],
      ['boss', 'Monster Bait'],
    ];
    for (const [fam, label] of fams) {
      const items = A.BAITS.filter(b => b.family === fam && S.hr >= G.baitUnlockHR(b))
        .sort((a, b) => a.buy - b.buy);
      if (!items.length) continue;
      rows.push(section(label));
      for (const b of items)
        rows.push(row({
          icon: img(b.icon, b.name), name: b.name,
          detail: G.unlockLabel(G.baitUnlockHR(b)),
          price: z(b.buy), have: stockLabel(A.baitStock(b.id)),
          buys: buyButtons('buy-bait', b.id, A.canBuyBait),
        }));
    }

    el('shopTable').innerHTML = rows.join('');
    // "Bought 3 Potion" is wrong and "3 Potions" needs a plural for every item
    // name in the game. The pouch already writes quantities as x3, so do that.
    const bought = (n, name) => window.MF_FILE &&
      window.MF_FILE.toast(n === 1 ? `Bought ${name}.` : `Bought ${name} x${n}.`);
    el('shopTable').querySelectorAll('[data-buy-item]').forEach(btn =>
      btn.onclick = () => {
        const p = A.prepBy.get(btn.dataset.buyItem);
        const n = A.buyItem(btn.dataset.buyItem, Number(btn.dataset.n) || 1);
        if (n) bought(n, p ? p.name : 'item');
        A.save(); renderShop(); renderHeader();
      });
    el('shopTable').querySelectorAll('[data-buy-bait]').forEach(btn =>
      btn.onclick = () => {
        const b = A.baitBy.get(btn.dataset.buyBait);
        const n = A.buyBait(btn.dataset.buyBait, Number(btn.dataset.n) || 1);
        if (n) bought(n, b ? b.name : 'bait');
        A.save(); renderShop(); renderHeader();
      });
    el('shopTable').querySelectorAll('[data-up]').forEach(btn =>
      btn.onclick = () => { A.buyUpgrade(btn.dataset.up); A.save(); renderShop(); renderHeader(); });
  }

  // ── Modal ─────────────────────────────────────────────────────────────────
  let onClose = null;
  function modal({ title, body, items = [], cart = false, onClose: cb }) {
    el('modalTitle').textContent = title;
    el('modalBody').textContent = body;
    el('modalList').innerHTML = items.map(([a, b]) => `<li><span>${a}</span><span>${b}</span></li>`).join('');
    document.querySelector('.modal-box').classList.toggle('cart', cart);
    el('modal').classList.remove('hidden');
    onClose = cb;
  }
  el('modalOk').onclick = () => {
    el('modal').classList.add('hidden');
    const cb = onClose; onClose = null;
    if (cb) cb();
  };

  // ── Wiring ────────────────────────────────────────────────────────────────
  //
  // Space belongs to the rod and nothing else. Left to the browser it scrolls the
  // page — which throws the pond off screen mid-fight — and it fires whichever
  // button happens to hold focus, so a player mashing to reel could hit Retire
  // and end the trip. fishing.js only listens while a cast is live, so the gaps
  // between casts and the moment a fight resolves were both still scrolling.
  // Claimed here, app-wide and in the capture phase, so nothing downstream sees
  // the default. Typing fields keep it, since a space is a character there.
  const TYPING = /^(INPUT|TEXTAREA|SELECT)$/;
  window.addEventListener('keydown', e => {
    if (e.code !== 'Space' && e.key !== ' ') return;
    const t = e.target;
    if (t && (t.isContentEditable || TYPING.test(t.tagName))) return;
    e.preventDefault();
  }, true);

  // ── Camp tabs ─────────────────────────────────────────────────────────────
  //
  // Prep is three decisions and only one is ever live, so they share the panel
  // rather than each taking a slice of the height. Purely a show/hide: every
  // pane stays rendered, so nothing has to be rebuilt on a tab press and the
  // scroll position of the locale list survives a trip to the canteen.
  function campTab(name) {
    for (const [n, tab, pane] of [['locale', 'tabLocale', 'paneLocale'],
                                  ['canteen', 'tabCanteen', 'paneCanteen'],
                                  ['items', 'tabItems', 'paneItems']]) {
      el(tab).classList.toggle('active', n === name);
      el(pane).classList.toggle('active', n === name);
    }
  }
  el('tabLocale').onclick = () => campTab('locale');
  el('tabCanteen').onclick = () => campTab('canteen');
  el('tabItems').onclick = () => campTab('items');

  function itemsTab(name) {
    for (const [n, tab, pane] of [['bait', 'subBait', 'paneBait'],
                                  ['item', 'subItem', 'paneItem']]) {
      el(tab).classList.toggle('active', n === name);
      el(pane).classList.toggle('active', n === name);
    }
  }
  el('subBait').onclick = () => itemsTab('bait');
  el('subItem').onclick = () => itemsTab('item');

  el('navCamp').onclick = () => show('camp');
  el('navGuide').onclick = () => show('guide');
  el('navShop').onclick = () => show('shop');

  el('hireToggle').onchange = e => { A.state.hired = e.target.checked; A.save(); window.MF_PREP.renderHire(); window.MF_PREP.renderDepart(); };
  el('departBtn').onclick = () => { window.MF_QUEST.begin(); renderHeader(); };
  el('castBtn').onclick = () => window.MF_QUEST.cast().then(renderHeader);
  el('returnBtn').onclick = () => window.MF_QUEST.retire();

  // Collectables has two views; only render the one being looked at.
  let collectView = 'fish';
  function showCollectables(view) {
    collectView = view;
    for (const [name, tab, panel] of [['fish', 'subFish', 'viewFish'],
                                     ['locales', 'subLocales', 'viewLocales'],
                                     ['ingredients', 'subIngredients', 'viewIngredients']]) {
      el(tab).classList.toggle('active', view === name);
      el(panel).classList.toggle('active', view === name);
    }
    if (view === 'fish') window.MF_GUIDE.render();
    else if (view === 'ingredients') window.MF_GUIDE.renderPantry();
    else window.MF_GUIDE.renderLocaleCatch();
  }
  el('subFish').onclick = () => showCollectables('fish');
  el('subLocales').onclick = () => showCollectables('locales');
  el('subIngredients').onclick = () => showCollectables('ingredients');

  // Theme modal
  el('themeBtn').onclick = () => {
    window.MF_THEME.renderSwatches();
    el('spaceToCast').checked = !!A.state.spaceToCast;
    el('themeModal').classList.remove('hidden');
  };
  el('spaceToCast').onchange = e => { A.state.spaceToCast = e.target.checked; A.save(); };
  el('themeClose').onclick = () => el('themeModal').classList.add('hidden');
  el('themeModal').onclick = e => { if (e.target.id === 'themeModal') el('themeModal').classList.add('hidden'); };
  el('linksBtn').onclick = () => el('linksModal').classList.remove('hidden');
  el('linksClose').onclick = () => el('linksModal').classList.add('hidden');
  el('linksModal').onclick = e => { if (e.target.id === 'linksModal') el('linksModal').classList.add('hidden'); };

  window.MF_UI = { show, modal, refresh, renderHeader };

  // ── Boot ──────────────────────────────────────────────────────────────────
  window.MF_THEME.init();
  A.load();
  renderHeader();
  show('camp');
})();
