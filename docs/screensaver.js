// screensaver.js — the water, and nothing else.
//
// The pond spent the whole game being a thing you fish. This is the same water
// with the fishing taken out: pick a locale, pick how many fish, and it fills
// the window so it can be left running.
//
// It BORROWS the quest's pool rather than growing its own. There is one pool
// loop in fishing.js and it now takes a host, so the only thing that changes
// out here is which box the fish are told they live in. The cost of borrowing
// is that a trip on the water loses its pond while the saver is up, so closing
// hands it back — see close().
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const A = () => window.MF_APP;
  const G = () => window.MF_GAME;
  const R = () => window.MF_ROLL;

  const KEY = 'mhgu-fishing-saver';
  // Its own key, deliberately. These are how you like to WATCH the water, not
  // anything about a save, so they follow the browser rather than the file and
  // survive New Game like the theme does.
  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  };
  const save = s => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };

  let prefs = { localeId: '', size: 18, ...load() };
  let running = false;

  // ── The settings ────────────────────────────────────────────────────────
  function fillLocales() {
    const sel = el('saverLocale');
    if (!sel || sel.options.length) return;
    const locales = (window.MF_LOCALES || []).filter(l => l.hasFishing);
    sel.innerHTML = locales
      .map(l => `<option value="${l.id}">${l.name}</option>`).join('');
    if (!prefs.localeId || !locales.some(l => l.id === prefs.localeId))
      prefs.localeId = locales[0] ? locales[0].id : '';
    sel.value = prefs.localeId;
  }

  function syncSize() {
    el('saverSizeOut').textContent = prefs.size;
    el('saverSize').value = prefs.size;
  }

  function open() {
    fillLocales();
    syncSize();
    el('saverModal').classList.remove('hidden');
  }
  const closeModal = () => el('saverModal').classList.add('hidden');

  // ── The water ───────────────────────────────────────────────────────────
  //
  // Fish are rolled through the same table the game rolls, at the rank you have
  // actually reached, so the saver shows the water you have earned rather than a
  // fixed sampler. No bait: a saver that favoured one fish would show one fish.
  function roll() {
    const S = A().state;
    return R().rollCatch({
      localeId: prefs.localeId,
      bait: A().baitBy.get('no_bait'),
      hr: S.hr,
      rod: S.gear.rod,
      armor: S.gear,
    });
  }

  function start() {
    closeModal();
    const stage = el('saverStage');
    const water = el('saverWater');
    water.innerHTML = '';
    stage.classList.remove('hidden');
    running = true;
    // The locale's own water colour, exactly as a trip sets it, so switching
    // locale is visible before a single fish arrives.
    water.style.setProperty('--water', G().waterOf(prefs.localeId));
    // The loop measures its host on open, so the stage has to be laid out first.
    // A layout READ forces that in this tick; a rAF was doing it before, and a
    // rAF that never fires — a hidden tab, a throttled pane — left the saver
    // showing an empty box with no way back to filling it.
    void water.offsetWidth;
    window.MF_FISHING.openPool({
      host: water, roll, max: prefs.size, seed: prefs.size,
      armor: A().state.gear, chrome: false,
    });
  }

  function close() {
    if (!running) return;
    running = false;
    window.MF_FISHING.stopPool(true);
    el('saverWater').innerHTML = '';
    el('saverStage').classList.add('hidden');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    // Give the water back. There is one pool and the saver took it; a trip left
    // running would otherwise come back to a dead pond.
    if (window.MF_QUEST && window.MF_QUEST.active) window.MF_QUEST.openPool();
  }

  function toggleFullscreen() {
    const stage = el('saverStage');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
  }

  // ── Wiring ──────────────────────────────────────────────────────────────
  function init() {
    if (!el('saverBtn')) return;
    el('saverBtn').onclick = open;
    el('saverClose').onclick = closeModal;
    el('saverModal').onclick = e => { if (e.target.id === 'saverModal') closeModal(); };

    el('saverSize').oninput = e => {
      prefs.size = Math.max(1, Math.min(60, +e.target.value || 1));
      el('saverSizeOut').textContent = prefs.size;
      save(prefs);
      // Resize while it is already running, so the slider is something you can
      // watch rather than a setting you commit to blind.
      if (running) window.MF_FISHING.resizePool(prefs.size);
    };
    el('saverLocale').onchange = e => {
      prefs.localeId = e.target.value;
      save(prefs);
      if (running) {
        el('saverWater').style.setProperty('--water', G().waterOf(prefs.localeId));
        window.MF_FISHING.refreshPool();
      }
    };
    el('saverStart').onclick = () => { save(prefs); start(); };
    el('saverExit').onclick = close;
    el('saverFull').onclick = toggleFullscreen;

    // Escape leaves. It is the one key everybody already tries on something
    // filling the screen, and the browser's own fullscreen swallows it first —
    // so the first press drops out of fullscreen and the second closes.
    window.addEventListener('keydown', e => {
      if (!running) return;
      if (e.key === 'Escape' && !document.fullscreenElement) close();
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    });
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else init();
})();
