# MHGU Fishing

A fishing sim built on **Monster Hunter Generations Ultimate**'s own fishing
tables. Every fish is real and lives where the game says it lives; each one comes
in twelve ore varieties, so the guide is 20 fish × 12 ores = 240 entries to fill.

**Live:** https://armoredraven17.github.io/mhgu-fishing/ *(GitHub Pages, served from `docs/`)*

## The loop

A trip is shaped like a quest: prepare at camp, travel to a locale, come home
with the catch.

- **Two resources.** Stamina is spent fishing — run out and you go home *with*
  the haul, you just ran out of day. HP is spent on the climate, small monsters
  and anything large that takes your line — run out and you **cart**, and the
  entire haul is lost. That asymmetry is the whole game.
- **Casting** is a bird's-eye pond. Fish drift; with a bait in the water they are
  drawn to your bobber. One takes it under, and that grey bobber is your cue to
  strike. Then work the line: it starts half full and falls on its own, every tap
  pulls it back up, and **both ends lose** — slack and the fish shakes off, too
  tight and the line snaps. You only gain ground while it holds near the middle.
- **Bait swaps the school.** A species bait fills the pond with that fish (ore
  still rolled), a variety bait fills it with that ore (species still rolled). It
  never conjures: a bait for a fish that does not live there catches you nothing.
- **Plesioth and Lavasioth** turn up as encounters, placed by the game's real
  habitat data. Losing to one costs HP scaled by the locale's rank.
- **Locales open by Hunter Rank**, and you climb by clearing every locale on your
  current rung. What clears a quest is zenny brought home, and the target is
  computed per locale from what its water is actually worth.

## Saves

Progress is kept in your browser automatically, so there is nothing to load each
visit. **Save / Save As / Open** also write a JSON file you can back up or move
between machines — the File System Access API in Chrome/Edge, download/upload
elsewhere. **New** clears the browser copy and never touches a file on disk.

## Local development

No build step. Serve `docs/` over HTTP:

```
cd docs
python -m http.server 8000
```

Then open http://localhost:8000/.

Bump the `?v=N` query string on the `<link>`/`<script>` tags in `docs/index.html`
whenever you change a CSS or JS file — GitHub Pages caches by full URL.

## Regenerating data

`scripts/build-data.mjs` reads the offline sources in `data-src/` (not committed
— see [NOTICE.md](NOTICE.md)) plus a copy of the community MHGU database, and
writes `docs/data/*.js`. Zero npm dependencies; needs Node 22+ for `node:sqlite`.

```
node scripts/build-data.mjs
```

`scripts/simulate.mjs` is the balance harness. Run it before believing any number
— a cost curve is a feedback loop, not a dial.

```
node scripts/simulate.mjs 2000
```

## Layout

| Path | What it is |
|---|---|
| `docs/data/*.js` | Generated. Transcribed fact only — fish, locales, meals, ingredients. |
| `docs/game.js` | The invented layer: balance, prices, climate, pond and reel constants. |
| `docs/roll.js` | What is on the end of the line — pools, bait, ore, encounters, pests. |
| `docs/fishing.js` | The pond: swim → hooked → reel, in one animation loop. |
| `docs/quest.js` | A trip, from departure to cart or camp. |
| `docs/prep.js` `ui.js` `guide.js` | Camp, shop and collectables. |
| `docs/savefile.js` | New / Save / Save As / Open. |
| `docs/theme.js` | Every shade derived from one chosen colour. |

Fact and invention are kept apart on purpose: anything in `docs/data/` came out
of the game, anything in `docs/game.js` was made up to make a game of it.

## Licence

Source code is MIT (see [LICENSE](LICENSE)). Game data, names and icons belong to
Capcom — see [NOTICE.md](NOTICE.md) for attributions. This is an unofficial
fan-made project, not affiliated with or endorsed by Capcom.
