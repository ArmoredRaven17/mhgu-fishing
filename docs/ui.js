// ui.js — screens, shop, upgrades, modal, and the wiring between them.

(function () {
  const G = window.MF_GAME;
  const A = window.MF_APP;
  const el = id => document.getElementById(id);
  const z = n => Math.round(n).toLocaleString() + 'z';

  const SCREENS = ['camp', 'quest', 'guide', 'combos', 'smithy', 'shop'];
  const TABS = { camp: 'navCamp', guide: 'navGuide', combos: 'navCombos',
                 smithy: 'navSmithy', shop: 'navShop' };

  function show(name) {
    for (const s of SCREENS) el(s).classList.toggle('active', s === name);
    for (const [s, tab] of Object.entries(TABS)) el(tab).classList.toggle('active', s === name);
    // The quest is modal by nature — you cannot browse the shop mid-trip.
    const questing = window.MF_QUEST.active;
    for (const tab of Object.values(TABS)) el(tab).disabled = questing && name === 'quest';
    if (name === 'guide') showCollectables(collectView);
    if (name === 'combos') window.MF_GUIDE.renderCombos();
    if (name === 'shop') renderShop();
    if (name === 'smithy') { renderSmithy(); showSmithy(smithyView); }
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


  // ── Smithy ────────────────────────────────────────────────────────────────
  //
  // Gear only. You forge a piece you do not own from monster parts plus zenny, or
  // level one you do own with zenny alone. What a piece is MADE OF gets its own
  // column here rather than a line of description: the whole question a player
  // brings to this screen is "which monster do I still have to go and find?", and
  // a column answers that at a glance where a footnote does not.
  function renderSmithy() {
    const S = A.state;

    const matCell = (g) => {
      const parts = A.forgeParts(g.id);
      if (!parts.length) return '<span class="none">&mdash;</span>';
      const need = A.partsNeeded(g.id), held = A.partsHeld(g.id);
      const enough = held >= need;
      // A rod takes any part of its rank, so listing five of them is noise — say
      // what it actually wants. Armor wants its own monster, so name it.
      const label = parts.length === 1
        ? `${img('assets/ItemIcons/' + parts[0].mat.icon, parts[0].mat.name)}${parts[0].mat.name}`
        : `<i>any ${g.rank} Rank part</i>`;
      return `<span class="mat ${enough ? 'ok' : 'short'}">`
        + `<b>${need}&times;</b> ${label} <span class="held">${held} held</span></span>`;
    };

    const gearRow = (g, slot) => {
      const owned = A.gearOwned(g.id);
      const lvl = A.gearLevel(g.id), max = A.gearMax(g.id);
      const worn = S.gear[slot] && S.gear[slot].id === g.id;   // per slot: three rows can be worn at once
      const capped = lvl >= max;
      const gate = owned && !capped ? A.levelUnlockHR(g.id, lvl) : 0;
      const locked = gate > S.hr;
      const cost = !owned ? g.cost : (capped ? 0 : A.levelCost(g.id));

      // One entry per skill in each column, in the same order, so a name and its
      // description always line up.
      // Was `=== 'armor'`, which silently stopped matching the moment the slot
      // became helm/chest/waist — every row rendered with no skills and no
      // stats. Anything that is not the rod is a piece of armor.
      const armor = g.slot !== 'rod';
      const skills = armor
        ? g.effects.map(e => `<span class="ent">${G.effectName(e.key, e.lvl)}</span>`).join('')
        : '';
      let detail = armor
        ? g.effects.map(e => `<span class="ent">${G.effectBlurb(e.key, e.lvl)}</span>`).join('')
        : `<span class="ent">${g.desc || ''}</span>`;
      // What the suit is actually worth, and what a level buys. Levelling armor
      // does NOT strengthen its skills — those are fixed by the tier — so
      // without this the Upgrade button spends money on nothing you can see.
      // What the piece is worth, in its OWN column. It used to be appended to the
      // description column, so a piece with six skills produced six names against
      // seven description entries and the pairing the two columns exist to make
      // stopped lining up.
      let stats = '';
      if (armor) {
        // armorStat reads a worn SET, so asking what one piece is worth means
        // handing it a set containing only that piece. Passing the piece itself
        // silently returned zero for all three.
        const at = { [g.slot]: { id: g.id, lvl } };
        const next = n => ({ [g.slot]: { id: g.id, lvl: lvl + n } });
        const line = (label, val, gain) =>
          `<span class="ent stat"><b>${val}</b> ${label}`
          + (gain ? `<i class="gain">+${gain}</i>` : '') + `</span>`;
        const showGain = owned && !capped;
        stats =
          line('HP', '+' + G.armorStat(at, 'hp'),
            showGain && (G.armorStat(next(1), 'hp') - G.armorStat(at, 'hp'))) +
          line('Stamina', '+' + G.armorStat(at, 'stamina'),
            showGain && (G.armorStat(next(1), 'stamina') - G.armorStat(at, 'stamina'))) +
          line('DEF', '+' + Math.round(G.armorStat(at, 'guard') * 100) + '%',
            showGain && (G.ARMOR_PER_LEVEL.guard * 100).toFixed(1) + '%');
      }
      if (owned && locked) detail += `<span class="unlock">Next level at HR ${gate}</span>`;

      const buys = [];
      if (!owned) buys.push({ label: 'Forge', attr: `data-forge="${g.id}"`,
                              disabled: !A.canForge(g.id) });
      else {
        buys.push({ label: 'Upgrade', attr: `data-level="${g.id}"`,
                    disabled: capped || locked || !A.canLevel(g.id) });
        // Always present, disabled when it is already on. Hiding it made the row
        // reflow and the buttons beside it jump as you equipped down a list.
        buys.push({ label: 'Equip', attr: `data-equip="${g.id}"`, disabled: worn });
      }
      return gearRowHTML({
        icon: img(g.icon || 'assets/ItemIcons/' + (g.mat ? g.mat.icon : 'MH4G-Ore_Icon_Grey.png'), g.name),
        name: g.name,
        skills, detail,
        stats,
        mats: owned ? '<span class="none">&mdash;</span>' : matCell(g),
        price: !owned ? z(g.cost) : (capped ? '&mdash;' : z(cost)),
        have: owned ? `Lv ${lvl} / ${max}` : '&mdash;',
        buys, worn,
      });
    };

    // A rod appears once you hold a part of its rank — the same rule armor
    // follows, and the same reason: the list should be a record of what you have
    // met, not a catalogue of what exists. The starter is always there, since it
    // is the rod you are already holding.
    const heldRanks = new Set(G.MONSTER_MATS
      .filter(m => (S.mats[m.id] || 0) > 0).map(m => m.rank));
    const knownRods = G.RODS.filter(g =>
      g.starter || A.gearOwned(g.id) || heldRanks.has(g.rank));
    const rodRows = [];
    rodRows.push(gearSection('Rods'));
    for (const g of knownRods) rodRows.push(gearRow(g, 'rod'));

    // A suit stays out of sight until you hold a part of the monster it is made
    // of. You do not know Lagiacrus armor exists until a Lagiacrus has given you
    // something, which turns the list into a record of what you have met rather
    // than a catalogue of everything in the game. Anything already forged stays
    // listed whatever you have spent since.
    // `forgeable` is explicit rather than implied by `g.mat`: the sixty exchange
    // lines are in ARMORS now so the benches can reach them, and the smithy must
    // not list armor the game has no way to make.
    const knownArmor = G.ARMORS.filter(g => g.forgeable
      && (A.gearOwned(g.id) || (g.mat && (S.mats[g.mat.id] || 0) > 0)));
    // A set at a time. Three tiers of one line side by side is the comparison a
    // player is actually making — "should I climb this line or start another" —
    // and eight lines in one list buried it.
    const lines = Object.keys(G.ARMOR_PIECES)
      .filter(l => knownArmor.some(a => a.line === l));
    if (!lines.includes(smithyLine)) smithyLine = lines[0] || '';

    el('armorLines').innerHTML = lines.map(l =>
      `<button class="subtab ${l === smithyLine ? 'active' : ''}" data-line="${l}">${
        G.armorLineName(l)}</button>`).join('');
    el('armorLines').querySelectorAll('[data-line]').forEach(btn =>
      btn.onclick = () => { smithyLine = btn.dataset.line; renderSmithy(); });

    // The second axis is the TIER, not the piece. A set is forged and worn as a
    // set, so the three pieces of one tier belong on screen together; splitting
    // by piece instead put a helm beside two helms you would never wear with it.
    //
    // Tabs are labelled the way the armor is: base, S, X. A line with only two
    // tiers runs base then X, with no S between — the same rule armorSuffix uses,
    // read off the pieces that actually exist rather than assumed.
    const tiersHere = ['Low', 'High', 'G'].filter(r =>
      knownArmor.some(a => a.line === smithyLine && a.rank === r));
    if (!tiersHere.includes(smithyTier)) smithyTier = tiersHere[0] || '';
    const tierLabel = (rank, i) => {
      const suffix = G.armorSuffix(i, tiersHere.length).trim();
      return suffix || 'Base';
    };
    el('armorPieces').innerHTML = !lines.length ? '' : tiersHere.map((r, i) =>
      `<button class="subtab ${r === smithyTier ? 'active' : ''}" data-tier="${r}">${
        tierLabel(r, i)}</button>`).join('');
    el('armorPieces').querySelectorAll('[data-tier]').forEach(btn =>
      btn.onclick = () => { smithyTier = btn.dataset.tier; renderSmithy(); });

    const armorRows = [];
    if (!lines.length) {
      armorRows.push(gearSection('Angler Armor'));
      armorRows.push('<tr><td class="ic"></td><td class="dt" colspan="8">'
        + 'Nothing to forge yet. Catch a large monster and the smith will know what to do with it.</td></tr>');
    } else {
      // No header row: the tab above already names the line, and the rows below
      // already name its skills. Saying both again in between was the same
      // information three times.
      // Helm, chest, waist in that order — the order they are worn in and the
      // order the board is written in, not whatever order ARMORS happened to build.
      const rows = G.PIECE_SLOTS
        .map(sl => knownArmor.find(a => a.line === smithyLine && a.rank === smithyTier && a.slot === sl))
        .filter(Boolean);
      if (!rows.length) {
        armorRows.push('<tr><td class="ic"></td><td class="dt" colspan="8">'
          + 'Nothing of this tier yet.</td></tr>');
      } else {
        for (const g of rows) armorRows.push(gearRow(g, g.slot));
      }
    }

    // What you are holding, so the lists above can be read against something.
    // Never buyable — the only way to get one is to land the thing it came off.
    const held = G.MONSTER_MATS.filter(m => (S.mats[m.id] || 0) > 0);
    rodRows.push(gearSection('Monster Parts'));
    if (!held.length) {
      rodRows.push('<tr><td class="ic"></td><td class="dt" colspan="8">'
        + 'Nothing yet. Parts come off the large monsters you catch.</td></tr>');
    } else {
      for (const m of held) rodRows.push(gearRowHTML({
        icon: img('assets/ItemIcons/' + m.icon, m.name), name: m.name,
        skills: '', detail: `<span class="ent">${m.rank} Rank &mdash; ${G.MAT_LINES[m.line].name}</span>`,
        mats: '', price: '&mdash;', have: `x${S.mats[m.id]}`, buys: [],
      }));
    }


    // ── The Trade Cart ──────────────────────────────────────────────────────
    //
    // The whole ladder is listed, not just the next rung, because the two knobs
    // leapfrog: which upgrade is worth buying depends on how long you fish, and
    // you cannot see that from one row. `at 40 fish` is the honest common
    // yardstick — the basket target, and about what a full trip lands.
    // The whole tab is out of sight until the smith has something to sell. The
    // cart itself runs from the first trip — what opens at HR3 is the ladder —
    // so an empty tab explaining that was both a teaser and, read literally,
    // wrong about when you get a cart.
    const cartRows = [];
    const lvl = A.cartLevel();
    el('subCart').hidden = !A.cartOpen();
    if (!A.cartOpen()) {
      if (smithyView === 'cart') showSmithy('rods');
    } else {
      cartRows.push(gearSection('Trade Cart'));
      // What you own, plus the one rung you could buy next — and nothing beyond
      // it. The cart is a strict ladder rather than a shelf of alternatives the
      // way rods and armor are: you cannot skip to the Grand cart, so listing it
      // four rungs early is showing a price you have no way to act on.
      //
      // Anything already paid for stays listed whatever rank you are, so the
      // ladder never appears to lose a rung.
      const shown = G.TRADE_CART.filter(t =>
        t.lvl <= lvl || (t.lvl === lvl + 1 && G.cartTierOpen(t, S.hr)));
      for (const t of shown) {
        const owned = t.lvl <= lvl;
        const next = t.lvl === lvl + 1;
        const held = t.rank ? A.cartPartsHeld(t) : 0;
        const enough = held >= (t.matCount || 0);
        const mats = t.rank
          ? `<span class="mat ${enough ? 'ok' : 'short'}"><b>${t.matCount}&times;</b> `
            + `<i>any ${t.rank} Rank part</i> <span class="held">${held} held</span></span>`
          : '<span class="none">&mdash;</span>';
        // Which knob the rung moves, and the two numbers it moves them to. What
        // that comes to over a trip is left unsaid: it depends on how long you
        // fish, and it is the player's to work out.
        const knob = t.knob === 'cap' ? 'Holds more' : t.knob === 'rate' ? 'Fills faster' : '';
        cartRows.push(gearRowHTML({
          icon: '', name: t.name,
          skills: knob ? `<span class="ent">${knob}</span>` : '',
          detail: `<span class="ent">Holds ${t.cap}, one per ${t.perExtra} fish caught</span>`,
          mats: owned ? '<span class="none">&mdash;</span>' : mats,
          price: owned ? '&mdash;' : z(t.cost),
          have: owned ? (t.lvl === lvl ? 'In use' : 'Owned') : '&mdash;',
          buys: next ? [{ label: 'Upgrade', attr: 'data-cart="1"',
                          disabled: !A.canUpgradeCart() }] : [],
          worn: t.lvl === lvl,
        }));
      }
    }
    el('cartTable').innerHTML = cartRows.join('');

    el('rodTable').innerHTML = rodRows.join('');
    el('armorTable').innerHTML = armorRows.join('');

    for (const table of ['rodTable', 'armorTable', 'cartTable']) {
      const wire = (attr, fn) => el(table).querySelectorAll(`[${attr}]`).forEach(btn =>
        btn.onclick = () => { fn(btn.getAttribute(attr)); A.save(); renderSmithy(); renderHeader(); });
      wire('data-forge', id => A.forge(id));
      wire('data-level', id => A.levelUp(id));
      wire('data-equip', id => A.equip(id));
      wire('data-cart', () => A.upgradeCart());
    }
  }

  // Which half of the Smithy is showing. Kept out here so a forge or an equip can
  // re-render without throwing you back to the rods.
  let smithyView = 'rods';
  let smithyLine = '';        // which set's tab is open, '' until one is known
  let smithyTier = '';        // which tier of the line the armor tab is showing
  function showSmithy(view) {
    smithyView = view;
    for (const [name, tab, panel] of [['rods', 'subRods', 'viewRods'],
                                     ['armor', 'subArmor', 'viewArmor'],
                                     ['cart', 'subCart', 'viewCart']]) {
      el(tab).classList.toggle('active', view === name);
      el(panel).classList.toggle('active', view === name);
    }
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
  // A button that would silently buy fewer than it says is worse than a dead one.
  // affordable() clamps the amount to what will fit, so Buy 10 on a book you may
  // only own one of came back as "1" — not zero, so it read as live and then did
  // something other than what it said.
  const buyButtons = (attrName, id, can) => BUY_AMOUNTS.map(n => ({
    label: `Buy ${n}`,
    attr: `data-${attrName}="${id}" data-n="${n}"`,
    disabled: can(id, n) === 0 || n > G.ownCap(id),
  }));

  // Say when a stock is full, so a row of dead buttons explains itself.
  const stockLabel = n => n >= G.STOCK_CAP ? `${G.STOCK_CAP} max` : String(n);
  const section = label => `<tr class="sect"><th colspan="6">${label}</th></tr>`;
  const gearSection = label => `<tr class="sect"><th colspan="9">${label}</th></tr>`;

  // The Smithy carries one column the Shop does not: what a piece is made of.
  // Buried in the description it read as a footnote; in its own column you can
  // run an eye down the list and see which monster you still have to go and find.
  const gearRowHTML = ({ icon = '', name, skills = '', detail = '', stats = '',
                         mats = '', price, have, buys, worn = false }) => `
    <tr class="${worn ? 'worn' : ''}">
      <td class="ic">${icon}</td>
      <td class="nm">${name}</td>
      <td class="sk">${skills}</td>
      <td class="dt">${detail}</td>
      <td class="st">${stats}</td>
      <td class="mt">${mats}</td>
      <td class="pr">${price}</td>
      <td class="hv">${have}</td>
      <td class="bt"><span class="buys">${buys.map(b =>
        `<button class="btn tiny" ${b.attr} ${b.disabled ? 'disabled' : ''}>${b.label}</button>`
      ).join('')}</span></td>
    </tr>`;

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

    for (const [group, label, order] of G.ITEM_GROUPS) {
      // Materials and books sit in the same list as the provisions now, so the
      // shop stops caring which table a thing came out of. A material only shows
      // if it is one of the few the shop sells — the rest are the cats' job.
      const items = G.pouchItems().filter(p =>
        p.buy && p.group === group && S.hr >= G.itemUnlockHR(p)
        && (p.kind !== 'mat' || G.isBuyableMat(p.id)));
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
  el('navCombos').onclick = () => show('combos');
  // The quest pane's tabs. Purely a view switch — every panel keeps its own id,
  // so nothing that renders into them had to change.
  el('sideTabs').addEventListener('click', e => {
    const btn = e.target.closest('[data-side]');
    if (!btn) return;
    const want = btn.dataset.side;
    for (const b of el('sideTabs').querySelectorAll('[data-side]'))
      b.classList.toggle('active', b === btn);
    for (const v of document.querySelectorAll('.side-view'))
      v.classList.toggle('active', v.dataset.side === want);
  });

  el('subRods').onclick = () => showSmithy('rods');
  el('subArmor').onclick = () => showSmithy('armor');
  el('subCart').onclick = () => showSmithy('cart');
  el('navSmithy').onclick = () => show('smithy');
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
                                     ['monsters', 'subMonsters', 'viewMonsters'],
                                     ['ingredients', 'subIngredients', 'viewIngredients'],
                                     ['materials', 'subMaterials', 'viewMaterials']]) {
      el(tab).classList.toggle('active', view === name);
      el(panel).classList.toggle('active', view === name);
    }
    if (view === 'fish') window.MF_GUIDE.render();
    else if (view === 'ingredients') window.MF_GUIDE.renderPantry();
    else if (view === 'materials') window.MF_GUIDE.renderMaterials();
    else if (view === 'monsters') window.MF_GUIDE.renderMonsters();
    else window.MF_GUIDE.renderLocaleCatch();
  }
  el('subFish').onclick = () => showCollectables('fish');
  el('subLocales').onclick = () => showCollectables('locales');
  el('subMonsters').onclick = () => showCollectables('monsters');
  el('subIngredients').onclick = () => showCollectables('ingredients');
  el('subMaterials').onclick = () => showCollectables('materials');

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
