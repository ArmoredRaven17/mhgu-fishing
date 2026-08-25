// prep.js — Camp: pick where you are going, what you are taking, and what you eat.

(function () {
  const G = window.MF_GAME;
  const R = window.MF_ROLL;
  const A = window.MF_APP;

  const el = id => document.getElementById(id);
  const z = n => n.toLocaleString() + 'z';

  // ── Locales ───────────────────────────────────────────────────────────────
  //
  // Grouped by the rung that opened them, so the list reads as the ladder. The
  // current rung is the one that promotes you, and is marked as such; anything a
  // previous rung opened is still fishable, just not required any more.
  const CLIMATE_LABEL = { hot: 'Hot', cold: 'Cold' };

  // HR8 opens nothing, so finishing HR7 lands you on HR9. Say where you land.
  const nextLabel = hr => {
    const n = G.nextHR(hr);
    return n >= G.MAX_LADDER_HR ? 'G Rank+' : `HR ${n}`;
  };

  function renderLocales() {
    const S = A.state;
    const ever = A.everVisited();          // the mark is a record, not a rung
    const rung = A.questRung();            // which quest is actually selected
    const rungs = G.rungsOpenAt(S.hr);

    el('localeList').innerHTML = rungs.map(r => {
      const list = r.locales.map(id => R.localeById.get(id))
        .filter(l => l && (l.hasFishing || G.SHOW_DESIGNED_LOCALES));
      if (!list.length) return '';
      const isCurrent = r.hr === S.hr;
      const seen = A.visitedAt(r.hr);
      const doneHere = list.filter(l => seen[l.id]).length;

      // Every rung is its own panel, and every one says its rank — the same
      // locale on two rungs is two different quests, and the rank is the only
      // thing that tells them apart.
      const head = `<div class="panel-head rung-head">
        <span>HR ${r.hr} &middot; ${r.rank.name}</span>
        <span class="rmeta">${isCurrent
          ? `${doneHere} / ${list.length} to reach ${nextLabel(S.hr)}`
          : `${doneHere} / ${list.length}`}</span>
      </div>`;

      return `<section class="panel rung-panel ${isCurrent ? 'current' : ''}">
        ${head}
        <div class="panel-body"><ul class="locale-list">` + list.map(l => {
        const climate = G.climateOf(l.id);
        const tags = [];
        if (CLIMATE_LABEL[climate]) tags.push(`<span class="tag ${climate}">${CLIMATE_LABEL[climate]}</span>`);
        if (l.boss.length) tags.push('<span class="tag boss">Danger</span>');
        if (seen[l.id]) tags.push('<span class="tag done">Completed</span>');

        // The pool you would actually fish on THIS rung, not on your own HR.
        const meta = l.hasFishing
          ? `${R.questGoal(l.id, r.hr).toLocaleString()}z &middot; ${G.oresAt(r.hr).length} varieties`
          : 'nothing here swims like it should';

        const on = S.localeId === l.id && rung === r.hr;
        return `<li data-id="${l.id}" data-hr="${r.hr}"
          class="${on ? 'sel' : ''} ${seen[l.id] ? 'done' : ''}">
          <div class="linfo">
            <span class="lname">${l.name}</span>
            <span class="lmeta">${meta}</span>
          </div>
          <div class="ltags">${tags.join('')}</div>
        </li>`;
      }).join('') + `</ul></div></section>`;
    }).join('');

    el('localeList').querySelectorAll('li[data-id]').forEach(li => {
      li.onclick = () => { A.selectQuest(li.dataset.id, Number(li.dataset.hr)); renderAll(); };
    });
  }

  // ── Hunter for Hire ───────────────────────────────────────────────────────
  //
  // Someone to stand watch while you fish. Priced by the locale, so the places
  // ── Tackle box ────────────────────────────────────────────────────────────
  //
  // Up to five kinds of bait, swapped between casts out on the water. Replaces
  // the old single-bait-at-departure choice, so which bait to use is a decision
  // you make while fishing rather than one you lock in at camp.
  function renderTackle() {
    const S = A.state;
    // Only bait you actually hold — plus anything already reserved, so a slot you
    // have run dry can still be taken back out. Without that second half the row
    // vanishes with the last bait and its slot is stuck for good.
    const owned = A.BAITS.filter(b => b.id !== 'no_bait'
      && (A.baitStock(b.id) > 0 || A.wantedBait(b.id) > 0)
      && S.hr >= G.baitUnlockHR(b));
    const kinds = A.tackleKinds().length;

    el('tackleCount').textContent = `${kinds} / ${G.TACKLE_SLOTS}`;
    el('tackleList').innerHTML = owned.length ? owned.map(b => {
      // What you ASKED for against what you can actually take right now. Short of
      // stock reads as 3 / 10, and refills itself the moment you restock.
      const want = A.wantedBait(b.id), take = A.tackled(b.id);
      const full = kinds >= G.TACKLE_SLOTS && !want;
      const owned = A.baitStock(b.id);
      return `<li data-id="${b.id}" class="${want ? 'packed' : ''} ${full ? 'nofit' : ''} ${want && !take ? 'dry' : ''}">
        <img src="${b.icon}" alt="">
        <div><b>${b.name}</b><span class="role">${b.family === 'ore' ? 'variety' : 'species'}</span></div>
        <span class="qty">${take}${want ? ` / ${want}` : ` / ${Math.min(owned, G.BAIT_CARRY)}`}</span>
        <button class="btn tiny" data-toggle="${b.id}" ${!want && (full || !owned) ? 'disabled' : ''}>
          ${want ? 'Remove' : 'Add'}</button>
      </li>`;
    }).join('') : '<li class="empty">No bait yet. The shop sells it.</li>';

    el('tackleList').querySelectorAll('button[data-toggle]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.toggle;
        A.setTackle(id, A.wantedBait(id) ? 0 : Infinity);  // clamped to the carry limit
        A.save(); renderTackle(); renderDepart();
      };
    });
  }

  // that hurt most are the places it costs most to be looked after in.
  function renderHire() {
    const S = A.state;
    const loc = R.localeById.get(S.localeId);
    const cost = R.hireCost(S.localeId, A.questRung());
    const none = !loc.pests || !loc.pests.length;
    const broke = S.zenny < cost + A.meal().cost;

    // Nothing to guard against here, so nothing to sell.
    if (none) S.hired = false;
    el('hireCost').textContent = none ? '—' : z(cost);
    el('hireToggle').checked = !!S.hired;
    el('hireToggle').disabled = none || (broke && !S.hired);
    el('hireCost').closest('.field').classList.toggle('cant', !none && broke && !S.hired);

    const who = none ? null : loc.pests.slice(0, 3).map(p => p.name).join(', ');
    el('hireHint').textContent = none ? 'Nothing here bothers an angler.'
      : S.hired ? 'Hunter for Hire will help with the Small Monsters'
      : `${who} are about.`;

    renderPalicos();
    renderTrade();
  }

  // The cart multiplies one thing you already own. It never eats it — what you
  // hand over comes home whatever happens, so the fee and the trip are the only
  // things you are risking.
  //
  // Only things you CANNOT buy. The cart exists to give a second route to a
  // material the Palicos turned up, so offering it a Huskberry the shop sells for
  // a coin would be a worse version of walking to the shop.
  function renderTrade() {
    const S = A.state;
    const held = G.pouchItems()
      .filter(p => p.kind === 'mat' && !G.isBuyableMat(p.id)
        && (A.itemStock(p.id) || 0) > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!held.some(h => h.id === S.tradeItem)) S.tradeItem = '';

    el('tradePick').innerHTML = '<option value="">None</option>' +
      held.map(h => `<option value="${h.id}" ${S.tradeItem === h.id ? 'selected' : ''}>` +
        `${h.name}</option>`).join('');

    const item = S.tradeItem ? G.pouchItemById.get(S.tradeItem) : null;
    const cost = R.tradeCost(S.localeId, A.questRung(), item);
    el('tradeCost').textContent = item ? z(cost) : '—';
    el('tradeHint').textContent =
      'Hand the Trade Cart an item, they search for more of that item as you fish. ' +
      'Item is returned';
  }

  // Cats gather while you fish. What they pick up is held until you are home —
  // see quest.js — so hiring them never changes what you can combine out on the
  // water, only what you will have for next time.
  function renderPalicos() {
    const S = A.state;
    const each = R.palicoCost(S.localeId, A.questRung(), 1);
    const cost = each * S.palicos;
    el('palicoPick').value = String(S.palicos);
    el('palicoCost').textContent = S.palicos ? z(cost) : `${z(each)} each`;
    el('palicoHint').textContent = S.palicos
      ? `${S.palicos === 1 ? 'One Palico gathers' : 'Two Palicos gather'} while you fish. ` +
        'Their haul is handed over when you get back.'
      : 'Palicos gather combine materials the shop does not sell.';
  }

  // Split rather than totalled, so the meal's contribution is visible — that is
  // the whole reason to buy one, and a single total hides it.
  function renderMealStats() {
    const S = A.state, m = A.meal(), f = A.fresh();
    // Fresh HP and Stamina ARE the meal's doing, so they belong in the meal half
    // of the sum rather than as a third term nobody asked for.
    el('mealStats').innerHTML =
      `HP: <b>${G.BASE_MAX_HP + S.upgrades.vitality * 5}</b> + <b>${m.hp + f.hp}</b>` +
      `  and  Stamina: <b>${G.BASE_MAX_STAMINA + S.upgrades.endurance * 8}</b> + <b>${m.stamina + f.stamina}</b>`;

    // The other two do not show up in a gauge, so they have to be said out loud.
    const lines = G.freshLines(f);
    el('mealFresh').innerHTML = lines.length
      ? `<span class="fresh-tag">Fresh</span> ${lines.join(' &middot; ')}`
      : '';
  }

  function renderMeal() {
    const S = A.state;
    // Only what the pantry and your rank allow. With an empty pantry that is the
    // baseline handful; it grows as ingredients turn up.
    const avail = G.mealsAvailable(S.pantry, S.hr);

    // A meal you can no longer cook must not stay selected, or the summary reads
    // "No Meal" while departure charges for the old one and hands out its bonuses.
    if (!avail.some(m => m.id === S.mealId)) { S.mealId = 'none'; A.save(); }
    renderMealStats();

    // A table, not a dropdown: what a meal gives and what it costs are the two
    // things you are comparing, and a <select> could only ever show them as one
    // run-on line per row. Strongest first, then cheapest — the order you shop in.
    const rows = [...avail].sort((a, b) =>
      (b.hp + b.stamina) - (a.hp + a.stamina) || a.cost - b.cost);
    const none = rows.filter(m => m.id === 'none');
    const rest = rows.filter(m => m.id !== 'none');

    el('mealTable').innerHTML = [...none, ...rest].map(m => {
      const tag = G.freshShort(G.freshBonus(m, S.pantry));
      const afford = m.cost <= S.zenny;
      // The fresh bonus sits UNDER the name rather than in a column of its own.
      // As a column it was the widest fixed thing in the table and pushed the
      // price off the edge on a narrow panel, while short names left the name
      // column half empty. Underneath, it costs no width and fills that space.
      return `<tr data-meal="${m.id}"
        class="${S.mealId === m.id ? 'sel' : ''} ${afford ? '' : 'cant'}">
        <td class="nm">${m.name}${tag
          ? `<span class="fr"><span class="fresh-tag">Fresh</span> ${tag}</span>` : ''}</td>
        <td class="n">${m.hp ? `+${m.hp}` : '&mdash;'}</td>
        <td class="n">${m.stamina ? `+${m.stamina}` : '&mdash;'}</td>
        <td class="pr">${m.cost ? z(m.cost) : '&mdash;'}</td>
      </tr>`;
    }).join('');

    el('mealTable').querySelectorAll('tr[data-meal]').forEach(tr => {
      tr.onclick = () => {
        const m = G.MEALS.find(x => x.id === tr.dataset.meal);
        if (!m || m.cost > A.state.zenny) return;      // cannot pick what you cannot pay for
        A.state.mealId = tr.dataset.meal;
        A.save();
        renderMeal(); renderHire(); renderDepart();
      };
    });
  }

  // ── Pouch ─────────────────────────────────────────────────────────────────
  //
  // Adding an item takes as many as you can carry, not one. A slot is claimed by
  // the item TYPE, so there was never a reason to take fewer than the limit —
  // clicking + ten times only ever cost the player time. You are not forced to
  // drink them; the quest screen still uses one at a time.
  function renderPouch() {
    const S = A.state;
    // Same rule as the Bait Pouch: what you hold, plus anything reserved so a dry
    // slot can be given up. Listing everything you had never bought made the
    // pouch a catalogue of things you cannot take.
    // Provisions, combine materials and books all draw on the same ten slots.
    // Supply items (buy 0) are handed out at camp and never packed by hand; a
    // gathered material has no price at all, so the test is "can it be held",
    // not "can it be bought".
    const items = G.pouchItems().filter(p => (p.buy || p.kind === 'mat')
      && (A.itemStock(p.id) > 0 || A.wanted(p.id) > 0)
      && S.hr >= G.itemUnlockHR(p));
    const used = A.slotsUsed();

    el('pouchCount').textContent = `${used} / ${G.POUCH_SLOTS}`;
    if (!items.length) {
      el('pouchList').innerHTML = '<li class="empty">Nothing to pack. The shop sells provisions.</li>';
      return;
    }
    el('pouchList').innerHTML = items.map(p => {
      const want = A.wanted(p.id), take = A.planned(p.id);
      const owned = A.itemStock(p.id);
      const noSlot = used >= G.POUCH_SLOTS && !want;
      return `<li data-id="${p.id}" class="${want ? 'packed' : ''} ${noSlot ? 'nofit' : ''} ${want && !take ? 'dry' : ''}">
        <img src="assets/ItemIcons/${p.icon}" alt="">
        <div><b>${p.name}</b><span class="role">${
          p.kind === 'book' ? `+${p.bonus}% combine`
          : p.kind === 'mat' ? 'combine material'
          : G.effectOf(p.id).label}</span></div>
        <span class="qty">${take}${want ? ` / ${want}` : ` / ${Math.min(owned, G.carryLimit(p.id))}`}</span>
        <button class="btn tiny" data-toggle="${p.id}" ${!want && (noSlot || !owned) ? 'disabled' : ''}>
          ${want ? 'Remove' : 'Add'}</button>
      </li>`;
    }).join('');

    el('pouchList').querySelectorAll('button[data-toggle]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.toggle;
        A.setPlan(id, A.wanted(id) ? 0 : Infinity);       // clamped to the carry limit
        A.save(); renderPouch(); renderDepart();
      };
    });
  }

  // ── Depart summary ────────────────────────────────────────────────────────
  //
  // This is where the trip is won or lost, so it says out loud what the locale
  // will do to you and whether what you are carrying answers it.
  function renderDepart() {
    const S = A.state;
    const loc = R.localeById.get(S.localeId);
    const climate = G.climateOf(S.localeId);
    const meal = A.meal();
    const bits = [];

    // What is charged on departure is already shown next to the meal and the
    // hire themselves, so it is not restated here.
    const upfront = meal.cost + (S.hired ? R.hireCost(S.localeId, A.questRung()) : 0)
      + R.palicoCost(S.localeId, A.questRung(), S.palicos)
      + R.tradeCost(S.localeId, A.questRung(),
          S.tradeItem ? G.pouchItemById.get(S.tradeItem) : null);

    // Every row is the same shape: a bold category, a colon, and the reading.
    // The KIND rides along with it, because on the quest card each one gets its
    // own standard colour rather than all of them sharing a single warn tint — a
    // large monster and a cold snap are not the same news.
    const line = (label, text, kind) =>
      `<div class="line"><span class="k">${label}:</span>` +
      `<span class="${kind ? 'warn ' + kind : ''}">${text}</span></div>`;

    // Where, at what rank, and what it takes to clear it. The quest's own rank,
    // single, from the rung you picked.
    const rung = A.questRung();
    const rank = G.rankAt(rung).name;
    bits.push(line('Locale', loc.name));
    bits.push(line('Rank', rank));
    bits.push(line('Main Objective',
      `Catch <b class="goal">${z(R.questGoal(S.localeId, rung))}</b> in fish`));

    // Three fixed readings, always present and always in this order. Stating the
    // good case out loud rather than omitting it is what keeps the block the same
    // height whichever locale is selected — an omitted line used to make the
    // whole panel jump as you clicked down the list.
    const danger = loc.boss.length > 0;
    const pests = !!(loc.pests && loc.pests.length);

    bits.push(line('Large Monster',
      danger ? 'DANGER - Intruder may appear' : 'No Large Monster sighted',
      danger && 'danger'));
    bits.push(line('Small Monsters',
      pests ? 'Small Monsters have been sighted' : 'No Small Monsters sighted',
      pests && 'pests'));
    bits.push(line('Temperature',
      climate === 'hot' ? 'Elevated temperature in area'
        : climate === 'cold' ? 'Lower temperatures in area'
        : 'Comfortable Temps',
      climate === 'hot' ? 'hot' : climate === 'cold' ? 'cold' : ''));

    el('departSummary').innerHTML = bits.map(b => `<div>${b}</div>`).join('');
    el('departBtn').disabled = !A.localeOpen(S.localeId) || S.zenny < upfront;
  }

  function renderAll() {
    renderLocales(); renderTackle(); renderMeal(); renderHire(); renderPouch(); renderDepart();
    el('tradePick').onchange = e => {
      A.state.tradeItem = e.target.value || '';
      A.save(); renderTrade(); renderDepart();
    };
    el('palicoPick').onchange = e => {
      A.state.palicos = Math.max(0, Math.min(G.PALICO.max, Number(e.target.value) || 0));
      A.save(); renderPalicos(); renderDepart();
    };
  }

  window.MF_PREP = { renderAll, renderPouch, renderTackle, renderHire, renderMealStats, renderDepart };
})();
