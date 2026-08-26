// bench.js — a stand for the reel, kept out of the game entirely.
//
// It loads the same data, the same game.js and the same fishing.js the app does,
// then hands the pond a school it built by hand. Nothing under docs/ that the
// game actually loads knows this file exists, so a change here can never alter
// how the game plays. That is the whole point of it being a separate page.
(function () {
  const el = id => document.getElementById(id);
  const G = window.MF_GAME, F = window.MF_FISH, O = window.CF_ORES;

  // fishing.js asks the guide for a fish sprite. That is the only thing it wants
  // from the app, so the bench supplies it rather than pulling app.js in behind
  // it and dragging saves, state and the whole UI along.
  window.MF_GUIDE = window.MF_GUIDE || {
    fishImg: (ore, size = 28, alt = '') =>
      `<img src="assets/FishIcons/${G.variantIcon(ore)}" width="${size}" height="${size}" alt="${alt}">`,
  };
  if (window.MF_THEME && window.MF_THEME.init) window.MF_THEME.init();

  const fill = (sel, rows, blank) => {
    el(sel).innerHTML = (blank ? `<option value="">${blank}</option>` : '') +
      rows.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
  };
  fill('fish', [...F.fish].sort((a, b) => a.rarity - b.rarity || a.name.localeCompare(b.name)));
  fill('ore', O.list);
  fill('monster', Object.values(G.BOSS).map(b => ({
    id: b.name, name: b.name + '  [' + [...G.bossRanks[b.name]].join('/') + ']' })), 'none');
  fill('rod', G.RODS.map(r => ({ id: r.id, name: r.name + ' (' + r.rank + ')' })), 'bare hands');
  fill('armor', G.ARMORS.map(a => ({ id: a.id, name: a.name })), 'none');
  // A real locale rather than a bare climate, so the climate comes off the game's
  // own map — what the bench tests is somewhere you can actually stand.
  fill('locale', (window.MF_LOCALES || []).filter(l => l.hasFishing)
    .map(l => ({ id: l.id, name: l.name + '  (' + G.climateOf(l.id) + ')' })));
  el('locale').value = 'volcanic_hollow';   // hot, so Heat Hunter is live on open
  el('rodLvl').max = G.ROD_LEVELS;
  el('armorLvl').max = G.ARMOR_LEVELS;

  const num = id => Number(el(id).value) || 0;
  // Gear exactly as the game states it: {id, lvl}, or null for nothing equipped.
  const picked = () => ({
    fish: F.fish.find(f => f.id === el('fish').value),
    ore: O.list.find(o => o.id === el('ore').value),
    bossName: el('monster').value || null,
    rod: el('rod').value ? { id: el('rod').value, lvl: num('rodLvl') } : null,
    armor: el('armor').value ? { id: el('armor').value, lvl: num('armorLvl') } : null,
    // Where you are standing and what you drank. Heat Hunter widens the line in
    // hot water, and doubles that with a Hot Drink in hand, so without this the
    // whole second half of Tropic Hunter cannot be seen here.
    ctx: {
      climate: G.climateOf(el('locale').value),
      hotDrink: el('hotDrink').checked,
      coolDrink: el('coolDrink').checked,
    },
  });

  // What the fight is made of, read from the same fightFor the pond uses — so
  // the numbers on screen cannot drift from the one you then play.
  function nums() {
    const { fish, ore, bossName, rod, armor, ctx } = picked();
    const hr = num('hr');
    const boss = bossName ? G.bossAt(bossName, hr, rod, armor, ctx) : null;
    const f = boss ? boss.fight
      : (fish && ore ? G.fightFor(fish, ore, rod, hr, armor, ctx) : null);
    if (!f) { el('nums').innerHTML = ''; return; }
    const row = (k, v) => `<span>${k}</span><span>${v}</span>`;
    const worth = boss ? boss.reward
      : Math.round(G.variantValue(fish, ore) * G.payMult(hr));
    const absent = bossName && !G.bossMeetableAt(bossName, G.curveRank(hr));
    el('nums').innerHTML =
      `<b>${boss ? boss.name : G.variantName(fish, ore)}</b>` +
      (absent ? row('NOT HERE', 'not met at ' + G.curveRank(hr) + ' Rank') : '') +
      row('worth', worth.toLocaleString() + 'z') +
      row('presses', (f.sinkPerSec / f.liftPerPress).toFixed(2) + '/s') +
      row('band', (f.band * 200).toFixed(1) + '% of track') +
      row('sink', f.sinkPerSec.toFixed(3) + '/s') +
      row('lift', f.liftPerPress.toFixed(3) + '/press') +
      row('grace', (f.band / f.sinkPerSec).toFixed(2) + 's') +
      row('escape', (f.escapePerSec / f.progressPerSec).toFixed(2) + 'x gain') +
      row('strike', Math.round(f.strikeWindowMs) + 'ms');
  }
  function worn() {
    const a = G.armorById.get(el('armor').value);
    if (!a) { el('worn').innerHTML = ''; return; }
    const lvl = num('armorLvl');
    const row = (k, v) => '<span>' + k + '</span><span>' + v + '</span>';
    el('worn').innerHTML =
      '<b>' + a.name + ' (' + a.rank + ')</b>'
      + a.effects.map(e => {
          const def = G.EFFECTS[e.key];
          // Climate effects have no `per` to multiply — they are a ladder of
          // states, not a percentage, and reading one as a number gives NaN.
          const val = def.flag ? 'on'
            : def.climate ? 'Lv ' + e.lvl + (e.lvl >= 3 ? ' (negates)' : '')
            : '+' + Math.round(def.per * e.lvl * 100) + '%';
          return row(G.effectName(e.key, e.lvl), val);
        }).join('')
      + row('HP', '+' + G.armorStat({ id: a.id, lvl: lvl }, 'hp'))
      + row('stamina', '+' + G.armorStat({ id: a.id, lvl: lvl }, 'stamina'))
      + row('guard', Math.round(G.armorStat({ id: a.id, lvl: lvl }, 'guard') * 100) + '%')
      + row('forged from', a.mat ? a.matCount + ' x ' + a.mat.name : '-')
      + (() => {
          const ctx = { climate: G.climateOf(el('locale').value),
                        hotDrink: el('hotDrink').checked };
          const cl = G.climateFor({ id: a.id, lvl: lvl }, ctx.climate);
          const hb = G.heatBand({ id: a.id, lvl: lvl }, ctx);
          return (cl.lvl ? row('climate here', cl.immune ? 'immune'
                    : 'drinks x' + cl.drinkMult) : '')
            + (hb ? row('heat bonus', '+' + Math.round(hb * 100) + '% band') : '');
        })();
  }

  // Every suit in the game and what it grants, because the whole point of armor
  // being a choice rather than a ladder is being able to compare them side by side.
  function listArmor() {
    const lines = [];
    for (const key of Object.keys(G.ARMOR_LINES)) {
      const L = G.ARMOR_LINES[key];
      const sets = G.ARMORS.filter(a => a.line === key);
      lines.push('== ' + L.name + ' == ' + G.effectName(L.a, 1) + ' + ' + G.effectName(L.b, 1)
        + (L.third ? ',  G adds ' + G.effectName(L.third, 1) : ''));
      for (const a of sets) {
        const eff = a.effects.map(e => G.effectName(e.key, e.lvl)).join(' + ');
        lines.push('  ' + a.name.padEnd(16)
          + ('HP+' + a.hp).padEnd(8)
          + ('sta+' + a.stamina).padEnd(9)
          + ('guard ' + Math.round(a.guard * 100) + '%').padEnd(11)
          + eff);
        lines.push('  ' + ' '.repeat(16) + a.matCount + ' x ' + (a.mat ? a.mat.name : '-')
          + '  +  ' + a.cost.toLocaleString() + 'z');
      }
    }
    lines.push('');
    lines.push('== every effect ==');
    for (const k of Object.keys(G.EFFECTS)) {
      const e = G.EFFECTS[k];
      lines.push('  ' + k.padEnd(10) + e.tiers.join(' -> ').padEnd(52)
        + (e.flag ? 'flag' : '+' + Math.round(e.per * 100) + '% a level'));
      lines.push('  ' + ' '.repeat(10) + e.blurb);
    }
    el('log').innerHTML =
      '<pre style="margin:0;white-space:pre;font:11px ui-monospace,monospace">'
      + lines.join(String.fromCharCode(10)) + '</pre>';
  }
  el('listArmor').onclick = listArmor;

  for (const id of ['fish', 'ore', 'monster', 'hr', 'rod', 'rodLvl', 'armor', 'armorLvl',
                    'locale', 'hotDrink', 'coolDrink'])
    el(id).onchange = el(id).oninput = () => { nums(); worn(); };

  // Outcomes, which is the thing actually being measured. A band you lose to
  // three times in ten is a different number from one you never lose to.
  const ORDER = ['landed', 'missed', 'slack', 'snap', 'escaped', 'reeled-in', 'other'];
  const tally = {};
  for (const k of ORDER) tally[k] = 0;

  function drawTally() {
    const n = ORDER.reduce((a, k) => a + tally[k], 0);
    const pct = v => n ? ` <i>${(100 * v / n).toFixed(0)}%</i>` : '';
    el('tally').innerHTML =
      `<b>${n} attempt${n === 1 ? '' : 's'}</b><span></span>` +
      ORDER.filter(k => tally[k]).map(k =>
        `<span>${k}</span><span>${tally[k]}${pct(tally[k])}</span>`).join('');
  }

  function record(res, name) {
    const key = res.landed ? 'landed'
      : (tally[res.reason] !== undefined ? res.reason : 'other');
    tally[key]++;
    const d = document.createElement('div');
    d.className = res.landed ? 'win' : 'lose';
    d.textContent = `${key}  ${name}`;
    el('log').prepend(d);
    drawTally();
  }

  function cast() {
    const { fish, ore, bossName, rod, armor, ctx } = picked();
    const hr = num('hr');
    const boss = bossName ? G.bossAt(bossName, hr, rod, armor, ctx) : null;
    if (!boss && (!fish || !ore)) return;
    const one = () => ({
      fish, ore, id: G.variantId(fish, ore), name: G.variantName(fish, ore),
      icon: G.variantIcon(ore), value: G.variantValue(fish, ore),
      xp: G.xpFor(fish, ore), matches: false,
    });
    const bait = { id: 'no_bait', name: 'No Bait', family: 'none' };
    const bites = G.rodBites(rod) + G.effectPower(armor, 'bites');
    const spec = boss
      ? { school: [], bait, monster: { ...boss, c: boss }, questHR: hr, rod, armor, ctx, bites }
      : { school: Array.from({ length: Math.max(1, num('school')) }, one), bait,
          questHR: hr, rod, armor, ctx, bites };

    el('castPrompt').textContent = '';
    window.MF_FISHING.start(spec).then(res => {
      if (res.cancelled) return;
      record(res, boss ? boss.name : G.variantName(fish, ore));
      el('castPrompt').textContent = 'Cast again when ready.';
    });
  }

  // What the bench is actually for: every rod against each rank's cheap, median
  // and dearest fish, in presses per second. The gate is meant to sit INSIDE a
  // rank — the last rank's best rod clears the early fish and fails the late
  // ones — so this is the one screen that says whether that is true yet.
  function sweep() {
    const lines = [];
    const rods = [null].concat(
      G.RODS.map(r => ({ id: r.id, lvl: 0 })),
      G.RODS.map(r => ({ id: r.id, lvl: G.ROD_LEVELS })));
    const label = r => !r ? 'bare hands'
      : G.rodById.get(r.id).name + (r.lvl ? ' Lv' + r.lvl : '');
    for (const rankHR of [['Low', 3], ['High', 8], ['G', 12]]) {
      const rank = rankHR[0], hr = rankHR[1];
      const ores = O.list.filter(o => G.oreUnlockHR(o) <= G.RANK_HR[rank]);
      const all = [];
      for (const f of F.fish) {
        if (G.fishUnlockHR(f) > G.RANK_HR[rank]) continue;
        for (const o of ores) all.push({ f: f, o: o, v: G.variantValue(f, o) });
      }
      all.sort((a, b) => a.v - b.v);
      const at = q => all[Math.round(q * (all.length - 1))];
      const picks = [['cheap', at(0.1)], ['median', at(0.5)], ['top', at(0.95)]];
      lines.push('== ' + rank + ' Rank (HR' + hr + ') ==');
      for (const r of rods) {
        const cells = picks.map(pk => {
          const t = G.fightFor(pk[1].f, pk[1].o, r, hr, null);
          return pk[0] + ' ' + (t.sinkPerSec / t.liftPerPress).toFixed(1) + '/s';
        });
        lines.push('  ' + label(r).padEnd(20) + ' ' + cells.join('   '));
      }
      const best = G.RODS.filter(r => r.rank === rank).pop();
      const ownRod = { id: best.id, lvl: G.ROD_LEVELS };
      for (const name of Object.keys(G.BOSS)) {
        if (!G.bossMeetableAt(name, rank)) continue;
        const b = G.bossAt(name, hr, ownRod, null);
        lines.push('  * ' + name.padEnd(16)
          + (b.fight.sinkPerSec / b.fight.liftPerPress).toFixed(1) + '/s'
          + '   band ' + (b.fight.band * 200).toFixed(0) + '%'
          + '   esc ' + (b.fight.escapePerSec / b.fight.progressPerSec).toFixed(1) + 'x'
          + '   ' + b.reward.toLocaleString() + 'z');
      }
    }
    lines.push("(* monsters shown holding that rank's own rod at max level)");
    el('log').innerHTML =
      '<pre style="margin:0;white-space:pre;font:11px ui-monospace,monospace">'
      + lines.join(String.fromCharCode(10)) + '</pre>';
  }

  el('sweep').onclick = sweep;
  el('cast').onclick = cast;
  el('reset').onclick = () => {
    for (const k of ORDER) tally[k] = 0;
    el('log').innerHTML = '';
    drawTally();
  };

  // Enter recasts, so a run of twenty is twenty keypresses rather than twenty
  // trips to the button. Space belongs to the rod while a fight is live.
  window.addEventListener('keydown', e => {
    if (e.code === 'Enter') { e.preventDefault(); cast(); }
  });

  drawTally();
  nums();
  worn();
})();
