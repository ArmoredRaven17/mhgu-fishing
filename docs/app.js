// app.js — state, persistence, and the things every other module reads.

(function () {
  const G = window.MF_GAME;
  const R = window.MF_ROLL;

  const SAVE_KEY = 'mhgu-fishing';

  const BAITS = G.buildBaits();
  const baitBy = new Map(BAITS.map(b => [b.id, b]));
  // Everything the pouch can hold, not just the provisions — combine materials
  // and books are bought and carried the same way a Potion is.
  const prepBy = new Map(G.pouchItems().map(p => [p.id, p]));

  const defaults = () => ({
    hr: 1,                   // the ladder itself: each HR opens its own locales
    rank: 'Low',             // derived from hr, kept for display
    visited: {},             // hr -> { localeId: true }, one entry per completed quest
    xp: 0,
    zenny: 3000,
    caught: {},              // variantId -> count
    caughtAt: {},            // localeId -> { fishId: count }, where each came from
    fishedAt: {},            // localeId -> { Low|High|G: true }, which tables you have read
    spaceToCast: false,      // opt-in: tap Space to cast instead of reaching for the button
    palicos: 0,              // cats hired to gather while you fish, 0..PALICO.max
    matsSeen: {},            // materialId -> true, once one has ever been in hand
    tradeItem: '',           // what the Trade Cart is working on, '' for no cart
    pantry: {},              // ingredientId -> true when found, 'fresh' when fresh
    freshOrder: [],          // which ingredients are fresh, oldest first
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
    for (const k of ['caught', 'caughtAt', 'pantry', 'pouch', 'owned', 'upgrades', 'plan', 'tackle', 'stats'])
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
    S.fishedAt = saved.fishedAt || {};
    S.spaceToCast = !!saved.spaceToCast;
    S.palicos = Math.max(0, Math.min(G.PALICO.max, saved.palicos || 0));
    S.matsSeen = saved.matsSeen || {};
    S.tradeItem = saved.tradeItem || '';
    // Anything already in the pouch has obviously been seen — this backfills a
    // save from before the record existed rather than blanking what it holds.
    for (const id of Object.keys(S.pouch)) if (G.materialById.has(id)) S.matsSeen[id] = true;
    prunePlans();          // an old save may already be over a pouch limit
    reconcileFresh();      // ...or carry more fresh ingredients than the cap
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
  // A selected meal is only YOUR meal while you can still cook it. Rank gates and
  // a pantry that can lose nothing mean a save can carry a selection it has since
  // outgrown — or, once the meal power ladder landed, one it has not yet grown
  // into. Either way the buff must not apply, so an unavailable pick reads as no
  // meal at all rather than silently feeding you a G Rank+ dish in High Rank.
  const meal = id => {
    const m = G.MEALS.find(x => x.id === (id ?? S.mealId));
    if (!m || !G.mealAvailable(m, S.pantry, S.hr)) return G.MEALS[0];
    return m;
  };

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

  // Fishing just puts it in the pantry. Nothing about freshness happens out on
  // the water — that is decided at camp, by rerollFresh below.
  function recordIngredient(id) {
    if (S.pantry[id]) return null;
    S.pantry[id] = true;
    return 'new';
  }

  // Which of the pantry is fresh for the next trip. Run on coming home, so the
  // pair rotates between trips rather than being fixed by whatever you happened
  // to fish up once.
  function rerollFresh() {
    for (const id of Object.keys(S.pantry)) S.pantry[id] = true;
    S.freshOrder = G.freshPick(S.pantry);
    for (const id of S.freshOrder) S.pantry[id] = 'fresh';
  }

  // Hold a loaded save to the cap. Saves written before there WAS one can carry
  // any number of fresh ingredients.
  function reconcileFresh() {
    const fresh = Object.keys(S.pantry).filter(id => S.pantry[id] === 'fresh');
    const order = (S.freshOrder || []).filter(id => fresh.includes(id));
    for (const id of fresh) if (!order.includes(id)) order.push(id);
    while (order.length > G.FRESH_MAX) S.pantry[order.shift()] = true;
    S.freshOrder = order;
  }
  const pantryCount = () => Object.keys(S.pantry).length;
  const freshCount = () => Object.values(S.pantry).filter(v => v === 'fresh').length;

  // A fresh Meat puts HP on the meal and a fresh Vegetable puts Stamina on it, so
  // the two gauges have to read the bonus, not just the meal's own numbers.
  const fresh = mealId => G.freshBonus(meal(mealId), S.pantry);

  // The locale is recorded alongside the catch, because "what comes out of where"
  // is worth knowing and nothing else in the save answers it. Catches made before
  // this existed carry no locale and are simply not counted here.
  function record(variantId, localeId, fishId) {
    S.caught[variantId] = (S.caught[variantId] || 0) + 1;
    if (localeId && fishId) {
      const at = S.caughtAt[localeId] || (S.caughtAt[localeId] = {});
      at[fishId] = (at[fishId] || 0) + 1;
    }
    return S.caught[variantId] === 1;      // first time?
  }

  // Locales you have actually pulled something out of, most-fished first.
  const caughtTotalAt = id => Object.values(S.caughtAt[id] || {}).reduce((x, y) => x + y, 0);
  // ── Which rank tables you have actually read ──────────────────────────────
  //
  // Recorded at DEPARTURE, not on completion: casting a line at a locale is what
  // shows you its water, whether or not you come home with the goal. A rung is
  // additive — a G Rank quest merges the Low, High and G tables and can land you
  // anything in them — so fishing a G rung marks all three.
  function markFished(localeId, hr) {
    const seen = S.fishedAt[localeId] || (S.fishedAt[localeId] = {});
    for (const r of G.tableRanksAt(hr)) seen[r] = true;
  }

  // Saves predate fishedAt, so the record is reconstructed from what they DID.
  // Two witnesses, both conservative: a completed quest names its own rung, and a
  // species that exists at this locale ONLY in a higher rank's table cannot have
  // been landed from anywhere else. Anything they fished but neither cleared nor
  // caught a telltale fish in stays hidden until they go back, which is the safe
  // direction to be wrong in.
  function revealedRanks(localeId) {
    const out = { ...(S.fishedAt[localeId] || {}) };
    for (const [hr, seen] of Object.entries(S.visited))
      if (seen[localeId]) for (const r of G.tableRanksAt(+hr)) out[r] = true;

    const R = window.MF_ROLL;                    // render-time only, never at load
    if (R && R.speciesByRank) {
      const per = R.speciesByRank(localeId);
      const got = caughtAtLocale(localeId);
      const below = { Low: [], High: ['Low'], G: ['Low', 'High'] };
      for (const rank of ['High', 'G']) {
        if (out[rank]) continue;
        const lower = new Set(below[rank].flatMap(r => per[r] || []));
        if ((per[rank] || []).some(f => got[f] && !lower.has(f)))
          for (const r of G.tableRanksAt(G.RANK_HR[rank])) out[r] = true;
      }
    }
    // Fished at all, but nothing to place it by: the lowest table it offers is the
    // only one it can safely be credited with.
    if (!Object.keys(out).length && Object.keys(caughtAtLocale(localeId)).length) {
      const per = R && R.speciesByRank ? R.speciesByRank(localeId) : null;
      const first = per ? ['Low', 'High', 'G'].find(r => per[r].length) : 'Low';
      if (first) out[first] = true;
    }
    return out;
  }

  const caughtAtLocale = id => S.caughtAt[id] || {};
  const fishedLocales = () => Object.keys(S.caughtAt)
    .filter(id => Object.keys(S.caughtAt[id] || {}).length)
    .sort((a, b) => caughtTotalAt(b) - caughtTotalAt(a));

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
    const room = Math.max(0, G.ownCap(id) - held);
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
  // Once held, always known: the Materials page stops masking it from here on,
  // whether it came from the shop or a Palico.
  const seeMaterial = id => { if (G.materialById.has(id)) S.matsSeen[id] = true; };
  const matSeen = id => !!S.matsSeen[id];

  // Locales you have actually set out to, keyed by NAME because that is what the
  // gathering tables are keyed by. Anything you have fished counts, whether or
  // not you cleared it — you were there, you saw what the place holds.
  function everFished() {
    const out = {};
    const R = window.MF_ROLL;
    for (const id of Object.keys(S.fishedAt || {})) {
      const loc = R && R.localeById.get(id);
      if (loc) out[loc.name] = true;
    }
    for (const id of Object.keys(S.caughtAt || {})) {
      const loc = R && R.localeById.get(id);
      if (loc) out[loc.name] = true;
    }
    return out;
  }

  function buyItem(id, n = 1) {
    const take = canBuyItem(id, n);
    if (!take || !spend(G.priceOf(prepBy.get(id)) * take)) return 0;
    S.pouch[id] = (S.pouch[id] || 0) + take;
    seeMaterial(id);
    return take;
  }

  // How many of each pouch item to carry. Capped by what you own AND by the
  // item's own carry limit; a slot is claimed by taking at least one of a kind.
  // S.plan and S.tackle hold what you WANT to bring — your intent — clamped only
  // by the item's own carry limit. Stock clamps at read time instead, so running
  // low never rewrites the plan: restock and you are back to bringing ten.
  const wanted = id => Math.min(S.plan[id] || 0, G.carryLimit(id));
  const planned = id => Math.min(wanted(id), itemStock(id));
  const wantedBait = id => Math.min(S.tackle[id] || 0, G.BAIT_CARRY);

  // A slot is held by INTENT, not by stock. An item you have run out of keeps its
  // place until you take it out yourself — which is also what stops a slot being
  // handed to something else and then double-claimed the moment you restock.
  function prunePlans() {
    for (const id of Object.keys(S.tackle)) if (wantedBait(id) <= 0) delete S.tackle[id];
    for (const id of Object.keys(S.plan)) if (wanted(id) <= 0) delete S.plan[id];
    for (const id of Object.keys(S.tackle).slice(G.TACKLE_SLOTS)) delete S.tackle[id];
    for (const id of Object.keys(S.plan).slice(G.POUCH_SLOTS)) delete S.plan[id];
  }

  // Coming home is where the pouch reconciles with the cupboard. WHILE YOU ARE
  // OUT a plan is pure intent — burn through all ten Potions and the slot stays
  // yours, so the pouch refills to ten the moment you restock. Back at camp with
  // none left to refill from, that intent is fiction: the slot is being held for
  // something you cannot actually bring, and it reads as a full pouch that packs
  // half a loadout. So an emptied line is dropped here, and only here.
  function dropEmptyPlans() {
    for (const id of Object.keys(S.plan)) if (itemStock(id) <= 0) delete S.plan[id];
    for (const id of Object.keys(S.tackle)) if (baitStock(id) <= 0) delete S.tackle[id];
    prunePlans();
  }

  // A slot is a slot whatever fills it — a Potion, a bag of husks or a book all
  // cost you one of the ten. Counting only the provisions let the books and
  // materials ride along free, which would have given away the entire trade.
  const slotsUsed = () => {
    prunePlans();
    return G.pouchItems().filter(p => (p.buy || p.kind === 'mat') && wanted(p.id) > 0).length;
  };

  function setPlan(id, n) {
    const want = Math.max(0, Math.min(n, G.carryLimit(id)));
    // Claiming a new slot is refused once the pouch is full; emptying one is fine.
    if (want > 0 && !wanted(id) && slotsUsed() >= G.POUCH_SLOTS) return false;
    S.plan[id] = want;
    return true;
  }

  // ── Tackle box ────────────────────────────────────────────────────────────
  const tackled = id => Math.min(wantedBait(id), baitStock(id));
  const tackleKinds = () => { prunePlans(); return Object.keys(S.tackle); };

  function setTackle(id, n) {
    const want = Math.max(0, Math.min(n, G.BAIT_CARRY));
    if (want > 0 && !wantedBait(id) && tackleKinds().length >= G.TACKLE_SLOTS) return false;
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
    record, guideTotal, guideFound, recordIngredient, reconcileFresh, rerollFresh, pantryCount, freshCount, fresh,
    fishedLocales, caughtAtLocale, caughtTotalAt, markFished, revealedRanks,
    spend, earn, buyBait, buyItem, buyUpgrade, upgradeCost, canBuyBait, canBuyItem,
    baitStock, itemStock, planned, setPlan, slotsUsed, localeOpen,
    seeMaterial, matSeen, everFished,
    tackled, tackleKinds, setTackle, prunePlans, dropEmptyPlans,
    wanted, wantedBait, questRung, selectQuest,
    reset() { S = defaults(); save(); },
  };
})();
