// quest.js — the trip. Prep is over; this is what happens out there.
//
// Two ways it ends:
//   Stamina hits zero -> you go home WITH the haul. You just ran out of day.
//   HP hits zero      -> you cart. The entire haul is lost.
//
// That asymmetry is the whole game. Stamina decides how long you push; HP
// decides whether pushing was worth it.

(function () {
  const G = window.MF_GAME;
  const R = window.MF_ROLL;
  const A = window.MF_APP;
  const el = id => document.getElementById(id);
  const z = n => Math.round(n).toLocaleString() + 'z';

  let trip = null;

  function begin() {
    const S = A.state;
    const loc = R.localeById.get(S.localeId);
    const meal = A.meal();
    const questHR = A.questRung();          // the rung decides the quest's rank
    const hire = S.hired ? R.hireCost(S.localeId, questHR) : 0;
    if (!A.spend(meal.cost + hire)) return;

    const climate = G.climateOf(S.localeId);
    trip = {
      localeId: S.localeId, loc, climate, questHR,
      rates: G.CLIMATE_RATES[climate],
      tackle: Object.fromEntries(A.tackleKinds().map(id => [id, A.tackled(id)])),
      bait: A.baitBy.get('no_bait'),
      maxHP: A.maxHP(), maxSta: A.maxStamina(),
      // Locked in with the meal. A fresh Fish pays out on every catch and a fresh
      // Alcohol takes the edge off what monsters do to you.
      fresh: A.fresh(),
      hp: A.maxHP(), sta: A.maxStamina(),
      // What you set out with. Your STOCK is not touched until the trip actually
      // ends — deducting at departure meant a reload mid-trip silently destroyed
      // everything you were carrying, because the trip itself is not persisted.
      // Nothing leaves the pouch until finish() or cartOut() says what you spent.
      carried: Object.fromEntries(window.MF_FISH.prep
        .map(p => [p.id, A.planned(p.id)]).filter(([, n]) => n > 0)),
      packed: Object.fromEntries(window.MF_FISH.prep
        .map(p => [p.id, A.planned(p.id)]).filter(([, n]) => n > 0)),
      // Supply items (buy 0) are not sold anywhere. Camp hands them out at Low
      // Rank only — see below.
      supplied: S.rank === G.SUPPLY_RANK,
      hired: !!hire,       // locked in at departure; you cannot hire from the water
      drinkLeft: 0,
      dashLeft: 0,
      goal: R.questGoal(S.localeId, questHR),
      haul: [], value: 0,
      found: [],          // ingredients turned up this trip
      notes: [],          // things to tack onto the cast message once it is written
      busy: false,
    };
    trip.packedTackle = { ...trip.tackle };
    if (S.rank === G.SUPPLY_RANK)
      for (const p of window.MF_FISH.prep)
        if (!p.buy) trip.carried[p.id] = (trip.carried[p.id] || 0) + G.SUPPLY_EACH;

    S.stats.trips++;
    A.save();
    window.MF_UI.show('quest');
    render();
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  function render() {
    if (!trip) return;
    el('hpFill').style.width = Math.max(0, 100 * trip.hp / trip.maxHP) + '%';
    el('staFill').style.width = Math.max(0, 100 * trip.sta / trip.maxSta) + '%';
    // The bar the climate is eating pulses while nothing is holding it off.
    const exposed = trip.climate !== 'temperate' && trip.drinkLeft <= 0;
    el('staFill').classList.toggle('chill', exposed && trip.climate === 'cold');
    el('hpFill').classList.toggle('scorch', exposed && trip.climate === 'hot');
    el('hpText').textContent = `${Math.max(0, Math.ceil(trip.hp))} / ${trip.maxHP}`;
    el('staText').textContent = `${Math.max(0, Math.ceil(trip.sta))} / ${trip.maxSta}`;
    el('questLocale').textContent = trip.loc.name;
    // Temperate is the absence of a hazard, not a hazard — no pill for it.
    const cl = el('questClimate');
    const CLIMATE_LABEL = { hot: 'Hot', cold: 'Cold' };
    const label = CLIMATE_LABEL[trip.climate];
    cl.textContent = label || '';
    cl.className = 'climate ' + (label ? trip.climate : 'hidden');
    el('questBait').textContent = trip.bait.name;

    el('haulValue').textContent = '';
    el('haulGoal').textContent = `${z(trip.value)} / ${z(trip.goal)}`;
    el('haulGoal').classList.toggle('met', trip.value >= trip.goal);
    el('haulList').innerHTML = trip.haul.map(c =>
      `<li>${c.icon}<span>${c.name}</span><span class="v">${z(c.value)}</span></li>`
    ).join('') + trip.found.map(f =>
      `<li class="ingr ${f.fresh ? 'fresh' : ''}"><span class="dot"></span>` +
      `<span>${f.name}</span><span class="v">${f.fresh ? 'fresh' : 'pantry'}</span></li>`
    ).join('');

    el('castBtn').disabled = trip.busy || trip.sta <= 0 || trip.hp <= 0;
    renderPouch();
    renderTackle();
  }

  // The tackle box out on the water: pick which bait the next cast uses.
  function renderTackle() {
    const kinds = Object.keys(trip.tackle).filter(id => trip.tackle[id] > 0);
    const rows = [{ id: 'no_bait', n: null }, ...kinds.map(id => ({ id, n: trip.tackle[id] }))];
    el('questTackle').innerHTML = rows.map(({ id, n }) => {
      const b = A.baitBy.get(id);
      const on = trip.bait.id === id;
      return `<li class="${on ? 'on' : ''}">
        <img src="${b.icon}" alt="">
        <div><b>${b.name}</b></div>
        <span class="qty">${n === null ? '∞' : 'x' + n}</span>
        <button class="btn tiny" data-bait="${id}" ${trip.busy || on ? 'disabled' : ''}>${on ? 'On' : 'Use'}</button>
      </li>`;
    }).join('');
    el('questTackle').querySelectorAll('[data-bait]').forEach(b =>
      b.onclick = () => equipBait(b.dataset.bait));
  }

  // What you are carrying, and what you can do with it right now.
  function renderPouch() {
    const list = window.MF_FISH.prep
      .filter(p => trip.carried[p.id] > 0)
      .sort((a, b) => G.effectOf(a.id).group.localeCompare(G.effectOf(b.id).group)
        || a.name.localeCompare(b.name));

    el('questPouch').innerHTML = list.length ? list.map(p => {
      const e = G.effectOf(p.id);
      return `<li>
        <img src="assets/ItemIcons/${p.icon}" alt="">
        <div><b>${p.name}</b><span class="eff">${e.label}</span></div>
        <span class="qty">x${trip.carried[p.id]}</span>
        <button class="btn tiny" data-use="${p.id}"
          ${trip.busy || !wouldHelp(p.id) ? 'disabled' : ''}>Use</button>
      </li>`;
    }).join('') : '<li class="empty">Nothing left to use.</li>';

    el('questPouch').querySelectorAll('[data-use]').forEach(b =>
      b.onclick = () => useItem(b.dataset.use));

    // Anything ticking down, so the player can see it lapse rather than guess.
    const buffs = [];
    if (trip.climate !== 'temperate' && trip.drinkLeft > 0)
      buffs.push(`${trip.climate === 'hot' ? 'Cool' : 'Hot'} Drink ${Math.ceil(trip.drinkLeft)}s`);
    if (trip.dashLeft > 0) buffs.push(`Dash ${Math.ceil(trip.dashLeft)}s`);
    el('buffLine').innerHTML = buffs.length
      ? buffs.map(b => `<span class="buff">${b}</span>`).join('')
      : '';
  }

  // ── One cast ──────────────────────────────────────────────────────────────
  //
  // Stock the water, hand it to the pond, and take whatever comes back. The bait
  // is spent on the ATTEMPT — landed, snapped or missed alike — because it is the
  // bait that drew the school in, and the school is re-rolled next cast either way.
  async function cast() {
    if (!trip || trip.busy) return;
    trip.busy = true; render();
    const S = A.state;
    S.stats.casts++;

    const boss = R.rollEncounter(trip.localeId, trip.bait);
    const school = boss ? [] : R.rollSchool({
      localeId: trip.localeId, bait: trip.bait, hr: trip.questHR, lureLevel: S.upgrades.lure,
    });
    if (!boss && !school.length) { trip.busy = false; render(); return; }

    if (boss) {
      S.stats.bosses++;
      el('castPrompt').textContent = boss.desc;
    }

    const res = await window.MF_FISHING.start({
      school, bait: trip.bait,
      monster: boss ? { ...boss, fight: boss.fight } : null,
      lineLevel: S.upgrades.line, lureLevel: S.upgrades.lure,
    });

    // Retiring is allowed with a fish on the line. If the trip is already wound
    // up there is nothing left to award; if it is still running, the cast simply
    // never happened and the rod has to go back in the player's hands.
    if (!trip) return;
    if (res.cancelled) { trip.busy = false; render(); return; }

    if (boss) {
      spendStamina(boss.durationMs / 1000);
      // Losing costs HP, scaled by the rung this locale sits on. It only ends the
      // trip if it empties the bar — and then it is a cart like any other.
      if (!res.landed) {
        const hurt = Math.max(1, Math.round(
          G.bossLossDamage(trip.questHR) * (1 - trip.fresh.guard)));
        trip.hp -= hurt;
        el('castPrompt').textContent =
          `${boss.name} throws you off and is gone — ${hurt} HP.`;
        trip.busy = false; A.save(); render();
        if (trip.hp <= 0) return cartOut(boss);
        if (trip.sta <= 0) return finish('out of stamina');
        return;
      }
      trip.value += boss.reward;
      trip.haul.push({ name: boss.name, value: boss.reward, icon: bossSVG(boss, 22) });
      A.addXP(boss.xp);
      el('castPrompt').textContent = `${boss.name} landed. Worth ${z(boss.reward)}.`;
      trip.busy = false; A.save(); render();
      return;
    }

    // Stamina is charged the fish's NOMINAL fight length, not however long you
    // actually took. That is what keeps trip lengths and every quest goal sitting
    // where the balance sim put them.
    const c = res.catch || school[0];
    const secs = G.fightFor(c.fish, c.ore, S.upgrades.line).durationMs / 1000;
    tickClimate(secs);
    spendStamina(secs);
    tickBuffs(secs);

    // Something small has a go at you while your hands are full. This is what
    // makes HP worth carrying potions for away from the two hot locales.
    const pest = R.rollPest(trip.localeId, trip.questHR, trip.hired);
    if (pest) {
      pest.damage = Math.max(1, Math.round(pest.damage * (1 - trip.fresh.guard)));
      trip.hp -= pest.damage;
      S.stats.pests = (S.stats.pests || 0) + 1;
      trip.notes.push(`A ${pest.name} goes for you — ${pest.damage} HP.`);
    }

    if (res.landed) {
      S.stats.landed++;
      const isNew = A.record(c.id);
      const paid = Math.round(c.value * (1 + trip.fresh.zenny));
      trip.haul.push({ name: c.name, value: paid, icon: window.MF_GUIDE.fishImg(c.ore, 22, c.name) });
      trip.value += paid;
      A.addXP(c.xp);
      el('castPrompt').textContent = isNew
        ? `${c.name} — new to the guide.`
        : `${c.name} landed.`;

      // Something else comes up with it now and then. Drawn from what you have
      // not found yet at or below your rank, so nothing gets stranded behind you.
      const found = G.rollIngredient(S.hr, S.pantry);
      const got = found && A.recordIngredient(found.id, found.fresh);
      if (got) {
        trip.found.push({ ...found, got });
        el('castPrompt').textContent += got === 'fresh'
          ? ` And a fresh ${found.name} with it.`
          : got === 'new-fresh'
            ? ` Something came up with it — ${found.name}, and a fresh one.`
            : ` Something came up with it — ${found.name}.`;
      }
    } else {
      S.stats.lost++;
      const LOSS = {
        missed: `Too slow — ${c.name} spat the hook.`,
        slack: `The line went slack. ${c.name} shook it and ran.`,
        snap: `The line snapped. ${c.name} is gone.`,
      };
      el('castPrompt').textContent = LOSS[res.reason] || LOSS.snap;
    }

    // Spent whatever happened.
    const bid = trip.bait.id;
    if (bid !== 'no_bait') {
      trip.tackle[bid] = Math.max(0, (trip.tackle[bid] || 0) - 1);
      if (!trip.tackle[bid]) {
        delete trip.tackle[bid];
        trip.bait = A.baitBy.get('no_bait');
      }
    }

    if (trip.notes.length) {
      el('castPrompt').textContent += ' ' + trip.notes.join(' ');
      trip.notes = [];
    }

    trip.busy = false;
    A.save();
    render();
    if (trip.hp <= 0) return cartOut(null);
    if (trip.sta <= 0) return finish('out of stamina');
  }

  // Cold is paid in stamina, heat in HP — and a drink cancels whichever one you
  // are standing in. Previously this returned early whenever hpPerTick was zero,
  // which is every cold locale, so a Hot Drink was never drunk and never did
  // anything; the cold penalty applied whether you carried one or not.
  const protectedNow = () => trip.drinkLeft > 0;

  function staminaMult() {
    const climate = trip.climate === 'cold' && protectedNow() ? 1 : trip.rates.staminaMult;
    return climate * (trip.dashLeft > 0 ? G.DASH_MULT : 1);
  }

  function spendStamina(secs) {
    trip.sta -= G.STAMINA_COST.cast + secs * G.STAMINA_COST.reelTick * staminaMult();
  }

  function tickBuffs(secs) {
    if (trip.dashLeft > 0) trip.dashLeft -= secs;
  }

  function tickClimate(secs) {
    if (trip.climate === 'temperate') return;
    trip.drinkLeft -= secs;
    if (trip.drinkLeft <= 0) {
      const drink = trip.climate === 'hot' ? 'cool_drink' : 'hot_drink';
      if (trip.carried[drink] > 0) {
        trip.carried[drink]--;
        trip.drinkLeft = G.DRINK_SECONDS;
        trip.notes.push(`You drink a ${trip.climate === 'hot' ? 'Cool' : 'Hot'} Drink.`);
      }
    }
    // Only heat costs HP, and only while you are unprotected.
    if (trip.rates.hpPerTick && !protectedNow()) trip.hp -= trip.rates.hpPerTick * secs;
  }

  // ── Using an item ─────────────────────────────────────────────────────────
  //
  // Between casts only — you cannot reach the pouch with a fish on the line.
  // Nothing is used automatically any more; a potion is spent when you say so.
  // The one exception is the climate drink, which tops itself up when the last
  // one lapses, because that is upkeep you already committed to by packing it.
  // Would using this actually change anything? A full gauge means a wasted item,
  // and a climate drink does nothing at all in temperate water. The button is
  // disabled rather than the click silently eating the item.
  function wouldHelp(id) {
    const e = G.effectOf(id);
    if (id === 'cool_drink') return trip.climate === 'hot';
    if (id === 'hot_drink') return trip.climate === 'cold';
    if (e.dash) return true;                       // always worth refreshing
    const helpsHp = e.hp && trip.hp < trip.maxHP;
    const helpsSta = e.stamina && trip.sta < trip.maxSta;
    return !!(helpsHp || helpsSta);
  }

  function equipBait(id) {
    if (!trip || trip.busy) return;
    if (id !== 'no_bait' && !(trip.tackle[id] > 0)) return;
    trip.bait = A.baitBy.get(id);
    render();
  }

  function useItem(id) {
    if (!trip || trip.busy) return;
    if (!(trip.carried[id] > 0) || !wouldHelp(id)) return;
    const e = G.effectOf(id);
    trip.carried[id]--;
    if (e.hp) trip.hp = Math.min(trip.maxHP, trip.hp + e.hp);
    if (e.stamina) trip.sta = Math.min(trip.maxSta, trip.sta + e.stamina);
    if (id === 'cool_drink' || id === 'hot_drink') trip.drinkLeft = G.DRINK_SECONDS;
    if (e.dash) trip.dashLeft = G.DASH_SECONDS * e.dash;
    A.save();
    render();
  }

  // ── Ending the trip ───────────────────────────────────────────────────────
  // A cart takes the haul, not the collection. Guide entries and pantry finds are
  // already banked the moment they happen, same as before — what you learned on
  // the trip stays learned; what you were carrying does not.
  // A cart costs you everything you set out with, used or not — that is the
  // price, and it is the same price it has always been. It is charged here
  // rather than at departure so that a reload mid-trip costs nothing.
  function cartOut(boss) {
    for (const [id, n] of Object.entries(trip.packed)) {
      const item = window.MF_FISH.prep.find(p => p.id === id);
      if (item && item.buy) A.state.pouch[id] = Math.max(0, (A.state.pouch[id] || 0) - n);
    }
    for (const [id, n] of Object.entries(trip.packedTackle || {}))
      A.state.owned[id] = Math.max(0, (A.state.owned[id] || 0) - n);
    A.state.stats.carts++;
    const lost = trip.value;
    const n = trip.haul.length;
    trip = null;
    A.save();
    window.MF_UI.modal({
      cart: true,
      title: boss ? `${boss.name} won` : 'You carted',
      body: boss
        ? `${boss.name} threw you off and that was the last of you. Every one of the ${n} catch${n === 1 ? '' : 'es'} you had — ${z(lost)} — is at the bottom of the water.`
        : `You ran out of HP. The ${n} catch${n === 1 ? '' : 'es'} you were carrying — ${z(lost)} — is lost.`,
      items: [],
      onClose: () => { window.MF_UI.show('camp'); window.MF_UI.refresh(); },
    });
  }

  // Packed minus what came back = what you used. Supply items are excluded
  // because they were handed out at camp and were never in your stock.
  function spendCarried() {
    const S = A.state;
    for (const [id, packed] of Object.entries(trip.packed)) {
      const item = window.MF_FISH.prep.find(p => p.id === id);
      if (!item || !item.buy) continue;
      const used = Math.max(0, packed - (trip.carried[id] || 0));
      if (used) S.pouch[id] = Math.max(0, (S.pouch[id] || 0) - used);
    }
    for (const [id, packed] of Object.entries(trip.packedTackle || {})) {
      const used = Math.max(0, packed - (trip.tackle[id] || 0));
      if (used) S.owned[id] = Math.max(0, (S.owned[id] || 0) - used);
    }
  }

  function finish(why) {
    const S = A.state;
    const found = trip.found;
    // A quest is cleared by meeting the catch goal. Falling short is not a
    // failure — you keep the haul — the locale just stays unmarked.
    const completed = trip.value >= trip.goal;
    const goal = trip.goal;                    // trip is cleared below; keep it
    const short = goal - trip.value;
    const firstHere = completed && A.markVisited(trip.localeId, trip.questHR);
    const localeName = trip.loc.name;
    const items = trip.haul.map(c => [c.name, z(c.value)])
      .concat(found.map(f => [f.name, 'ingredient']));
    const gained = trip.value;
    A.earn(gained);
    // Only what you actually SPENT leaves your stock; the rest never left it.
    // Supply items are not yours to keep, so they are simply not counted.
    spendCarried();
    for (const id of Object.keys(trip.packed)) A.setPlan(id, A.planned(id));
    const n = trip.haul.length;
    trip = null;
    const promoted = completed ? A.checkPromotion() : null;
    A.save();

    const extra = [];
    if (firstHere && !promoted) {
      extra.push(`${localeName} cleared — ` +
        `${A.visitedCount(trip.questHR)} of ${A.hrTotal(trip.questHR)} at HR ${trip.questHR}.`);
    }
    if (!completed && short > 0)
      extra.push(`${z(short)} short of the ${z(goal)} needed to clear ${localeName}.`);
    if (promoted) extra.push(`Every locale fished. You are now HR ${promoted}, ${G.rankAt(promoted).name}.`);

    window.MF_UI.modal({
      title: promoted ? `HR ${promoted}` : 'Back at camp',
      body: (n
        ? `You ${why === 'out of stamina' ? 'came home worn out' : 'retired'} with ${n} catch${n === 1 ? '' : 'es'} worth ${z(gained)}.`
        : `You ${why === 'out of stamina' ? 'came home out of stamina' : 'retired'} with nothing to show for it.`)
        + (found.length ? ` You also picked up ${found.length} ingredient${found.length === 1 ? '' : 's'}.` : '')
        + (extra.length ? ' ' + extra.join(' ') : ''),
      items,
      onClose: () => { window.MF_UI.show('camp'); window.MF_UI.refresh(); },
    });
  }

  function retire() {
    if (!trip) return;
    window.MF_FISHING.cancel();
    finish('early');
  }

  const bossSVG = (boss, size = 52) =>
    `<img src="assets/MonsterIcons/${boss.icon}" alt="${boss.name}" width="${size}" height="${size}">`;

  window.MF_QUEST = { begin, cast, retire, render, useItem, equipBait,
    get active() { return !!trip; } };
})();
