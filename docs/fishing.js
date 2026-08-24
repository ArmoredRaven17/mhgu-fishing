// fishing.js — the pond.
//
// A cast fills the water with a school and drops the bobber in the middle. Fish
// drift; with a bait in the water they are drawn to the bobber. One comes close
// enough to nibble, and a nibble may take it under — the bobber turns grey, and
// that is the cue. Strike inside the window, then work the line: it starts half
// full and falls on its own, every press pulls it back up, and BOTH ends lose —
// let it run out and the line goes slack and the fish is off, drive it to the top
// and the line snaps. You only gain ground while it holds near the middle.
//
// Three phases in one rAF loop: swim -> hooked -> reel.
//
// Everything is measured in fractions of the pond rather than pixels, so the
// surface can be any size. Horizontal distance is corrected for the pond's aspect
// so "close enough to nibble" means the same in both directions.

(function () {
  const el = id => document.getElementById(id);
  const G = () => window.MF_GAME;

  let raf = null;
  let state = null;

  // ── Teardown ──────────────────────────────────────────────────────────────
  //
  // Retiring is allowed with a fish on the line, so tearing down has to settle
  // the promise cast() is sitting on. Otherwise the trip ends but the await
  // never returns and the cast is left half-resolved.
  function cleanup() {
    const pending = state && !state.settled ? state : null;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    window.onkeydown = window.onkeyup = null;
    const pond = el('pond');
    if (pond) pond.innerHTML = '';
    el('reel')?.classList.add('hidden');
    el('castArea')?.classList.remove('hidden');
    el('tensionWrap')?.classList.add('hidden');
    el('tensionTrack')?.classList.remove('out', 'low');
    el('tensionWrap')?.classList.remove('strike');
    state = null;
    if (pending) { pending.settled = true; pending.resolve({ landed: false, cancelled: true }); }
  }

  // ── One cast ──────────────────────────────────────────────────────────────
  //
  // spec: { school: [catch], bait, monster? }
  // Resolves { landed, catch, missed } once the attempt is decided either way.
  function start(spec) {
    return new Promise(resolve => {
      const P = G().POND;
      const MARGIN = spec.monster ? { x: 0.10, y: 0.16 } : { x: 0.04, y: 0.06 };
      el('castArea').classList.add('hidden');
      el('reel').classList.remove('hidden');

      const pond = el('pond');
      pond.innerHTML = '';
      const box = pond.getBoundingClientRect();
      const aspect = box.width > 0 ? box.width / Math.max(1, box.height) : 1.6;

      // ── Stock the water ─────────────────────────────────────────────────
      const swimmers = (spec.monster ? [spec.monster] : spec.school).map(c => {
        const node = document.createElement('div');
        node.className = 'swimmer' + (spec.monster ? ' monster' : '');
        node.innerHTML = spec.monster
          ? `<img src="assets/MonsterIcons/${c.icon}" alt="${c.name}">`
          : window.MF_GUIDE.fishImg(c.ore, 30, c.name);
        pond.appendChild(node);
        const a = Math.random() * Math.PI * 2;
        return {
          c, node,
          x: MARGIN.x + Math.random() * (1 - MARGIN.x * 2),
          y: MARGIN.y + Math.random() * (1 - MARGIN.y * 2),
          vx: Math.cos(a), vy: Math.sin(a),
          turnIn: Math.random() * P.turnEvery,
          nibbleIn: 0,
        };
      });

      const bobber = document.createElement('div');
      bobber.className = 'bobber';
      pond.appendChild(bobber);

      const S = {
        phase: 'swim',
        bx: 0.5, by: 0.5,          // where the bobber IS, in pond fractions
        tx: 0.5, ty: 0.5,          // where you have sent it; it slides to meet this
        stepReady: 0,
        swimmers,
        bobber,
        hooked: null,
        strikeLeft: 0,
        progress: 0,
        tension: 0,
        fight: null,
        baited: spec.bait && spec.bait.id !== 'no_bait',
        monster: !!spec.monster,
        resolve,
        settled: false,
        last: performance.now(),
      };
      state = S;

      const done = out => { S.settled = true; cleanup(); resolve(out); };
      S.done = done;

      // ── Input ───────────────────────────────────────────────────────────
      // e.repeat is ignored on purpose: holding the key must not reel for you,
      // the press has to be a press.
      const NUDGE = {
        ArrowLeft: [-1, 0], KeyA: [-1, 0],
        ArrowRight: [1, 0], KeyD: [1, 0],
        ArrowUp: [0, -1], KeyW: [0, -1],
        ArrowDown: [0, 1], KeyS: [0, 1],
      };
      window.onkeydown = e => {
        if (!state) return;
        if (e.code === 'Space') {
          e.preventDefault();
          if (e.repeat) return;
          if (S.phase === 'hooked') strike();
          else if (S.phase === 'reel') pull();
          else if (S.phase === 'swim') reelIn();
          return;
        }
        const dir = NUDGE[e.code];
        if (dir) { e.preventDefault(); nudge(dir[0], dir[1]); }
      };

      // A nudge sets a destination rather than moving the bobber. The slide to it
      // happens in the frame loop, and settles just before the next nudge is
      // allowed — so the step-and-pause rhythm is unchanged, it just reads as a
      // cast bobber drifting across the water instead of teleporting.
      function nudge(dx, dy) {
        if (S.phase !== 'swim') return;
        const now = performance.now();
        if (now < S.stepReady) return;
        S.stepReady = now + P.stepCooldownMs;
        S.tx = Math.max(0.04, Math.min(0.96, S.tx + dx * P.bobberStep));
        S.ty = Math.max(0.06, Math.min(0.94, S.ty + dy * P.bobberStep));
        bobber.classList.add('nudged');
        setTimeout(() => bobber.classList.remove('nudged'), 120);
      }

      // Nothing on the hook yet, so the line can simply come back. Hammering it
      // in costs the cast but keeps the bait, which is what makes it usable for
      // seeing whether a bait is drawing anything before you commit to waiting.
      function reelIn() {
        S.pullIn = (S.pullIn || 0) + 1;
        const need = P.reelInPresses;
        if (S.pullIn < need) {
          el('reelHint').textContent =
            `Reeling in… ${'●'.repeat(S.pullIn)}${'○'.repeat(need - S.pullIn)}`;
          return;
        }
        done({ landed: false, reason: 'reeled-in', catch: null });
      }

      function strike() {
        S.phase = 'reel';
        S.fight = S.hooked.fight;
        S.tension = G().REEL_START;
        S.escape = 0;
        // The good stretch is drawn once — it does not move during the fight, so
        // the player has a fixed target to steer the pill into.
        const lo = 0.5 - S.fight.band;
        el('tensionBand').style.left = lo * 100 + '%';
        el('tensionBand').style.width = S.fight.band * 200 + '%';
        el('tensionWrap').classList.remove('hidden', 'strike');
        el('reelName').textContent = S.hooked.c.name;
        el('reelHint').textContent = 'Tap Space to keep the line in the middle.';
      }

      // A press only lifts the line. Ground is gained by where the line SITS, not
      // by pressing, so mashing past the top is a way to lose rather than to win.
      function pull() {
        S.tension += S.fight.liftPerPress;
        bobber.classList.add('pulling');
        setTimeout(() => bobber.classList.remove('pulling'), 90);
      }

      // ── Hooking ─────────────────────────────────────────────────────────
      function hook(sw) {
        S.phase = 'hooked';
        S.hooked = { c: sw.c,
          fight: sw.c.fight || G().fightFor(sw.c.fish, sw.c.ore, S.lineLevel || 0, S.questHR || 1) };
        if (S.monster) S.hooked.fight = spec.monster.fight;
        S.strikeLeft = S.hooked.fight.strikeWindowMs / 1000;
        bobber.classList.add('under');
        // Same track, different job: while hooked it is the closing window, and
        // it empties rather than fills so "running out" reads at a glance.
        el('tensionWrap').classList.remove('hidden');
        el('tensionWrap').classList.add('strike');
        // Everything else scatters — one fish has it.
        for (const o of S.swimmers) if (o !== sw) o.node.classList.add('gone');
        sw.node.classList.add('biting');
        el('reelName').textContent = '';
        el('reelHint').textContent = 'It went under — Space!';
      }

      // ── Frame ───────────────────────────────────────────────────────────
      function frame(now) {
        if (!state) return;
        const dt = Math.min(0.05, (now - S.last) / 1000);
        S.last = now;

        // Ease toward where it was sent. Framed on elapsed time rather than on a
        // per-frame fraction so the glide looks the same on a slow machine as on
        // a fast one. Fish chase where the bobber IS, not where it is headed,
        // because that is what a fish can see.
        const glide = 1 - Math.exp(-dt * P.glideRate);
        S.bx += (S.tx - S.bx) * glide;
        S.by += (S.ty - S.by) * glide;

        bobber.style.left = S.bx * 100 + '%';
        bobber.style.top = S.by * 100 + '%';

        if (S.phase === 'swim') {
          for (const sw of S.swimmers) {
            // Two measures of the same gap. Steering uses the pond's own
            // coordinates, because that is the space the fish actually moves in;
            // "how close is it" folds the aspect back in, so the nibble radius is
            // a circle on screen and not a squashed ellipse. Mixing the two is
            // what had fish orbiting the bobber just out of reach.
            const rx = S.bx - sw.x, ry = S.by - sw.y;
            const raw = Math.hypot(rx, ry);
            const dist = Math.hypot(rx * aspect, ry);
            // Only the fish the bait actually drew come to the bobber. The rest
            // are here because they live here, and they behave like it.
            const drawn = S.monster || (S.baited && sw.c.matches && dist < P.attractRange);

            // A fish that has been drawn in is not looking around any more.
            sw.turnIn -= dt;
            if (sw.turnIn <= 0 && !drawn) {
              const a = Math.random() * Math.PI * 2;
              sw.vx = Math.cos(a); sw.vy = Math.sin(a);
              sw.turnIn = P.turnEvery * (0.6 + Math.random() * 0.8);
            }

            let speed = P.fishSpeed;
            if (drawn && raw > 0.001) {
              sw.vx += (rx / raw) * 2.2 * dt;
              sw.vy += (ry / raw) * 2.2 * dt;
              const m = Math.hypot(sw.vx, sw.vy) || 1;
              sw.vx /= m; sw.vy /= m;
              speed += P.attract;
              // Ease off on arrival so it settles on the bobber rather than
              // shooting past it and having to come round again.
              if (dist < P.nibbleRange * 2) speed *= 0.35;
            }
            if (S.monster) speed *= 1.6;

            sw.x += sw.vx * speed * dt;
            sw.y += sw.vy * speed * dt;
            if (sw.x < MARGIN.x || sw.x > 1 - MARGIN.x) {
              sw.vx *= -1; sw.x = Math.max(MARGIN.x, Math.min(1 - MARGIN.x, sw.x));
            }
            if (sw.y < MARGIN.y || sw.y > 1 - MARGIN.y) {
              sw.vy *= -1; sw.y = Math.max(MARGIN.y, Math.min(1 - MARGIN.y, sw.y));
            }

            sw.node.style.left = sw.x * 100 + '%';
            sw.node.style.top = sw.y * 100 + '%';
            sw.node.classList.toggle('flip', sw.vx < 0);

            // Close enough to have a go at it.
            sw.nibbleIn -= dt;
            if (dist <= P.nibbleRange && sw.nibbleIn <= 0) {
              sw.nibbleIn = P.nibbleEveryMs / 1000;
              sw.node.classList.add('nibble');
              setTimeout(() => sw.node?.classList.remove('nibble'), 220);
              const chance = P.hookChance + (S.lureLevel || 0) * 0.02;
              if (Math.random() < (S.monster ? 1 : chance)) { hook(sw); break; }
            }
          }
        } else if (S.phase === 'hooked') {
          S.strikeLeft -= dt;
          const w = S.hooked.fight.strikeWindowMs / 1000;
          el('strikeFill').style.width = Math.max(0, S.strikeLeft / w) * 100 + '%';
          if (S.strikeLeft <= 0) return done({ landed: false, reason: 'missed', missed: true, catch: S.hooked.c });
        } else if (S.phase === 'reel') {
          S.tension -= S.fight.sinkPerSec * dt;
          const t = S.tension;
          if (t <= 0) return done({ landed: false, reason: 'slack', catch: S.hooked.c });
          if (t >= 1) return done({ landed: false, reason: 'snap', catch: S.hooked.c });

          const held = t >= 0.5 - S.fight.band && t <= 0.5 + S.fight.band;
          if (held) S.progress += S.fight.progressPerSec * dt;
          else S.escape += (S.fight.escapePerSec || 0) * dt;

          el('tensionPill').style.left = t * 100 + '%';
          el('tensionTrack').classList.toggle('out', !held);
          el('tensionTrack').classList.toggle('low', !held && t < 0.5);
          el('reelProgress').style.width = Math.min(1, S.progress) * 100 + '%';
          el('reelEscape').style.width = Math.min(1, S.escape) * 100 + '%';
          // Whoever fills first takes it.
          if (S.escape >= 1) return done({ landed: false, reason: 'escaped', catch: S.hooked.c });
          if (S.progress >= 1) return done({ landed: true, catch: S.hooked.c });
        }

        raf = requestAnimationFrame(frame);
      }

      // Upgrades read once per cast.
      S.lineLevel = spec.lineLevel || 0;
      S.lureLevel = spec.lureLevel || 0;
      S.questHR = spec.questHR || 1;

      el('tensionWrap').classList.add('hidden');
      el('reelProgress').style.width = '0%';
      el('reelEscape').style.width = '0%';
      el('strikeFill').style.width = '100%';
      el('tensionPill').style.left = G().REEL_START * 100 + '%';
      el('reelName').textContent = '';
      el('reelHint').textContent = S.monster
        ? 'Something big is circling.'
        : 'Arrows or WASD to move the bobber. Hammer Space to reel back in.';
      raf = requestAnimationFrame(frame);
    });
  }

  window.MF_FISHING = { start, cancel: cleanup };
})();
