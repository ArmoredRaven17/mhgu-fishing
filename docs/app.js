// app.js — state, persistence, and the things every other module reads.

(function () {
  const G = window.MF_GAME;
  const R = window.MF_ROLL;

  const SAVE_KEY = 'mhgu-fishing';

  const BAITS = G.buildBaits();
  const baitBy = new Map(BAITS.map(b => [b.id, b]));
  const prepBy = new Map(window.MF_FISH.prep.map(p => [p.id, p]));

  const defaults = () => ({
    hr: 1,                   // the ladder itself: each HR opens its own locales
    rank: 'Low',             // derived from hr, kept for display
    visited: {},             // hr -> { localeId: true }, one entry per completed quest
    xp: 0,
    zenny: 3000,
    caught: {},              // variantId -> count
    pantry: {},              // ingredientId -> true, once found
    pouch: { potion: 5 },
    owned: { no_bait: Infinity },   // baitId -> count; No Bait is free and unlimited
    upgrades: { vitality: 0, endurance: 0, line: 0, lure: 0 },
    localeId: 'jurassic_frontier',
    // Which RUNG of the ladder the selected quest is. The same locale sits on a
    // rung per rank, and they are different quests — the tables, ores and goal
    // all come from this, not from your own HR.
    questHR: 1,
    baitId: 'no_bait',
    mealId: 'none',
    hired: false,            // a Hunter for Hire stands watch on the next trip
    plan: {},                // itemId -> how many to carry on the next trip
    tackle: {},              // baitId -> how many to carry; up to TACKLE_SLOTS kinds
    stats: { trips: 0, carts: 0, casts: 0, landed: 0, lost: 0, bosses: 0, pests: 0 },
  });

  let S = defaults();

  // Rebuild the live state from a saved object. Shared by the browser save and
  // by anything opened from a file, so a file can never load by different rules
  // than the mirror in this browser.
  function hydrate(saved) {
    S = { ...defaults(), ...saved };
    // Nested objects need merging, not replacing, or a new field breaks an old save.
    for (const k of ['caught', 'pantry', 'pouch', 'owned', 'upgrades', 'plan', 'tackle', 'stats'])
      S[k] = { ...defaults()[k], ...(saved[k] || {}) };
    S.owned.no_bait = Infinity;
    // Departing used to subtract from counts that were never there, which wrote
    // NaN — and JSON turns NaN into null. Scrub anything that is not a real
    // count so an already-damaged save comes back clean.
    for (const bag of [S.pouch, S.owned, S.plan, S.tackle])
      for (const [k, v] of Object.entries(bag))
        if (v !== Infinity && !Number.isFinite(v)) delete bag[k];
    S.owned.no_bait = Infinity;
    S.visited = saved.visited || {};
    syncHR();
  }

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      hydrate(JSON.parse(raw));
    } catch (e) {
      console.warn('save unreadable, starting fresh', e);
      S = defaults();
    }
  }

  // The state as plain JSON. One shape, whether it is going to localStorage or
  // into a file the player keeps.
  function snapshot() {
    const out = { ...S, owned: { ...S.owned } };
    delete out.owned.no_bait;         // Infinity does not survive JSON
    return out;
  }

  function save() {
    localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot()));
    // The browser copy is always current; the FILE is the thing that can fall
    // behind, so this is where the unsaved-changes mark is raised.
    if (window.MF_FILE) window.MF_FILE.touch();
  }

  // Replace everything from an opened file.
  function loadFrom(saved) { hydrate(saved); save(); }

  // ── Derived ───────────────────────────────────────────────────────────────
  const rank = () => G.rankAt(S.hr);
  const maxHP = mealId =>
    G.BASE_MAX_HP + meal(mealId).hp + fresh(mealId).hp + S.upgrades.vitality * 5;
  const maxStamina = mealId =>
    G.BASE_MAX_STAMINA + meal(mealId).stamina + fresh(mealId).stamina + S.upgrades.endurance * 8;
  const meal = id => G.MEALS.find(m => m.id === (id ?? S.mealId)) || G.MEALS[0];

  const xpNeeded = () => G.hrThreshold(S.hr);

  // ── Rank and promotion ────────────────────────────────────────────────────
  //
  // The ladder is HR by HR. Each HR opens its own locales, and you move up once
  // you have completed a quest at every one of them. An HR that opens nothing is
  // passed straight through, so an empty rung — HR8 for now — costs nothing.
  //
  // Past HR13 there are no more locales to open, so XP takes over.
  const localesForHR = hr => G.localesAtHR(hr).filter(id => {
    const loc = R.localeById.get(id);
    return loc && (loc.hasFishing || G.SHOW_DESIGNED_LOCALES);
  });

  const visitedAt = hr => S.visited[hr] || {};
  // Promotion counts the CURRENT rung only — that is what makes you climb. But
  // the Completed mark is a record of what you have done, so it reads across
  // every rung: a locale cleared at HR4 is still cleared when you reach HR7, and
  // its mark should not vanish the moment you are promoted.
  const everVisited = () => {
    const all = {};
    for (const seen of Object.values(S.visited)) Object.assign(all, seen);
    return all;
  };
  const visitedCount = hr => localesForHR(hr).filter(id => visitedAt(hr)[id]).length;
  const hrTotal = hr => localesForHR(hr).length;
  const hrComplete = hr => visitedCount(hr) >= hrTotal(hr);

  function syncHR() {
    S.rank = G.rankAt(S.hr).id;
  }

  // Called when a quest is COMPLETED — came home, with something to show for it.
  // A cart is a failed quest and marks nothing.
  // Marks the RUNG the quest was taken on. Clearing the Low Jurassic Frontier as
  // a High Rank angler ticks HR1, not HR4 — it was the Low quest you did.
  function markVisited(localeId, hr = S.hr) {
    if (hr >= G.MAX_LADDER_HR) return false;
    const seen = S.visited[hr] || (S.visited[hr] = {});
    if (seen[localeId]) return false;
    seen[localeId] = true;
    return true;
  }

  // Climb as far as the current visits allow, stepping over empty rungs.
  function checkPromotion() {
    if (S.hr >= G.MAX_LADDER_HR) return null;
    const from = S.hr;
    while (S.hr < G.MAX_LADDER_HR && hrComplete(S.hr)) S.hr++;
    if (S.hr === from) return null;
    S.xp = 0;
    syncHR();
    return S.hr;
  }

  // XP only means anything once the locale ladder has run out.
  function addXP(n) {
    if (S.hr < G.MAX_LADDER_HR) return [];
    S.xp += n;
    const gained = [];
    while (S.xp >= xpNeeded() && S.hr < 999) {
      S.xp -= xpNeeded();
      S.hr++;
      gained.push(S.hr);
    }
    syncHR();
    return gained;
  }

  // Returns what actually happened, so the trip can say the right thing: a new
  // ingredient, the same one now found fresh, or nothing worth mentioning.
  function recordIngredient(id, fresh) {
    const had = S.pantry[id];
    if (had === 'fresh') return null;
    S.pantry[id] = fresh ? 'fresh' : true;
    if (!had) return fresh ? 'new-fresh' : 'new';
    return fresh ? 'fresh' : null;
  }
  const pantryCount = () => Object.keys(S.pantry).length;
  const freshCount = () => Object.values(S.pantry).filter(v => v === 'fresh').length;

  // A fresh Meat puts HP on the meal and a fresh Vegetable puts Stamina on it, so
  // the two gauges have to read the bonus, not just the meal's own numbers.
  const fresh = mealId => G.freshBonus(meal(mealId), S.pantry);

  function record(variantId) {
    S.caught[variantId] = (S.caught[variantId] || 0) + 1;
    return S.caught[variantId] === 1;      // first time?
  }

  const guideTotal = () => window.MF_FISH.fish.length * window.CF_ORES.list.length;
  const guideFound = () => Object.keys(S.caught).length;

  // ── Money and stock ───────────────────────────────────────────────────────
  function spend(n) {
    if (S.zenny < n) return false;
    S.zenny -= n;
    return true;
  }
  const earn = n => { S.zenny += n; };

  const baitStock = id => (id === 'no_bait' ? Infinity : (S.owned[id] || 0));
  const itemStock = id => (S.pouch[id] || 0);

  // How many you could actually take: what you asked for, capped by the room left
  // under STOCK_CAP and by what your zenny covers. Buying in bulk should never be
  // all-or-nothing — asking for 99 with room for 12 buys the 12.
  function affordable(id, n, unit, held) {
    if (!unit || unit < 0) return 0;
    const room = Math.max(0, G.STOCK_CAP - held);
    return Math.max(0, Math.min(n, room, Math.floor(S.zenny / unit)));
  }
  const canBuyBait = (id, n) => {
    const b = baitBy.get(id);
    return b ? affordable(id, n, b.buy, baitStock(id)) : 0;
  };
  const canBuyItem = (id, n) => {
    const p = prepBy.get(id);
    return p ? affordable(id, n, G.priceOf(p), itemStock(id)) : 0;
  };

  function buyBait(id, n = 1) {
    const take = canBuyBait(id, n);
    if (!take || !spend(baitBy.get(id).buy * take)) return 0;
    S.owned[id] = (S.owned[id] || 0) + take;
    return take;
  }
  function buyItem(id, n = 1) {
    const take = canBuyItem(id, n);
    if (!take || !spend(G.priceOf(prepBy.get(id)) * take)) return 0;
    S.pouch[id] = (S.pouch[id] || 0) + take;
    return take;
  }

  // How many of each pouch item to carry. Capped by what you own AND by the
  // item's own carry limit; a slot is claimed by taking at least one of a kind.
  const planned = id => Math.min(S.plan[id] || 0, itemStock(id), G.carryLimit(id));
  const slotsUsed = () => window.MF_FISH.prep.filter(p => p.buy && planned(p.id) > 0).length;

  function setPlan(id, n) {
    const want = Math.max(0, Math.min(n, itemStock(id), G.carryLimit(id)));
    // Claiming a new slot is refused once the pouch is full; emptying one is fine.
    if (want > 0 && !planned(id) && slotsUsed() >= G.POUCH_SLOTS) return false;
    S.plan[id] = want;
    return true;
  }

  // ── Tackle box ────────────────────────────────────────────────────────────
  const tackled = id => Math.min(S.tackle[id] || 0, baitStock(id), G.BAIT_CARRY);
  const tackleKinds = () => Object.keys(S.tackle).filter(id => tackled(id) > 0);

  function setTackle(id, n) {
    const want = Math.max(0, Math.min(n, baitStock(id), G.BAIT_CARRY));
    if (want > 0 && !tackled(id) && tackleKinds().length >= G.TACKLE_SLOTS) return false;
    S.tackle[id] = want;
    return true;
  }

  // ── Upgrades ──────────────────────────────────────────────────────────────
  const upgradeCost = u => u.cost(S.upgrades[u.id]);
  function buyUpgrade(id) {
    const u = G.UPGRADES.find(x => x.id === id);
    if (!u || S.upgrades[id] >= u.max) return false;
    if (!spend(upgradeCost(u))) return false;
    S.upgrades[id]++;
    return true;
  }

  // ── Locale availability ───────────────────────────────────────────────────
  const localeOpen = id => R.isOpen(id, S.hr);

  // The selected quest, kept honest. A rung you have not reached, or one that
  // does not run this locale, falls back to the newest rung that does.
  function questRung() {
    const runs = G.localesAtHR(S.questHR) || [];
    if (S.questHR <= S.hr && runs.includes(S.localeId)) return S.questHR;
    let best = 1;
    for (let h = 1; h <= Math.min(S.hr, 12); h++)
      if (G.localesAtHR(h).includes(S.localeId)) best = h;
    return best;
  }
  function selectQuest(localeId, hr) {
    S.localeId = localeId;
    S.questHR = hr;
    save();
  }

  window.MF_APP = {
    get state() { return S; },
    BAITS, baitBy, prepBy,
    load, save, defaults, snapshot, loadFrom, SAVE_KEY,
    rank, meal, maxHP, maxStamina, xpNeeded, addXP, syncHR,
    localesForHR, visitedAt, visitedCount, hrTotal, hrComplete,
    markVisited, checkPromotion, everVisited,
    record, guideTotal, guideFound, recordIngredient, pantryCount, freshCount, fresh,
    spend, earn, buyBait, buyItem, buyUpgrade, upgradeCost, canBuyBait, canBuyItem,
    baitStock, itemStock, planned, setPlan, slotsUsed, localeOpen,
    tackled, tackleKinds, setTackle, questRung, selectQuest,
    reset() { S = defaults(); save(); },
  };
})();
