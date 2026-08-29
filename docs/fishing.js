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

  // Asked the OS for less movement? Then the pond does not spawn a wake at all —
  // the CSS would strip its animation, leaving marks that never fade or leave.
  const STILL = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let raf = null;
  let state = null;

  // ── Teardown ──────────────────────────────────────────────────────────────
  //
  // Retiring is allowed with a fish on the line, so tearing down has to settle
  // the promise cast() is sitting on. Otherwise the trip ends but the await
  // never returns and the cast is left half-resolved.
  // `forget` is the difference between a CAST ending and a TRIP ending. done()
  // calls this after every cast, so forgetting here threw away every trap in the
  // water the first time you cast past one. Only quest.js's cancel() forgets.
  function cleanup(forget) {
    stopPool(forget);
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
    // The brace classes have to go too. A fight that ends DURING an attack
    // never reaches endBrace(), so without this the next cast opens wearing
    // the last one's 'It connects' styling.
    el('tensionWrap')?.classList.remove('strike', 'bracing', 'braced', 'hit');
    state = null;
    if (pending) { pending.settled = true; pending.resolve({ landed: false, cancelled: true }); }
  }

  // ── One cast ──────────────────────────────────────────────────────────────
  //
  // spec: { school: [catch], bait, monster? }
  // Resolves { landed, catch, missed } once the attempt is decided either way.
  function start(spec) {
    return new Promise(resolve => {
      // The pond as your armor leaves it. fishing.js never learns what a skill
      // is — it reads the same plain fields it always did.
      const P = G().pondFor(spec.armor || null);
      // The pool and a cast cannot both own the pond, and the cast empties it.
      stopPool();
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

      // A drift of bubbles, so the water has something of its own going on that
      // is not the fish. Each is given its own size, lane, pace and phase, which
      // is what stops fourteen identical circles reading as a pattern. They are
      // pure decoration — created here rather than in the markup because the
      // pond is emptied and rebuilt on every cast.
      const bubbles = document.createElement('div');
      bubbles.className = 'bubbles';
      for (let i = 0; i < 14; i++) {
        const b = document.createElement('i');
        const size = 3 + Math.random() * 7;
        b.style.cssText =
          `left:${Math.random() * 100}%;top:${Math.random() * 100}%;` +
          `width:${size}px;height:${size}px;` +
          `animation-duration:${7 + Math.random() * 9}s;` +
          `animation-delay:${-Math.random() * 12}s`;
        bubbles.appendChild(b);
      }
      pond.appendChild(bubbles);

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
        brace: null,               // the attack in progress, if one is
        braceIn: 0,                // seconds until it breaks off again
        hits: 0,                   // attacks that landed on you
        spaceSince: 0,             // when Space went down, 0 if it is up
        wakeIn: 0,                 // throttles the trail it leaves while gliding
        baited: spec.bait && spec.bait.id !== 'no_bait',
        monster: !!spec.monster,
        resolve,
        settled: false,
        last: performance.now(),
      };
      state = S;

      const done = out => {
        S.settled = true;
        const hits = S.hits;      // read before cleanup drops the state
        cleanup();
        resolve({ hits, ...out });
      };
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
          // Held, not pressed: remember WHEN it went down so a brace can ask how
          // long it has been there.
          if (!S.spaceSince) S.spaceSince = performance.now();
          // While bracing the key is doing a different job, so it must not also
          // pull — otherwise the brace hands you free ground.
          if (S.brace) return;
          if (S.phase === 'hooked') strike();
          else if (S.phase === 'reel') pull();
          else if (S.phase === 'swim') reelIn();
          return;
        }
        const dir = NUDGE[e.code];
        if (dir) { e.preventDefault(); nudge(dir[0], dir[1]); }
      };

      window.onkeyup = e => {
        if (e.code === 'Space') S.spaceSince = 0;
      };

      // ── The monster breaks off ──────────────────────────────────────────
      //
      // It lunges out of the middle, the hit lands at the far end of the lunge,
      // and it slides back. Everything else in the fight is frozen meanwhile —
      // see the `reel` branch, which returns early while a brace is running.
      function beginBrace() {
        const A = G().BOSS_ATTACK;
        const a = Math.random() * Math.PI * 2;
        S.brace = {
          t: 0,
          dx: Math.cos(a), dy: Math.sin(a),
          windup: A.windupMs / 1000,
          recover: A.recoverMs / 1000,
          struck: false,
        };
        el('tensionWrap').classList.add('bracing');
        el('reelHint').textContent = 'HOLD Space — brace!';
      }

      function endBrace() {
        const sw = S.swimmers[0];
        if (sw) sw.node.style.transform = '';
        S.brace = null;
        S.braceIn = G().BOSS_ATTACK.everyMs / 1000;
        el('tensionWrap').classList.remove('bracing', 'braced', 'hit');
        el('reelHint').textContent = 'Hammer Space. Keep it in the middle.';
      }

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
        S.braceIn = S.monster ? G().BOSS_ATTACK.firstMs / 1000 : Infinity;
        S.fight = S.hooked.fight;
        S.tension = G().REEL_START;
        S.escape = 0;
        // The good stretch is drawn once — it does not move during the fight, so
        // the player has a fixed target to steer the pill into.
        const lo = 0.5 - S.fight.band;
        el('tensionBand').style.left = lo * 100 + '%';
        el('tensionBand').style.width = S.fight.band * 200 + '%';
        el('tensionWrap').classList.remove('hidden', 'strike');
        // You do not get to know what is on the end of it. A fish stays unnamed
        // through the whole fight — the weight of the line is the only tell, and
        // finding out is what landing it is for. A monster is exempt: it is
        // already an unmissable icon in the water, so naming it costs no secret.
        el('reelName').textContent = S.monster ? S.hooked.c.name : '';
        el('reelHint').textContent = 'Tap Space to keep the line in the middle.';
      }

      // Is the line in the stretch that gains ground right now? Control reads
      // this and so does the frame, so it lives in one place.
      // S.fight rather than S.hooked.fight: both readers run in the reel phase,
      // where S.fight is the live one, and it is the same object the band test
      // further down already uses.
      const inBand = () => !!S.fight
        && S.tension >= 0.5 - S.fight.band
        && S.tension <= 0.5 + S.fight.band;

      // A press only lifts the line. Ground is gained by where the line SITS, not
      // by pressing, so mashing past the top is a way to lose rather than to win.
      //
      // Control lengthens the press only when you are OUT of the sweet spot,
      // where a bigger press is recovery. Inside it a bigger press would carry
      // you straight back out the top, so the help there is a slower sink instead
      // — see sinkInBand in the frame.
      function pull() {
        const f = S.fight;
        S.tension += (inBand() ? f.liftPerPress : (f.liftOutOfBand ?? f.liftPerPress));
        bobber.classList.add('pulling');
        setTimeout(() => bobber.classList.remove('pulling'), 90);
      }

      // ── Hooking ─────────────────────────────────────────────────────────
      function hook(sw) {
        S.phase = 'hooked';
        S.hooked = { c: sw.c,
          fight: sw.c.fight || G().fightFor(sw.c.fish, sw.c.ore, S.rod, S.questHR || 1, S.armor, S.ctx) };
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
        const wasX = S.bx, wasY = S.by;
        S.bx += (S.tx - S.bx) * glide;
        S.by += (S.ty - S.by) * glide;

        bobber.style.left = S.bx * 100 + '%';
        bobber.style.top = S.by * 100 + '%';

        // Moving or sitting still, measured on what it ACTUALLY covered this
        // frame rather than on how far it still has to go — the glide eases out,
        // so a bobber a whisker from its destination is already at rest.
        const moved = Math.hypot(S.bx - wasX, S.by - wasY);
        const travelling = moved > 0.0008;
        bobber.classList.toggle('travelling', travelling);

        // Drop a fading mark behind it while it travels. Throttled, because one
        // per frame is a solid smear rather than a wake.
        //
        // Removed on a timer rather than on animationend. animationend is not a
        // promise: it never fires if the animation is suppressed — which is
        // exactly what prefers-reduced-motion does to this rule — and every mark
        // would then sit in the pond forever. A timer always comes.
        S.wakeIn -= dt;
        if (travelling && !STILL && S.wakeIn <= 0) {
          S.wakeIn = 0.045;
          const w = document.createElement('div');
          w.className = 'wake';
          w.style.left = wasX * 100 + '%';
          w.style.top = wasY * 100 + '%';
          pond.appendChild(w);
          setTimeout(() => w.remove(), 700);
        }

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
              const chance = P.hookChance * (1 + (S.bites || 0));
              if (Math.random() < (S.monster ? 1 : chance)) { hook(sw); break; }
            }
          }
        } else if (S.phase === 'hooked') {
          S.strikeLeft -= dt;
          const w = S.hooked.fight.strikeWindowMs / 1000;
          el('strikeFill').style.width = Math.max(0, S.strikeLeft / w) * 100 + '%';
          if (S.strikeLeft <= 0) return done({ landed: false, reason: 'missed', missed: true, catch: S.hooked.c });
        } else if (S.phase === 'reel') {
          // The whole fight holds still while it comes at you. Nothing sinks,
          // nothing is gained, nothing is lost — the only question is the key.
          if (S.brace) {
            const A = G().BOSS_ATTACK;
            const b = S.brace;
            b.t += dt;
            const sw = S.swimmers[0];
            // Out over the windup, back over the recover.
            const out = b.t <= b.windup
              ? b.t / b.windup
              : Math.max(0, 1 - (b.t - b.windup) / b.recover);
            if (sw) {
              const REACH = 34;   // px at full lunge
              sw.node.style.transform =
                `translate(${b.dx * out * REACH}px, ${b.dy * out * REACH}px)`;
            }
            if (!b.struck && b.t >= b.windup) {
              b.struck = true;
              const heldFor = S.spaceSince ? performance.now() - S.spaceSince : 0;
              // Brace buys leeway: holdMs is how long Space must ALREADY have
              // been down when the blow lands, so lower is kinder.
              if (heldFor >= G().braceHoldMs(spec.armor || null)) {
                el('tensionWrap').classList.add('braced');
                el('reelHint').textContent = 'Braced.';
              } else {
                S.hits++;
                S.escape = Math.min(1, (S.escape || 0) + A.escapeOnHit);
                el('reelEscape').style.width = Math.min(1, S.escape) * 100 + '%';
                el('tensionWrap').classList.add('hit');
                el('reelHint').textContent = 'It connects.';
                // Told here rather than at the end of the cast, so the HP bar
                // drops on the blow that caused it. The caller answers whether
                // that blow put you down.
                if (S.onHit && S.onHit()) {
                  el('reelHint').textContent = 'It puts you down.';
                  return done({ landed: false, reason: 'downed', catch: S.hooked.c, hits: S.hits });
                }
                if (S.escape >= 1)
                  return done({ landed: false, reason: 'escaped', catch: S.hooked.c, hits: S.hits });
              }
            }
            if (b.t >= b.windup + b.recover) endBrace();
            raf = requestAnimationFrame(frame);
            return;
          }

          S.braceIn -= dt;
          if (S.braceIn <= 0) beginBrace();

          // Held: Control slows the fall so what you have is easier to keep.
          // Out: it falls at the honest rate and the press is what is bigger.
          const f = S.fight;
          S.tension -= (inBand() ? (f.sinkInBand ?? f.sinkPerSec) : f.sinkPerSec) * dt;
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
      S.onHit = spec.onHit || null;
      S.rod = spec.rod || null;
      S.armor = spec.armor || null;
      S.bites = spec.bites || 0;
      S.ctx = spec.ctx || null;
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

  // ── The pool between casts ────────────────────────────────────────────────
  //
  // The water is a place now rather than a sentence and a button. Fish drift in,
  // hang about for a while and drift off again whether or not you have a line in,
  // so a bomb is aimed at what is really there.
  //
  // It runs in its OWN loop, separate from a cast's. Entangling them would mean
  // the cast loop had to know about spawning and the pool had to know about
  // hooking, and the cast loop is the one thing here that has to stay simple
  // enough to reason about.
  //
  // Large monsters are never in it, deliberately: they belong to the cast, and a
  // monster you could see coming is a monster you could simply not cast at.
  let poolRaf = null;
  let pool = null;
  // Traps set before a cast are still set after it. stopPool tears the pool down
  // for the cast to own the pond; this is what survives that.
  let keptTraps = [];

  function stopPool(forget) {
    if (poolRaf) cancelAnimationFrame(poolRaf);
    poolRaf = null;
    // A cast PAUSES the pool; the end of a trip ends it. Only the second forgets
    // what was set in the water.
    //
    // The `else if (pool)` matters: a cast calls this TWICE — once from start() to
    // take the pond, and again from cleanup() when it finishes. On the second call
    // pool is already null, and the earlier version read that as "nothing to keep"
    // and emptied the list a moment after filling it.
    if (forget) keptTraps = [];
    else if (pool) keptTraps = pool.traps;
    pool = null;
  }

  const pondAspect = () => {
    const p = el('pond');
    const b = p ? p.getBoundingClientRect() : { width: 0, height: 0 };
    return b.width > 0 ? b.width / Math.max(1, b.height) : 1.6;
  };

  // Decoration, lifted out of start() so the pool and a cast can both have it.
  function makeBubbles() {
    const bubbles = document.createElement('div');
    bubbles.className = 'bubbles';
    for (let i = 0; i < 14; i++) {
      const b = document.createElement('i');
      const size = 3 + Math.random() * 7;
      b.style.cssText =
        'left:' + (Math.random() * 100) + '%;top:' + (Math.random() * 100) + '%;' +
        'width:' + size + 'px;height:' + size + 'px;' +
        'animation-duration:' + (7 + Math.random() * 9) + 's;' +
        'animation-delay:' + (-Math.random() * 12) + 's';
      bubbles.appendChild(b);
    }
    return bubbles;
  }

  // spec: { roll() -> catch|null, armor }
  // `roll` is handed in so the pond never learns what decides a catch — the same
  // reason it is handed a school today rather than a locale.
  function openPool(spec) {
    stopPool();
    const pondEl = el('pond');
    if (!pondEl) return;
    pondEl.innerHTML = '';
    pondEl.appendChild(makeBubbles());
    el('castArea') && el('castArea').classList.remove('hidden');
    el('reel') && el('reel').classList.add('hidden');

    pool = {
      fish: [], traps: keptTraps, roll: spec.roll, armor: spec.armor || null,
      last: performance.now(), spawnIn: 0, bomb: null,
      aspect: pondAspect(),
    };
    // A trap outlives a cast. The pond is emptied and rebuilt around it, so the
    // markers are put back rather than left as detached nodes nothing can see.
    for (const t of pool.traps) { t.node.remove(); el('pond').appendChild(t.node); }
    keptTraps = [];
    // Open with a few already in the water rather than an empty pond that fills
    // itself over the first ten seconds.
    for (let i = 0; i < 3; i++) spawnOne(true);
    poolRaf = requestAnimationFrame(poolFrame);
  }

  function spawnOne(quiet) {
    if (!pool || pool.fish.length >= G().POOL.max) return;
    const c = pool.roll ? pool.roll() : null;
    if (!c) return;
    const node = document.createElement('div');
    node.className = 'swimmer pooled' + (quiet ? '' : ' arriving');
    node.innerHTML = window.MF_GUIDE.fishImg(c.ore, 30, c.name);
    el('pond').appendChild(node);
    if (!quiet) setTimeout(function () { node.classList.remove('arriving'); }, 20);
    const a = Math.random() * Math.PI * 2;
    const life = G().POOL.lifeSec;
    pool.fish.push({
      c: c, node: node,
      x: 0.06 + Math.random() * 0.88,
      y: 0.08 + Math.random() * 0.84,
      vx: Math.cos(a), vy: Math.sin(a),
      turnIn: Math.random() * G().POND.turnEvery,
      life: life[0] + Math.random() * (life[1] - life[0]),
    });
  }

  function poolFrame(now) {
    if (!pool) return;
    const dt = Math.min(0.05, (now - pool.last) / 1000);
    pool.last = now;
    const P = G().POND, POOL = G().POOL;

    pool.spawnIn -= dt;
    if (pool.spawnIn <= 0) { spawnOne(false); pool.spawnIn = POOL.spawnEverySec; }
    trapFrame(dt);

    for (let i = pool.fish.length - 1; i >= 0; i--) {
      const f = pool.fish[i];
      f.life -= dt;
      if (f.life <= 0) {
        f.node.classList.add('leaving');
        const node = f.node;
        setTimeout(function () { node.remove(); }, POOL.fadeMs);
        pool.fish.splice(i, 1);
        continue;
      }
      f.turnIn -= dt;
      if (f.turnIn <= 0) {
        const a = Math.random() * Math.PI * 2;
        f.vx = Math.cos(a); f.vy = Math.sin(a);
        f.turnIn = P.turnEvery * (0.6 + Math.random() * 0.8);
      }
      f.x += f.vx * P.fishSpeed * dt;
      f.y += f.vy * P.fishSpeed * dt;
      // Turn at the edges rather than stopping dead against them.
      if (f.x < 0.04 || f.x > 0.96) { f.vx *= -1; f.x = Math.max(0.04, Math.min(0.96, f.x)); }
      if (f.y < 0.06 || f.y > 0.94) { f.vy *= -1; f.y = Math.max(0.06, Math.min(0.94, f.y)); }
      f.node.style.left = (f.x * 100) + '%';
      f.node.style.top = (f.y * 100) + '%';
      f.node.classList.toggle('flip', f.vx < 0);
    }
    poolRaf = requestAnimationFrame(poolFrame);
  }

  // ── Throwing a bomb ───────────────────────────────────────────────────────
  //
  // Aimed the way the bobber is moved, then dropped. Resolves with the fish that
  // were inside the blast; the pool loses them, because they were caught.
  //
  // Distance is corrected for the pond's aspect, exactly as nibbling is, so the
  // circle you are shown is the circle that catches.
  function throwBomb(spec) {
    return new Promise(function (resolve) {
      if (!pool) { resolve({ caught: [], cancelled: true }); return; }
      const radius = spec.radius;
      const aspect = pool.aspect;
      const marker = document.createElement('div');
      marker.className = 'bomb-marker';
      marker.innerHTML = '<span class="ring"></span>'
        + '<img src="assets/ItemIcons/' + spec.icon + '" alt="">';
      // In PIXELS, not percentages: the ring's percentage resolved against the
      // marker's own box — a 28px icon — so a blast covering a fifth of the pond
      // was drawn twelve pixels wide.
      //
      // The catch test corrects x by the aspect and compares against `radius`,
      // which makes the blast a circle of `radius x pond HEIGHT` pixels. Working
      // that back out is what makes the ring you are shown the ring that catches.
      const box = el('pond').getBoundingClientRect();
      const diameter = 2 * radius * box.height;
      marker.style.setProperty('--d', diameter + 'px');
      el('pond').appendChild(marker);

      const B = { x: 0.5, y: 0.5 };
      const place = function () {
        marker.style.left = (B.x * 100) + '%';
        marker.style.top = (B.y * 100) + '%';
      };
      place();
      const prompt = el('castPrompt');
      const wasPrompt = prompt ? prompt.textContent : '';
      if (prompt) prompt.textContent = 'Arrows or WASD to aim. Space to drop it.';

      const step = 0.06;
      const prevDown = window.onkeydown, prevUp = window.onkeyup;
      // Restoring the old prompt is right when you back OUT — you should be left
      // reading whatever you were reading. It is wrong once the bomb has gone off:
      // quest.js appends the result with flushNotes, so putting the previous
      // blast's line back first chained every message onto the last.
      const finish = function (caught, restore) {
        window.onkeydown = prevDown; window.onkeyup = prevUp;
        if (pool) pool.bomb = null;
        if (prompt) prompt.textContent = restore ? wasPrompt : '';
        resolve({ caught: caught });
      };

      window.onkeyup = null;
      window.onkeydown = function (e) {
        const k = (e.key || '').toLowerCase();
        if (k === 'arrowleft' || k === 'a') { B.x = Math.max(0.05, B.x - step); place(); e.preventDefault(); }
        else if (k === 'arrowright' || k === 'd') { B.x = Math.min(0.95, B.x + step); place(); e.preventDefault(); }
        else if (k === 'arrowup' || k === 'w') { B.y = Math.max(0.07, B.y - step); place(); e.preventDefault(); }
        else if (k === 'arrowdown' || k === 's') { B.y = Math.min(0.93, B.y + step); place(); e.preventDefault(); }
        else if (k === 'escape') { marker.remove(); finish([], true); }
        else if (k === ' ' || k === 'spacebar') { e.preventDefault(); window.onkeydown = null; drop(); }
      };
      if (pool) pool.bomb = B;

      function drop() {
        marker.classList.add('dropping');
        if (prompt) prompt.textContent = '';
        // It sinks, holds, then goes up. The catch is taken on the frame the
        // blast is widest rather than the frame it was dropped.
        setTimeout(function () {
          marker.classList.add('blast');
          const caught = [];
          if (pool) {
            for (let i = pool.fish.length - 1; i >= 0; i--) {
              const f = pool.fish[i];
              const dx = (f.x - B.x) * aspect;
              const dy = f.y - B.y;
              if (Math.sqrt(dx * dx + dy * dy) <= radius) {
                caught.push(f.c);
                f.node.classList.add('blasted');
                const node = f.node;
                setTimeout(function () { node.remove(); }, 400);
                pool.fish.splice(i, 1);
              }
            }
          }
          setTimeout(function () { marker.remove(); finish(caught); }, 430);
        }, 520);
      }
    });
  }

  // ── Setting a trap ────────────────────────────────────────────────────────
  //
  // Aimed the way a bomb is, but it STAYS. A bomb is one loud moment; a trap is
  // the opposite — you put it somewhere and go back to fishing, and it takes what
  // wanders in while you are busy.
  //
  // It reports catches through a callback rather than a promise, because the
  // whole point is that it goes on paying out after the placing is over.
  //
  // spec: { icon, radius, chance, hold, onCatch(catchObj), onFull() }
  function setTrap(spec) {
    return new Promise(function (resolve) {
      if (!pool) { resolve({ placed: false }); return; }
      const marker = document.createElement('div');
      marker.className = 'trap-marker placing';
      marker.innerHTML = '<span class="ring"></span>'
        + '<img src="assets/ItemIcons/' + spec.icon + '" alt="">';
      const box = el('pond').getBoundingClientRect();
      marker.style.setProperty('--d', (2 * spec.radius * box.height) + 'px');
      el('pond').appendChild(marker);

      const T = { x: 0.5, y: 0.5 };
      const place = function () {
        marker.style.left = (T.x * 100) + '%';
        marker.style.top = (T.y * 100) + '%';
      };
      place();
      const prompt = el('castPrompt');
      const wasPrompt = prompt ? prompt.textContent : '';
      if (prompt) prompt.textContent = 'Arrows or WASD to place it. Space to set it.';

      const step = 0.06;
      const prevDown = window.onkeydown, prevUp = window.onkeyup;
      const done = function (placed, restore) {
        window.onkeydown = prevDown; window.onkeyup = prevUp;
        if (prompt) prompt.textContent = restore ? wasPrompt : '';
        resolve({ placed: placed });
      };

      window.onkeyup = null;
      window.onkeydown = function (e) {
        const k = (e.key || '').toLowerCase();
        if (k === 'arrowleft' || k === 'a') { T.x = Math.max(0.05, T.x - step); place(); e.preventDefault(); }
        else if (k === 'arrowright' || k === 'd') { T.x = Math.min(0.95, T.x + step); place(); e.preventDefault(); }
        else if (k === 'arrowup' || k === 'w') { T.y = Math.max(0.07, T.y - step); place(); e.preventDefault(); }
        else if (k === 'arrowdown' || k === 's') { T.y = Math.min(0.93, T.y + step); place(); e.preventDefault(); }
        else if (k === 'escape') { marker.remove(); done(false, true); }
        else if (k === ' ' || k === 'spacebar') {
          e.preventDefault();
          window.onkeydown = null;
          marker.classList.remove('placing');
          marker.classList.add('set');
          pool.traps.push({
            x: T.x, y: T.y, node: marker,
            radius: spec.radius, chance: spec.chance,
            hold: spec.hold, taken: 0,
            cooldown: 0,
            onCatch: spec.onCatch, onFull: spec.onFull,
          });
          done(true, false);
        }
      };
    });
  }

  // Traps only check every so often. Rolling every frame would make the chance
  // meaningless — sixty rolls a second turns any number into a certainty — so a
  // trap gets ONE roll a second against each fish sitting in it.
  const TRAP_CHECK_SEC = 1;

  function trapFrame(dt) {
    if (!pool || !pool.traps.length) return;
    for (let ti = pool.traps.length - 1; ti >= 0; ti--) {
      const t = pool.traps[ti];
      if (t.done) continue;
      t.cooldown -= dt;
      if (t.cooldown > 0) continue;
      t.cooldown = TRAP_CHECK_SEC;
      for (let i = pool.fish.length - 1; i >= 0; i--) {
        if (t.taken >= t.hold) break;
        const f = pool.fish[i];
        const dx = (f.x - t.x) * pool.aspect;
        const dy = f.y - t.y;
        if (Math.sqrt(dx * dx + dy * dy) > t.radius) continue;
        if (Math.random() >= t.chance) continue;
        t.taken++;
        t.node.classList.add('catching');
        setTimeout(function () { t.node.classList.remove('catching'); }, 300);
        f.node.classList.add('trapped');
        const node = f.node;
        setTimeout(function () { node.remove(); }, 400);
        pool.fish.splice(i, 1);
        if (t.onCatch) t.onCatch(f.c);
      }
      if (t.taken >= t.hold) {
        t.node.classList.add('full');
        t.done = true;
        if (t.onFull) t.onFull();
        // Kept in the list rather than spliced out. The list is what survives a
        // cast and gets its markers put back, so dropping it here meant a full
        // trap vanished the next time you cast — and seeing where one filled up
        // is worth as much as seeing where one is still working.
      }
    }
  }

  // cancel() is the TRIP ending — retiring, carting, setting out again — so it
  // is the one that forgets what was set in the water.
  window.MF_FISHING = { start: start, cancel: () => cleanup(true), openPool: openPool,
                        stopPool: stopPool, throwBomb: throwBomb, setTrap: setTrap };

})();
