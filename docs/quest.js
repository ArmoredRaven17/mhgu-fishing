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
    // Wipe the water before filling it. Only retire() tore the pond down, so a
    // trip that ended on stamina or in a cart left its last school, its last
    // bobber and its last result sitting there — and the next trip opened on the
    // previous one until the first cast happened to rebuild it.
    window.MF_FISHING.cancel();
    // No more "The water is still". There is water, and there are fish in it.
    el('castPrompt').textContent = '';
    const loc = R.localeById.get(S.localeId);
    const meal = A.meal();
    const questHR = A.questRung();          // the rung decides the quest's rank
    const hire = S.hired ? R.hireCost(S.localeId, questHR) : 0;
    const cats = Math.max(0, Math.min(G.PALICO.max, S.palicos || 0));
    const catCost = R.palicoCost(S.localeId, questHR, cats);
    // The cart takes ONE of whatever you handed it. It is not spent — it comes
    // home either way — but it does leave the pouch for the trip, so it cannot
    // also be combined with while it is out on the cart.
    // Gathered materials only — the same rule the picker enforces, restated here
    // so a stale save cannot smuggle a shop item onto the cart.
    const tradeOk = S.tradeItem && A.itemStock(S.tradeItem) > 0
      && G.materialById.has(S.tradeItem) && !G.isBuyableMat(S.tradeItem);
    const traded = tradeOk ? G.pouchItemById.get(S.tradeItem) : null;
    const tradeFee = R.tradeCost(S.localeId, questHR, traded);
    if (!A.spend(meal.cost + hire + catCost + tradeFee)) return;
    if (traded) S.pouch[traded.id] = Math.max(0, (S.pouch[traded.id] || 0) - 1);

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
      // Everything the pouch holds — provisions, combine materials AND the books.
      // Built from prep alone, materials and books were packed at camp, charged
      // for, and then simply not on the boat.
      carried: Object.fromEntries(G.pouchItems()
        .map(p => [p.id, A.planned(p.id)]).filter(([, n]) => n > 0)),
      packed: Object.fromEntries(G.pouchItems()
        .map(p => [p.id, A.planned(p.id)]).filter(([, n]) => n > 0)),
      // Supply items (buy 0) are not sold anywhere. Camp hands them out at Low
      // Rank only — see below.
      supplied: S.rank === G.SUPPLY_RANK,
      hired: !!hire,       // locked in at departure; you cannot hire from the water
      cats,                // Palicos gathering alongside you
      gathered: [],        // what they have picked up, handed over at the end
      gutsUsed: false,     // Guts is once a trip, and this is the once
      traded,              // what the Trade Cart is working on, or null
      landed: 0,           // fish actually landed — what the cart is paid in
      sinceBoss: 0,        // casts since one last turned up; the check cadence
      drinkLeft: 0,
      hotDrinkLeft: 0,   // a Hot Drink specifically, which Tropic Hunter reads
      dashLeft: 0, dashMult: G.DASH_MULT,
      defLeft: 0, defAmount: 0,
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
    castTaps = 0;
    // Setting out is what reveals a locale's water at this rank — see revealedRanks.
    A.markFished(S.localeId, questHR);
    A.save();
    // The pond is painted from the LOCALE, not the theme — a marsh should not
    // change colour because you picked a different monster on the title screen.
    el('pond')?.style.setProperty('--water', G.waterOf(S.localeId));
    window.MF_UI.show('quest');
    render();
    // Stock the water. After show(), so the pond has a measured size to place
    // fish in — its aspect decides what "close enough" means in both directions.
    openPool();
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
    // At Wyvern's End the tally is not what you have earned but whether you have
    // the one thing you came for, so the readout says that instead of a number
    // that would never turn the marker green however high it climbed.
    const finalHere = trip.localeId === G.FINAL_LOCALE;
    const gotIt = finalHere && trip.haul.some(h => h.name === G.FINAL_BOSS);
    el('haulGoal').textContent = finalHere
      ? (gotIt ? `${G.FINAL_BOSS} caught` : G.FINAL_BOSS)
      : `${z(trip.value)} / ${z(trip.goal)}`;
    el('haulGoal').classList.toggle('met', finalHere ? gotIt : trip.value >= trip.goal);
    el('haulList').innerHTML = trip.haul.map(c =>
      `<li>${c.icon}<span>${c.name}</span><span class="v">${z(c.value)}</span></li>`
    ).join('') + trip.found.map(f =>
      `<li class="ingr ${f.fresh ? 'fresh' : ''}"><span class="dot"></span>` +
      `<span>${f.name}</span><span class="v">${f.fresh ? 'fresh' : 'pantry'}</span></li>`
    ).join('');

    el('castBtn').disabled = trip.busy || trip.sta <= 0 || trip.hp <= 0;
    renderPouch();
    renderTackle();
    renderCombine();
    renderStatus();
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

  // ── Combining, out on the water ───────────────────────────────────────────
  //
  // A recipe is offered only when you are holding BOTH halves of it — its own
  // base and its own modifier. Each recipe names its base, so the list is what
  // you could actually do right now rather than a catalogue of what you forgot.
  //
  // The books are read from what you CARRIED, not from what you own, and the
  // chain is sequential — a third book with no first is dead weight in a slot.
  function combinable() {
    return A.BAITS
      .filter(b => b.family === 'species' || b.family === 'ore')
      // The shop's unlock gate applies here too. A locale can hand a Low Rank
      // angler a Carbalite Ore — the game's own gathering data says so — and
      // combining would otherwise turn it into a bait three ranks early,
      // straight past the gate the shop enforces.
      .filter(b => A.state.hr >= G.baitUnlockHR(b))
      .map(b => ({ bait: b, ...(G.comboRecipe(b) || {}) }))
      .filter(r => r.mod && (trip.carried[r.mod] || 0) > 0 && (trip.carried[r.base] || 0) > 0)
      .map(r => ({ ...r, rate: G.comboRate(r.bait, trip.carried, A.state.gear) }))
      .sort((a, b) => b.rate - a.rate || a.bait.name.localeCompare(b.bait.name));
  }

  function renderCombine() {
    const books = G.BOOKS.filter(b => trip.carried[b.id] > 0).length;
    const bonus = G.bookBonus(trip.carried);
    el('combineBooks').textContent = books
      ? `${books} book${books > 1 ? 's' : ''} · +${bonus}%` : 'no books';

    const rows = combinable();
    if (!rows.length) {
      el('combineList').innerHTML =
        '<li class="empty">Nothing you are carrying makes a bait.</li>';
      return;
    }
    el('combineList').innerHTML = rows.map(r => {
      const base = G.materialById.get(r.base), mod = G.materialById.get(r.mod);
      return `<li>
        <img src="${r.bait.icon}" alt="">
        <div><b>${r.bait.name}</b><span class="role">${
          base ? base.name : r.base} + ${mod ? mod.name : r.mod} &middot; ${r.rate}%</span></div>
        <span class="qty">x${trip.carried[r.mod]}</span>
        <button class="btn tiny" data-combine="${r.bait.id}" ${trip.busy ? 'disabled' : ''}>Make</button>
      </li>`;
    }).join('');
    el('combineList').querySelectorAll('[data-combine]').forEach(b =>
      b.onclick = () => combine(b.dataset.combine));
  }

  // Both halves are spent whether it works or not — that is what the books are
  // buying you, and what makes a 70% recipe a decision rather than a formality.
  function combine(baitId) {
    if (!trip || trip.busy) return;
    const bait = A.baitBy.get(baitId);
    if (!bait) return;
    const rec = G.comboRecipe(bait);
    if (!rec) return;
    if ((trip.carried[rec.base] || 0) <= 0 || (trip.carried[rec.mod] || 0) <= 0) return;

    trip.carried[rec.base]--;
    trip.carried[rec.mod]--;
    const rate = G.comboRate(bait, trip.carried, A.state.gear);
    const made = Math.random() * 100 < rate;
    if (made) {
      trip.tackle[baitId] = (trip.tackle[baitId] || 0) + 1;
      A.state.stats.combined = (A.state.stats.combined || 0) + 1;
      el('castPrompt').textContent = `${bait.name} made.`;
    } else {
      A.state.stats.comboFails = (A.state.stats.comboFails || 0) + 1;
      el('castPrompt').textContent = `The mix was no good. ${bait.name} not made.`;
    }
    A.save();
    render();
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

  }

  // ── Status ────────────────────────────────────────────────────────────────
  //
  // Everything ticking down, in one place of its own. These used to sit inside
  // the Item Pouch, which is where you go to START one — not where you want to
  // be looking to see how long you have left on it.
  function renderStatus() {
    const buffs = [];
    if (trip.climate !== 'temperate' && trip.drinkLeft > 0)
      buffs.push(`${trip.climate === 'hot' ? 'Heat' : 'Cold'} Resistant ${Math.ceil(trip.drinkLeft)}s`);
    if (trip.dashLeft > 0) buffs.push(`Dash ${Math.ceil(trip.dashLeft)}s`);
    if (trip.defLeft > 0)
      buffs.push(`+${Math.round(trip.defAmount * 100)}% DEF ${Math.ceil(trip.defLeft)}s`);

    // The climate is a standing condition rather than a timer, but it belongs
    // here too — it is the thing those drinks are answering.
    if (trip.climate !== 'temperate' && trip.drinkLeft <= 0)
      buffs.push(`<i class="exposed">Susceptible to ${trip.climate === 'hot' ? 'Heat' : 'Cold'}</i>`);

    el('buffLine').innerHTML = buffs.length
      ? buffs.map(b => b.startsWith('<i') ? b : `<span class="buff">${b}</span>`).join('')
      : '<span class="none">Nothing active.</span>';
  }

  // ── One cast ──────────────────────────────────────────────────────────────
  //
  // Stock the water, hand it to the pond, and take whatever comes back. The bait
  // is spent on the ATTEMPT — landed, snapped or missed alike — because it is the
  // bait that drew the school in, and the school is re-rolled next cast either way.
  async function cast() {
    if (!trip || trip.busy) return;
    trip.busy = true; render();
    // Clear the line before the cast, not after it. flushNotes APPENDS, so the
    // only thing keeping one result off the end of the last was every terminal
    // branch remembering to SET the prompt first — and a branch that pushed a
    // note without setting one chained onto whatever was already there. Clearing
    // here makes one action produce one line structurally rather than by the
    // discipline of six separate branches.
    el('castPrompt').textContent = '';
    const S = A.state;
    S.stats.casts++;
    // Counts CASTS, not landings: a check falls due on the cast whether or
    // not the line comes back with anything.
    trip.sinceBoss++;

    const rod = S.gear.rod, armor = S.gear;
    const ctx = { climate: trip.climate, hotDrink: trip.hotDrinkLeft > 0 };
    const boss = R.rollEncounter(trip.localeId, trip.bait, trip.questHR, Math.random, rod, armor, ctx,
      trip.sinceBoss);
    const school = boss ? [] : R.rollSchool({
      localeId: trip.localeId, bait: trip.bait, hr: trip.questHR, rod, armor,
    });
    if (!boss && !school.length) { releaseCast(); render(); return; }

    if (boss) {
      trip.sinceBoss = 0;   // it came; the count starts again
      S.stats.bosses++;
      el('castPrompt').textContent = boss.desc;
    }

    const res = await window.MF_FISHING.start({
      school, bait: trip.bait,
      monster: boss ? { ...boss, fight: boss.fight } : null,
      rod, armor, ctx, questHR: trip.questHR,
      bites: G.rodBites(rod) + G.effectPower(armor, 'bites'),
      // Applied the instant it lands, so the bar moves on the blow rather than
      // when the cast is settled up. Returns whether that put you down.
      onHit: boss ? () => {
        const bruise = Math.max(1, Math.round(
          G.bossAttackDamage(trip.questHR) * (1 - guardNow())));
        trip.hp -= bruise;
        trip.notes.push(`${bossSVG(boss, 18)}${boss.name} connects — ${bruise} HP.`);
        render();
        return trip.hp <= 0 && !spendGuts();
      } : null,
    });

    // Retiring is allowed with a fish on the line. If the trip is already wound
    // up there is nothing left to award; if it is still running, the cast simply
    // never happened and the rod has to go back in the player's hands.
    if (!trip) return;
    if (res.cancelled) { releaseCast(); render(); return; }

    // Pulled the line back before anything took it. That costs the cast — you
    // still threw it — but not the bait, since nothing was ever offered a hook.
    if (res.reason === 'reeled-in') {
      trip.sta -= G.STAMINA_COST.cast * (1 - G.effectPower(A.state.gear, 'stamina'));
      el('castPrompt').textContent = 'You reel the line back in.';
      releaseCast(); A.save(); render();
      if (trip.sta <= 0) return finish('out of stamina');
      return;
    }

    if (boss) {
      spendStamina(boss.durationMs / 1000);
      // An attack emptied the bar mid-fight. The HP was already taken and Guts
      // already had its chance, so this is simply the cart.
      if (res.reason === 'downed') {
        A.recordMonster(boss.name, boss.rank, false);
        return cartOut(boss);
      }
      // Losing costs HP, scaled by the rung this locale sits on. It only ends the
      // trip if it empties the bar — and then it is a cart like any other.
      if (!res.landed) {
        const hurt = Math.max(1, Math.round(
          G.bossLossDamage(trip.questHR) * (1 - guardNow())));
        A.recordMonster(boss.name, boss.rank, false);
        trip.hp -= hurt;
        el('castPrompt').textContent =
          `${boss.name} throws you off and is gone — ${hurt} HP.`;
        flushNotes();
        releaseCast(); A.save(); render();
        if (trip.hp <= 0 && !spendGuts()) return cartOut(boss);
        if (trip.sta <= 0) return finish('out of stamina');
        return;
      }
      const bossPaid = Math.round(boss.reward * G.payMult(trip.questHR));
      A.recordMonster(boss.name, boss.rank, true);
      trip.value += bossPaid;
      trip.haul.push({ name: boss.name, value: bossPaid, icon: bossSVG(boss, 22) });
      A.addXP(boss.xp);
      // The part it gives up, which is what the forge runs on.
      if (boss.mat) {
        // Parts: a chance it gives up a second of the same. Said as one line
        // whatever the count, because two notes for one monster reads as two
        // monsters.
        const extra = Math.random() < G.partsChance(A.state.gear) ? 1 : 0;
        for (let i = 0; i <= extra; i++) trip.gathered.push(boss.mat);
        trip.notes.push(`${bossSVG(boss, 18)}${boss.name} left behind `
          + `${extra ? '2 ' + boss.mat.name + 's' : 'a ' + boss.mat.name}.`);
      }
      el('castPrompt').textContent = `${boss.name} caught. Worth ${z(bossPaid)}.`;
      flushNotes();
      releaseCast(); A.save(); render();
      // You can win the fight and still go down from the attacks it landed.
      if (trip.hp <= 0 && !spendGuts()) return cartOut(boss);
      if (trip.sta <= 0) return finish('out of stamina');
      return;
    }

    // Stamina is charged the fish's NOMINAL fight length, not however long you
    // actually took. That is what keeps trip lengths and every quest goal sitting
    // where the balance sim put them.
    const c = res.catch || school[0];
    const secs = G.fightFor(c.fish, c.ore, rod, trip.questHR, armor, ctx).durationMs / 1000;
    tickClimate(secs);
    spendStamina(secs);
    tickBuffs(secs);

    // The cats work the bank while you work the water. What they find is HELD,
    // not banked — see finish(). Gathering mid-trip and handing it over at the
    // end is what stops a lucky pickup from changing which bait you could
    // combine while you were still standing there.
    for (const m of R.rollGather(trip.localeId, trip.questHR, trip.cats, Math.random,
                                 G.effectPower(armor, 'gather'), G.siteChance(armor)))
      trip.gathered.push(m);

    // Something small has a go at you while your hands are full. This is what
    // makes HP worth carrying potions for away from the two hot locales.
    const pest = R.rollPest(trip.localeId, trip.questHR, trip.hired, Math.random,
                            G.effectPower(S.gear, 'repel'), G.hireCut(S.gear));
    if (pest) {
      pest.damage = Math.max(1, Math.round(pest.damage * (1 - guardNow())));
      trip.hp -= pest.damage;
      S.stats.pests = (S.stats.pests || 0) + 1;
      trip.notes.push(`${pestIcon(pest.name)}A ${pest.name} attacked you — ${pest.damage} HP.`);
    }

    if (res.landed) {
      S.stats.landed++;
      trip.landed++;
      const isNew = A.record(c.id, trip.localeId, c.fish.id);
      const paid = Math.round(c.value * (1 + trip.fresh.zenny)
        * G.payMult(trip.questHR) * (1 + G.effectPower(S.gear, 'zenny')));
      trip.haul.push({ name: c.name, value: paid, icon: window.MF_GUIDE.fishImg(c.ore, 22, c.name) });
      trip.value += paid;
      A.addXP(c.xp);
      el('castPrompt').textContent = isNew
        ? `${c.name} — new to the guide.`
        : `${c.name} caught.`;

      // Something else comes up with it now and then. Drawn from what you have
      // not found yet at or below your rank, so nothing gets stranded behind you.
      // ONE per trip: the pantry is meant to fill over a campaign, not over an
      // afternoon, so a trip that has already turned something up stops rolling.
      if (!trip.found.length) {
        const found = G.rollIngredient(S.hr, S.pantry);
        if (found && A.recordIngredient(found.id)) {
          trip.found.push(found);
          el('castPrompt').textContent += ` Something came up with it — ${found.name}.`;
        }
      }
    } else {
      S.stats.lost++;
      const LOSS = {
        missed: `Too slow — ${c.name} spat the hook.`,
        slack: `The line went slack. ${c.name} shook it and ran.`,
        escaped: 'The fish snapped the line.',
        snap: `The line snapped. ${c.name} is gone.`,
      };
      el('castPrompt').textContent = LOSS[res.reason] || LOSS.snap;
    }

    // Spent whatever happened — unless Sparing Hand keeps it out of the water.
    const bid = trip.bait.id;
    const spared = Math.random() < G.effectPower(S.gear, 'saver');
    if (spared && bid !== 'no_bait') trip.notes.push('The bait came back with the line.');
    if (bid !== 'no_bait' && !spared) {
      trip.tackle[bid] = Math.max(0, (trip.tackle[bid] || 0) - 1);
      if (!trip.tackle[bid]) {
        delete trip.tackle[bid];
        trip.bait = A.baitBy.get('no_bait');
      }
    }

    flushNotes();

    releaseCast();
    A.save();
    render();
    if (trip.hp <= 0 && !spendGuts()) return cartOut(null);
    if (trip.sta <= 0) return finish('out of stamina');
  }

  // Cold is paid in stamina, heat in HP — and a drink cancels whichever one you
  // are standing in. Previously this returned early whenever hpPerTick was zero,
  // which is every cold locale, so a Hot Drink was never drunk and never did
  // anything; the cold penalty applied whether you carried one or not.
  const protectedNow = () =>
    trip.drinkLeft > 0 || G.climateFor(A.state.gear, trip.climate).immune;

  function staminaMult() {
    const climate = trip.climate === 'cold' && protectedNow() ? 1 : trip.rates.staminaMult;
    // The cut the juice you actually drank was worth, not the constant: Effect
    // Up is applied when it is drunk, so an old trip keeps what it paid for.
    return climate * (trip.dashLeft > 0 ? (trip.dashMult ?? G.DASH_MULT) : 1);
  }

  function spendStamina(secs) {
    // Long Haul takes its cut off the whole cast — the throw and the fight both.
    const cut = 1 - G.effectPower(A.state.gear, 'stamina');
    trip.sta -= (G.STAMINA_COST.cast + secs * G.STAMINA_COST.reelTick * staminaMult()) * cut;
  }

  function tickBuffs(secs) {
    if (trip.hotDrinkLeft > 0) trip.hotDrinkLeft -= secs;
    if (trip.dashLeft > 0) trip.dashLeft -= secs;
    if (trip.defLeft > 0) trip.defLeft -= secs;
  }

  // Everything queued during this cast, written out where the player can see it.
  // innerHTML rather than textContent, because a note can carry the icon of
  // whatever just bit you. Everything in here is built from our own data, not from
  // anything a player types.
  function flushNotes() {
    if (!trip || !trip.notes.length) return;
    el('castPrompt').innerHTML += ' ' + trip.notes.join(' ');
    trip.notes = [];
  }

  // The one blow a trip that does not finish you. Returns true if it caught you.
  function spendGuts() {
    if (!trip || trip.gutsUsed) return false;
    if (!G.effectPower(A.state.gear, 'guts')) return false;
    trip.gutsUsed = true;
    trip.hp = 1;
    trip.notes.push('That should have finished you. It did not.');
    render();
    return true;
  }

  // Everything that softens a hit, added up. A fresh Alcohol meal and an
  // Armorskin stack, but not without limit — something always gets through.
  const guardNow = () =>
    Math.min(0.75, trip.fresh.guard + (trip.defLeft > 0 ? trip.defAmount : 0)
      // What you are WEARING, which is the whole reason armor exists and the
      // reason monster damage is allowed to climb with the rank at all.
      + G.armorStat(A.state.gear, 'guard')
      + G.effectPower(A.state.gear, 'defense'));

  // Nothing is drunk for you. A climate drink used to top itself up the moment the
  // last one lapsed, which spent items you might have been saving and made the
  // decision for you — the pulsing gauge says when you are exposed, and reaching
  // for the pouch is your call.
  function tickClimate(secs) {
    if (trip.climate === 'temperate') return;
    // Heat Cancel / Cold Cancel: the climate simply does not reach you.
    if (G.climateFor(A.state.gear, trip.climate).immune) return;
    if (trip.drinkLeft > 0) trip.drinkLeft -= secs;
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
    // A guard against the climate you are actually standing in is worth taking on
    // its own, full gauges or not — that is the whole point of a drink.
    if (e.protects === trip.climate) return true;
    // Against a climate you are NOT in it does nothing, so a plain drink is dead
    // weight here. A meat still has the food half to offer, so it falls through.
    if (e.protects && !e.stamina && !e.hp) return false;
    // A bomb is worth throwing whenever you can pay for it. Nothing about your
    // gauges makes it pointless, only empty stamina does.
    if (e.bomb) return trip.sta >= G.STAMINA_COST.cast * G.BOMB.staminaMult;
    if (e.dash || e.def) return true;              // always worth refreshing
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
    // Effect Up — Gluttony's Gourmand and Scavenger, in one number.
    const more = 1 + G.effectPower(A.state.gear, 'effectup');
    trip.carried[id]--;
    if (e.bomb) { throwBomb(id); return; }
    if (e.hp) trip.hp = Math.min(trip.maxHP, trip.hp + e.hp * more);
    if (e.stamina) trip.sta = Math.min(trip.maxSta, trip.sta + e.stamina * more);
    // A Hot Drink is the wrong drink for hot water, but Tropic Hunter wants it
    // there, so track it whether or not it is guarding you against anything.
    // A drink's length is Heat Resist's and Cold Resist's business and NOBODY
    // else's — not Effect Up, not Duration. Two skills doing one job means
    // neither reads as its own thing, and three meant a drink could run twenty
    // minutes. The climate skill is the only multiplier here.
    if (e.protects === 'cold') trip.hotDrinkLeft = G.DRINK_SECONDS;
    if (e.protects === trip.climate)
      trip.drinkLeft = G.DRINK_SECONDS * G.climateFor(A.state.gear, trip.climate).drinkMult;
    // Dash and Armorskin DO take Effect Up — on how much they do, never on how
    // long they last, because how long is Duration's job and doubling up there
    // would recreate exactly the overlap the drinks just lost.
    //
    // Dash Juice has no per-item magnitude: `dash` is 1 or 2 and means how long,
    // while the cut itself is the global DASH_MULT. So Effect Up deepens the cut.
    if (e.dash) {
      trip.dashLeft = G.dashSeconds(A.state.gear) * e.dash;
      // DIVIDE the remaining cost rather than deepening the cut against a cap:
      // capping it meant Effect Up 2 already bought everything Dash had to give
      // and levels 3 to 5 did nothing at all. This way every level still moves
      // the number, and a cast can approach free without ever reaching it.
      trip.dashMult = Math.max(0.15, G.DASH_MULT / more);
    }
    if (e.def) {
      trip.defLeft = G.armorSeconds(A.state.gear) * e.secs;
      trip.defAmount = e.def * more;
    }
    A.save();
    render();
  }

  // ── Bombs ─────────────────────────────────────────────────────────────────
  //
  // Everything inside the blast comes up at once, bruised and worth less for it.
  // No minigame: a bomb is the thing you throw when you do not want to fight for
  // it, so fighting for it would be the wrong price. The price is stamina, the
  // item, and what the fish are worth.
  //
  // They count a FRACTION toward the basket and the cart — see BOMB.countFraction
  // and the reasoning beside it. Without that a bomb is simply a faster rod.
  // One fish for the pool. The pond asks; it never learns what decides a catch.
  function poolRoll() {
    if (!trip) return null;
    return R.rollCatch({ localeId: trip.localeId, bait: trip.bait, hr: trip.questHR,
                         rod: A.state.gear.rod, armor: A.state.gear });
  }
  function openPool() {
    if (!trip) return;
    window.MF_FISHING.openPool({ roll: poolRoll, armor: A.state.gear });
  }

  async function throwBomb(id) {
    const S = A.state;
    el('castPrompt').textContent = '';   // same rule as a cast
    const bomb = G.effectOf(id);
    trip.sta -= G.STAMINA_COST.cast * G.BOMB.staminaMult;
    S.stats.casts++;
    // A bomb advances the monster clock exactly as a cast does. It did not, and
    // that was a hole: bombing is an action on the water that costs MORE stamina
    // than a cast, so a trip spent bombing would have filled the basket while
    // never once advancing sinceBoss — large monsters avoided entirely, and the
    // rod left as the option that gets you hurt.
    //
    // The check still falls on a CAST. A blast draws them; you meet what it drew
    // the next time you put a line in.
    trip.sinceBoss++;

    const mult = G.bombValueMult(S.gear);
    // Aimed at the REAL pool rather than a freshly rolled school: what it catches
    // is whatever was actually inside the circle when it went off.
    trip.busy = true; render();
    const res = await window.MF_FISHING.throwBomb({
      radius: G.bombRadius(id, S.gear),
      icon: (G.pouchItemById.get(id) || {}).icon || 'MH4G-Bomb_Icon_Red.png',
    });
    trip.busy = false;
    const took = res.caught || [];
    if (!took.length) {
      trip.notes.push('The bomb goes off and nothing floats up.');
    } else {
      let gained = 0;
      for (const c of took) {
        A.record(c.id, trip.localeId, c.fish.id);
        const paid = Math.round(c.value * mult * (1 + trip.fresh.zenny)
          * G.payMult(trip.questHR) * (1 + G.effectPower(S.gear, 'zenny')));
        trip.haul.push({ name: c.name, value: paid,
                         icon: window.MF_GUIDE.fishImg(c.ore, 22, c.name) });
        trip.value += paid;
        gained += paid;
        S.stats.landed++;
      }
      // Fractional on purpose. Rounded only where it is read, so three bombs do
      // not quietly lose what each one's remainder was worth.
      trip.landed += took.length * G.BOMB.countFraction;
      // Not "bruised" — the value is right there, and saying it is worth less
      // than it looks is the kind of explaining the player can do for himself.
      trip.notes.push(`The blast brings up ${took.length} fish — ${z(gained)}.`);
    }
    A.save();
    // Notes are queued, not printed: every other path flushes them and this one
    // did not, so the blast happened in silence.
    flushNotes();
    render();
    if (trip.sta <= 0) finish('out of stamina');
  }

  // ── Ending the trip ───────────────────────────────────────────────────────
  // A cart takes the haul, not the collection. Guide entries and pantry finds are
  // already banked the moment they happen, same as before — what you learned on
  // the trip stays learned; what you were carrying does not.
  // A cart costs you everything you set out with, used or not — that is the
  // price, and it is the same price it has always been. It is charged here
  // rather than at departure so that a reload mid-trip costs nothing.
  function cartOut(boss) {
    window.MF_FISHING.cancel();
    for (const [id, n] of Object.entries(trip.packed)) {
      const item = G.pouchItemById.get(id);
      // Supply items were never yours; everything else was, whether you bought it
      // or a Palico handed it to you.
      if (item && (item.buy || item.kind === 'mat'))
        A.state.pouch[id] = Math.max(0, (A.state.pouch[id] || 0) - n);
    }
    for (const [id, n] of Object.entries(trip.packedTackle || {}))
      A.state.owned[id] = Math.max(0, (A.state.owned[id] || 0) - n);
    A.state.stats.carts++;
    // Gathered materials go down with the haul — they were never banked, and a
    // cart is a cart.
    const gatheredLost = trip.gathered.length;
    const cartLost = trip.traded ? trip.traded.name : null;
    const lost = trip.value;
    const n = trip.haul.length;
    trip = null;
    A.rerollFresh();          // back at camp, even the hard way
    A.dropEmptyPlans();       // ...and a cart empties the pack outright
    A.save();
    window.MF_UI.modal({
      cart: true,
      title: boss ? `${boss.name} won` : 'You carted',
      body: (boss
        ? `${boss.name} threw you off and that was the last of you. Every one of the ${n} catch${n === 1 ? '' : 'es'} you had — ${z(lost)} — is at the bottom of the water.`
        : `You ran out of HP. The ${n} catch${n === 1 ? '' : 'es'} you were carrying — ${z(lost)} — is lost.`)
        + (gatheredLost ? ` The Palicos lose the ${gatheredLost} material${gatheredLost === 1 ? '' : 's'} they had gathered.` : '')
        + (cartLost ? ` The Trade Cart goes with you, and your ${cartLost} with it.` : ''),
      items: [],
      onClose: () => {
        A.rollSightings(); A.save();     // a fresh report, once, back in camp
        window.MF_UI.show('camp'); window.MF_UI.refresh();
      },
    });
  }

  // Packed minus what came back = what you used. Supply items are excluded
  // because they were handed out at camp and were never in your stock.
  function spendCarried() {
    const S = A.state;
    for (const [id, packed] of Object.entries(trip.packed)) {
      const item = G.pouchItemById.get(id);
      if (!item || !(item.buy || item.kind === 'mat')) continue;
      const used = Math.max(0, packed - (trip.carried[id] || 0));
      if (used) S.pouch[id] = Math.max(0, (S.pouch[id] || 0) - used);
    }
    // Bait settles on the DIFFERENCE, signed, over every kind that was either
    // packed or turned up during the trip. Stock is never deducted at departure,
    // so what you owe is simply what left the box: pack five and come back with
    // three and you are down two; combine two more than you packed and you are up
    // two. Subtracting only would have thrown away anything you made out there,
    // and worse, a bait you both packed AND made would have looked like it was
    // never used at all.
    const kinds = new Set([...Object.keys(trip.packedTackle || {}), ...Object.keys(trip.tackle || {})]);
    for (const id of kinds) {
      if (id === 'no_bait') continue;                 // free and unlimited
      const delta = (trip.tackle[id] || 0) - ((trip.packedTackle || {})[id] || 0);
      if (delta) S.owned[id] = Math.max(0, (S.owned[id] || 0) + delta);
    }
  }

  function finish(why) {
    const S = A.state;
    window.MF_FISHING.cancel();
    const found = trip.found;
    // A quest is cleared by meeting the catch goal. Falling short is not a
    // failure — you keep the haul — the locale just stays unmarked.
    // EVERYTHING taken off the trip is read here, before it is cleared below.
    // Reaching for trip.* after that point throws, and because the only reader
    // was the first-clear message it broke exactly one case: retiring on a quest
    // you had just completed for the first time. The button simply stopped
    // responding, since the throw happened before the modal opened.
    // Wyvern's End is cleared by LANDING Nakarkos, not by what you bring home.
    // Everywhere else a goal is the contract; there, the monster is.
    const isFinal = trip.localeId === G.FINAL_LOCALE;
    const completed = isFinal
      ? trip.haul.some(h => h.name === 'Nakarkos')
      : trip.value >= trip.goal;
    const goal = trip.goal;
    const questHR = trip.questHR;
    const short = goal - trip.value;
    const firstHere = completed && A.markVisited(trip.localeId, questHR);
    const localeName = trip.loc.name;
    // Built here, added to below once the cats have handed over — what they
    // brought is part of what you came home with, so it belongs in the same list
    // as the fish rather than in a sentence underneath it.
    const items = trip.haul.map(c => [c.name, z(c.value)])
      .concat(found.map(f => [f.name, 'ingredient']));
    const gained = trip.value;
    // Counted, not valued: a basket full of cheap fish earns it exactly as a
    // basket full of dear ones does. Only reachable here, so carting loses it.
    const basket = G.basketBonus(trip.landed, questHR, A.state.gear);
    A.earn(gained + basket);
    // Only what you actually SPENT leaves your stock; the rest never left it.
    // Supply items are not yours to keep, so they are simply not counted.
    spendCarried();
    // The cats hand over here, and only here. Carried home like the fish, which
    // means a cart loses them too — see cartOut.
    const brought = handOverGathered();
    const cart = handOverTrade();
    // The plan is NOT rewritten here. It holds what you want to bring, so coming
    // home short just means you bring fewer next time until you restock — at
    // which point the pouch fills back to what you asked for on its own.
    const n = trip.haul.length;
    trip = null;
    const promoted = completed ? A.checkPromotion() : null;
    A.rerollFresh();          // back at camp: today's fresh ingredients
    A.dropEmptyPlans();       // anything you ran clean out of gives up its slot
    A.save();

    const extra = [];
    if (firstHere && !promoted) {
      extra.push(`${localeName} cleared — ` +
        `${A.visitedCount(questHR)} of ${A.hrTotal(questHR)} at HR ${questHR}.`);
    }
    if (!completed && short > 0 && !isFinal)
      extra.push(`${z(short)} short of the ${z(goal)} needed to clear ${localeName}.`);
    // No goal to fall short of here — you either landed it or you did not.
    if (!completed && isFinal)
      extra.push(`Nakarkos is still out there.`);
    if (promoted) extra.push(`Every locale fished. You are now HR ${promoted}, ${G.rankAt(promoted).name}.`);
    if (basket) {
      extra.push(`A full basket — ${G.basketTarget(A.state.gear)} fish caught, ${z(basket)} bonus.`);
      items.push(['Full basket', z(basket)]);
    }
    if (cart) {
      extra.push(cart.extra
        ? `The Trade Cart returns your ${cart.name} and ${cart.extra} more.`
        : `The Trade Cart returns your ${cart.name}.`);
      items.push([cart.name, cart.extra ? `traded, +${cart.extra}` : 'traded, returned']);
    }
    if (brought.length) {
      const total = brought.reduce((a, b) => a + b.n, 0);
      extra.push(`The Palicos hand over ${total} material${total === 1 ? '' : 's'}.`);
      for (const b of brought) items.push([b.name, b.n > 1 ? `gathered x${b.n}` : 'gathered']);
    }

    window.MF_UI.modal({
      title: promoted ? `HR ${promoted}` : 'Back at camp',
      body: (n
        ? `You ${why === 'out of stamina' ? 'came home worn out' : 'retired'} with ${n} catch${n === 1 ? '' : 'es'} worth ${z(gained)}.`
        : `You ${why === 'out of stamina' ? 'came home out of stamina' : 'retired'} with nothing to show for it.`)
        + (found.length ? ` You also picked up ${found.length} ingredient${found.length === 1 ? '' : 's'}.` : '')
        + (extra.length ? ' ' + extra.join(' ') : ''),
      items,
      onClose: () => {
        A.rollSightings(); A.save();     // a fresh report, once, back in camp
        window.MF_UI.show('camp'); window.MF_UI.refresh();
      },
    });
  }

  function retire() {
    if (!trip) return;
    window.MF_FISHING.cancel();
    finish('early');
  }

  const bossSVG = (boss, size = 52) =>
    `<img src="assets/MonsterIcons/${boss.icon}" alt="${boss.name}" width="${size}" height="${size}">`;

  // Everything the Palicos picked up, banked into the pouch. Returns a summary
  // so the trip can say what came back, and respects the same ownership cap the
  // shop does — a cat cannot push you past 99 of anything.
  function handOverGathered() {
    if (!trip || !trip.gathered.length) return [];
    const count = {};
    for (const m of trip.gathered) count[m.id] = (count[m.id] || 0) + 1;
    const out = [];
    for (const [id, n] of Object.entries(count)) {
      const part = G.monsterMatById.get(id);
      if (part) {
        A.state.mats[id] = Math.min(G.STOCK_CAP, (A.state.mats[id] || 0) + n);
        out.push({ name: part.name, n });
        continue;
      }
      const have = A.state.pouch[id] || 0;
      const take = Math.max(0, Math.min(n, G.ownCap(id) - have));
      if (!take) continue;
      A.state.pouch[id] = have + take;
      A.seeMaterial(id);
      out.push({ name: (G.materialById.get(id) || { name: id }).name, n: take });
    }
    return out;
  }

  // The cart settles up. What you handed over always comes back — that is the
  // whole shape of the service — with one more for every few fish you landed.
  // Returns { name, back, extra } so the trip can say what happened, or null.
  function handOverTrade() {
    if (!trip || !trip.traded) return null;
    const id = trip.traded.id;
    const extra = R.tradeExtra(trip.landed, G.effectPower(A.state.gear, 'trade'),
                               A.cartLevel());
    const have = A.state.pouch[id] || 0;
    const room = Math.max(0, G.ownCap(id) - have);
    const back = Math.min(1 + extra, room);
    if (back) A.state.pouch[id] = have + back;
    if (G.materialById.has(id)) A.seeMaterial(id);
    return { name: trip.traded.name, back, extra: Math.max(0, back - 1) };
  }

  // The thing that just hit you, in the line that says so. Small monsters carry
  // the same icons the large ones do; the filename is the name with its spaces
  // underscored, and anything without art falls back to the question mark rather
  // than showing a broken image.
  function pestIcon(name) {
    const file = `MHGU-${name.replace(/ /g, '_')}_Icon.webp`;
    return `<img class="pest-icon" src="assets/MonsterIcons/${file}" alt="" ` +
      `onerror="this.src='assets/MonsterIcons/MHGU-Question_Mark_Icon.webp'">`;
  }

  // ── Casting from the keyboard ─────────────────────────────────────────────
  //
  // Opt-in, and never a single press. Space belongs to the POND — striking and
  // reeling — so a one-tap cast would fire on every stray press left over from
  // the fight you just finished. This borrows the reel-in check instead, at
  // three taps rather than five, and forgets a part-finished cast after a short
  // window so taps minutes apart never add up to one.
  //
  // Bound with addEventListener rather than window.onkeydown, because that
  // property is the pond's and fishing.js overwrites it for the length of a
  // cast. The busy check is what keeps the two from ever both acting.
  let castTaps = 0, castTapAt = 0, castLockUntil = 0;

  // Handing the cast button back. The lockout is the important half: a player
  // still hammering Space at the end of a reel would otherwise roll those
  // presses straight into the next cast, which is the exact accident the whole
  // three-tap check exists to prevent. Taps only start counting once the water
  // has been quiet for a moment.
  function releaseCast() {
    if (trip) trip.busy = false;
    castTaps = 0;
    castLockUntil = performance.now() + 450;
    // A cast owns the pond while it runs and empties it on the way out, so the
    // pool is opened again every time one lets go. Anything else leaves the
    // water blank between casts, which is the state this replaced.
    openPool();
  }

  function castKey(e) {
    if (e.code !== 'Space' || e.repeat) return;
    const S = A.state;
    if (!S.spaceToCast || !trip || trip.busy) return;      // the pond has Space
    if (!el('quest').classList.contains('active')) return;
    if (el('castBtn').disabled) return;
    e.preventDefault();

    const now = performance.now();
    if (now < castLockUntil) { castTaps = 0; return; }
    if (now - castTapAt > G.CAST_PRESS_WINDOW_MS) castTaps = 0;
    castTapAt = now;
    castTaps++;

    const need = G.CAST_PRESSES;
    if (castTaps < need) {
      el('castPrompt').textContent =
        `Casting… ${'●'.repeat(castTaps)}${'○'.repeat(need - castTaps)}`;
      return;
    }
    castTaps = 0;
    cast().then(() => window.MF_UI.refresh());
  }
  window.addEventListener('keydown', castKey);

  window.MF_QUEST = { begin, cast, retire, render, useItem, equipBait,
    get active() { return !!trip; } };
})();
