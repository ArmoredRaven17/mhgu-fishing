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

      // Every rung says its rank, because the same locale on two rungs is two
      // different quests and the rank is the thing that tells them apart.
      const head = `<li class="rung ${isCurrent ? 'current' : ''}">
        <span>HR ${r.hr} &middot; ${r.rank.name}</span>
        <span class="rmeta">${isCurrent
          ? `${doneHere} / ${list.length} to reach ${nextLabel(S.hr)}`
          : `${doneHere} / ${list.length}`}</span>
      </li>`;

      return head + list.map(l => {
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
      }).join('');
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
    const owned = A.BAITS.filter(b => b.id !== 'no_bait' && A.baitStock(b.id) > 0
      && S.hr >= G.baitUnlockHR(b));
    const kinds = A.tackleKinds().length;

    el('tackleCount').textContent = `${kinds} / ${G.TACKLE_SLOTS}`;
    el('tackleList').innerHTML = owned.length ? owned.map(b => {
      const take = A.tackled(b.id), cap = Math.min(A.baitStock(b.id), G.BAIT_CARRY);
      const full = kinds >= G.TACKLE_SLOTS && !take;
      return `<li data-id="${b.id}" class="${full ? 'nofit' : ''}">
        <img src="${b.icon}" alt="">
        <div><b>${b.name}</b><span class="role">${b.family === 'ore' ? 'variety' : 'species'}</span></div>
        <span class="qty">${take} / ${cap}</span>
        <button class="btn tiny" data-toggle="${b.id}" ${!take && (full || !cap) ? 'disabled' : ''}>
          ${take ? 'Remove' : 'Add'}</button>
      </li>`;
    }).join('') : '<li class="empty">No bait yet. The shop sells it.</li>';

    el('tackleList').querySelectorAll('button[data-toggle]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.toggle;
        A.setTackle(id, A.tackled(id) ? 0 : Infinity);   // setTackle clamps to the most you can take
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

    // A meal you can no longer cook must not stay selected. The <select> falls
    // back to showing the first option, but S.mealId still pointed at the old
    // one — so the summary read "No Meal" while departure charged for it and
    // handed out its bonuses. Clamp before anything reads it.
    if (!avail.some(m => m.id === S.mealId)) { S.mealId = 'none'; A.save(); }

    const groups = new Map();
    for (const m of avail) {
      const key = m.id === 'none' ? '' :
        [m.hp ? `+${m.hp} HP` : null, m.stamina ? `+${m.stamina} Stamina` : null]
          .filter(Boolean).join(', ');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
    renderMealStats();

    el('mealSelect').innerHTML = [...groups].map(([label, list]) => {
      const opts = list.map(m =>
        `<option value="${m.id}" ${S.mealId === m.id ? 'selected' : ''}>` +
        `${m.name}${m.cost ? ` — ${z(m.cost)}` : ''}</option>`).join('');
      return label ? `<optgroup label="${label}">${opts}</optgroup>` : opts;
    }).join('');
  }

  // ── Pouch ─────────────────────────────────────────────────────────────────
  //
  // Adding an item takes as many as you can carry, not one. A slot is claimed by
  // the item TYPE, so there was never a reason to take fewer than the limit —
  // clicking + ten times only ever cost the player time. You are not forced to
  // drink them; the quest screen still uses one at a time.
  function renderPouch() {
    const S = A.state;
    const items = window.MF_FISH.prep.filter(p => p.buy && S.hr >= G.itemUnlockHR(p));
    const used = A.slotsUsed();

    el('pouchCount').textContent = `${used} / ${G.POUCH_SLOTS}`;
    el('pouchList').innerHTML = items.map(p => {
      const take = A.planned(p.id);
      const cap = Math.min(A.itemStock(p.id), G.carryLimit(p.id));
      const noSlot = used >= G.POUCH_SLOTS && !take;
      return `<li data-id="${p.id}" class="${noSlot ? 'nofit' : ''}">
        <img src="assets/ItemIcons/${p.icon}" alt="">
        <div><b>${p.name}</b><span class="role">${G.effectOf(p.id).label}</span></div>
        <span class="qty">${take} / ${cap}</span>
        <button class="btn tiny" data-toggle="${p.id}" ${!take && (noSlot || !cap) ? 'disabled' : ''}>
          ${take ? 'Remove' : 'Add'}</button>
      </li>`;
    }).join('');

    el('pouchList').querySelectorAll('button[data-toggle]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.toggle;
        A.setPlan(id, A.planned(id) ? 0 : Infinity);     // setPlan clamps to the most you can take
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
    const upfront = meal.cost + (S.hired ? R.hireCost(S.localeId, A.questRung()) : 0);

    // The headline: where, what water, and what it takes to clear it.
    // The quest's own rank, single, from the rung you picked.
    const rung = A.questRung();
    const rank = G.rankAt(rung).name;
    bits.push(`<div class="head"><b>${loc.name}</b> - ${rank} - ` +
      `Objective: <b>${z(R.questGoal(S.localeId, rung))}</b></div>`);

    // Three fixed lines, always present and always in this order. Stating the
    // good case out loud rather than omitting it is what keeps the block the same
    // height whichever locale is selected — an omitted line used to make the
    // whole panel jump as you clicked down the list.
    const line = (label, text, warn) =>
      `<div class="line"><span class="k">${label}</span>` +
      `<span class="${warn ? 'warn' : ''}">${text}</span></div>`;

    const danger = loc.boss.length > 0;
    const pests = !!(loc.pests && loc.pests.length);

    bits.push(line('Large Monster',
      danger ? 'DANGER - Intruder may appear' : 'No Large Monster sighted', danger));
    bits.push(line('Small Monsters',
      pests ? 'Small Monsters have been sighted' : 'No Small Monsters sighted', pests));
    bits.push(line('Temperature',
      climate === 'hot' ? 'Elevated temperature in area'
        : climate === 'cold' ? 'Lower temperatures in area'
        : 'Comfortable Temps',
      climate !== 'temperate'));

    el('departSummary').innerHTML = bits.map(b => `<div>${b}</div>`).join('');
    el('departBtn').disabled = !A.localeOpen(S.localeId) || S.zenny < upfront;
  }

  function renderAll() {
    renderLocales(); renderTackle(); renderMeal(); renderHire(); renderPouch(); renderDepart();
  }

  window.MF_PREP = { renderAll, renderPouch, renderTackle, renderHire, renderMealStats, renderDepart };
})();
