// savefile.js — New, Save, Save As and Open, matching the other MHGU apps.
//
// Two copies of the same save, doing different jobs:
//
//   localStorage  — always current. Written on every action, so closing the tab
//                   or crashing mid-trip never costs anything.
//   a file        — only current when you save it. This is the copy you keep,
//                   move between machines, or hold several of.
//
// Because the browser copy is the automatic one, the unsaved-changes dot tracks
// the FILE. It means "the file on disk is behind what you have been doing", not
// "your progress is at risk".

(function () {
  const A = window.MF_APP;
  const el = id => document.getElementById(id);

  const SAVE_APP = 'mhgu-fishing';
  const SAVE_VERSION = 1;
  const FILE_NAME = 'mhgu-fishing.json';
  const TITLE = 'MHGU Fishing';

  let fileHandle = null;   // the file Save writes back to, once one is chosen
  let dirty = false;

  // ── The envelope ──────────────────────────────────────────────────────────
  const serializeSave = () => ({
    app: SAVE_APP,
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    state: A.snapshot(),
  });

  // Say what is wrong in the player's terms. Opening the wrong file is the
  // common mistake, and "not valid JSON" does not help anyone find that out.
  function validateSave(obj) {
    if (!obj || typeof obj !== 'object') return 'Not a valid file.';
    if (obj.app !== SAVE_APP) return "This file isn't an MHGU Fishing save.";
    if (!Number.isInteger(obj.version) || obj.version > SAVE_VERSION)
      return 'This save was made with a newer version of the app.';
    if (!obj.state || typeof obj.state !== 'object') return 'Save file has no progress in it.';
    return null;
  }

  // ── Dirty mark ────────────────────────────────────────────────────────────
  function touch() {
    if (dirty) return;
    dirty = true;
    el('dirtyDot').classList.remove('hidden');
    document.title = '● ' + TITLE;
  }
  function clearDirty() {
    dirty = false;
    el('dirtyDot').classList.add('hidden');
    document.title = TITLE;
  }

  function toast(msg, ms = 2600) {
    const t = el('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), ms);
  }

  // ── Writing ───────────────────────────────────────────────────────────────
  //
  // Where it is available, the File System Access API lets Save write straight
  // back over the file you opened. Where it is not — Firefox, Safari, and any
  // page not on a secure origin — every save is a download instead, which is
  // why Save and Save As behave the same there.
  const supportsFsApi = 'showSaveFilePicker' in window;
  const saveOpts = {
    suggestedName: FILE_NAME,
    types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
  };

  async function saveToFile(forceNew) {
    const data = JSON.stringify(serializeSave(), null, 2);
    if (supportsFsApi) {
      try {
        if (forceNew || !fileHandle) fileHandle = await window.showSaveFilePicker(saveOpts);
        const w = await fileHandle.createWritable();
        await w.write(data);
        await w.close();
        clearDirty();
        toast('Saved.');
        return;
      } catch (e) {
        // Backing out of the picker is not a failure — leave everything alone.
        if (e && e.name === 'AbortError') return;
        // Anything else (a revoked handle, a read-only location) still deserves
        // to end with the player holding their save, so fall through.
      }
    }
    downloadBlob(data, FILE_NAME);
    clearDirty();
    toast('Downloaded save file.');
  }

  function downloadBlob(data, name) {
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── Reading ───────────────────────────────────────────────────────────────
  function loadFromText(text) {
    let obj;
    try { obj = JSON.parse(text); }
    catch (e) { toast('That file is not readable.'); return; }
    const bad = validateSave(obj);
    if (bad) { toast(bad); return; }

    A.loadFrom(obj.state);
    window.MF_UI.show('camp');
    window.MF_UI.refresh();
    clearDirty();              // what is in front of you IS the file now
    toast('Save loaded.');
  }

  async function openFile() {
    if (!confirmDiscard('Open a different save?')) return;
    if (supportsFsApi) {
      try {
        const [h] = await window.showOpenFilePicker({ types: saveOpts.types });
        fileHandle = h;
        loadFromText(await (await h.getFile()).text());
        return;
      } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    el('importFile').click();
  }

  // ── New ───────────────────────────────────────────────────────────────────
  //
  // Wipes the browser copy and starts over. The file is deliberately NOT
  // touched — an old save on disk stays exactly as it was until you overwrite
  // it, so New cannot destroy a file you meant to keep. Save As is what puts a
  // fresh run somewhere new.
  function newSave() {
    if (window.MF_QUEST.active) {
      toast('Finish or retire the quest first.');
      return;
    }
    if (!confirm('Start a new save?\n\n' +
      'Everything in this browser — your guide, zenny, rank and upgrades — is cleared.\n' +
      'Any save file you already have on disk is left alone.')) return;
    A.reset();
    fileHandle = null;         // Save now asks where to put it
    window.MF_UI.show('camp');
    window.MF_UI.refresh();
    clearDirty();
    toast('New save started.');
  }

  // Opening over unsaved work is the one way to lose something here, since the
  // browser copy is about to be replaced too.
  function confirmDiscard(what) {
    if (!dirty) return true;
    return confirm(what + '\n\nYou have progress that is not in a save file yet. ' +
      'It will be replaced by whatever you open.');
  }

  // ── Wiring ────────────────────────────────────────────────────────────────
  el('newBtn').onclick = () => newSave();
  el('saveBtn').onclick = () => saveToFile(false);
  el('saveAsBtn').onclick = () => saveToFile(true);
  el('openBtn').onclick = () => openFile();

  el('importFile').onchange = function () {
    const f = this.files && this.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => loadFromText(String(r.result));
    r.readAsText(f);
    this.value = '';           // so picking the same file twice still fires
  };

  // Ctrl/Cmd+S is what everyone's hands do. Take it before the browser's own.
  window.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
    e.preventDefault();
    saveToFile(e.shiftKey);    // Shift makes it Save As
  });

  // Nothing is at risk on close — the browser copy is already written — so this
  // only speaks up when a save FILE would be left behind.
  window.addEventListener('beforeunload', e => {
    if (!dirty || !fileHandle) return;
    e.preventDefault();
    e.returnValue = '';
  });

  window.MF_FILE = { touch, clearDirty, serializeSave, toast, get dirty() { return dirty; } };
})();
