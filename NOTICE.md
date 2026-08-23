# Notices and Attributions

This project bundles game data and icons derived from third-party sources.
The original source code of this project is MIT-licensed (see
[LICENSE](LICENSE)). The following third-party materials retain their own
licenses and require attribution.

---

## Game IP

**Monster Hunter Generations Ultimate** and all related characters, item
names, monster names, fish, locales, and other in-game assets are trademarks
and © Capcom Co., Ltd. This project is an **unofficial fan-made fishing
sim**. It is not affiliated with, endorsed by, or sponsored by Capcom.

---

## Game Data

A note on what is and is not real. Everything in [docs/data/](docs/data/) is
transcribed fact — the fish, which locale and rank each one is caught at,
their drop percentages, the canteen ingredients and the meals they unlock.
Everything in [docs/game.js](docs/game.js) is invented: prices, stamina and
HP costs, climate rates, the pond and reel constants, encounter chances,
quest goals. The two are kept in separate files on purpose so it is always
clear which is which.

### Kiranico (https://mhgu.kiranico.com/)

The fishing tables — which fish are caught at which locale, at which rank,
under which rod or bait, and at what percentage — originate from Kiranico's
MHGU locale pages. They are compiled into
[docs/data/locales.js](docs/data/locales.js) by
[scripts/build-data.mjs](scripts/build-data.mjs) from pages saved offline;
the saved pages themselves are **not** redistributed in this repository
(`data-src/` is gitignored).

Kiranico does not publish a formal data license; this attribution is offered
as courtesy acknowledgment of their fan-database work. If the maintainers of
Kiranico object to this use, please open an issue and the affected data will
be reviewed or removed.

### Monster Hunter Wiki (Fandom) — canteen data

Canteen ingredient unlock conditions and the English names of the meals they
cook are derived from the MHGU Canteen page on the Monster Hunter Wiki
(Fandom), compiled into [docs/data/canteen.js](docs/data/canteen.js) and
[docs/data/meals.js](docs/data/meals.js). **Fandom content is licensed under
[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).** Only the
factual unlock and recipe data is re-emitted, in this project's own schema.

### Item data and English naming — gatheringhallstudios / JoeLago

Item names, prices, icon assignments, and the monster and location tables
used to place encounters and small monsters are derived from the MHGU
database (`mhgu.db`) bundled in
[JoeLago/MHGUDB-iOS](https://github.com/JoeLago/MHGUDB-iOS) (MIT-licensed),
which in turn is built on the community database from
[gatheringhallstudios/MHGenDatabase](https://github.com/gatheringhallstudios/MHGenDatabase).

That database supplies the **English naming used throughout this project**,
the Hub quest list that gates which locales open at which rank, and the
quest–monster tables that decide which small monsters can pester you at each
locale. Only factual data is extracted and re-emitted in this project's own
schema; no source code, schema, or image assets from those projects are
redistributed. `mhgu.db` itself is not committed here.

---

## Icons

### Monster Hunter Wiki (Fandom) — monster icons

The monster icons under [docs/assets/MonsterIcons/](docs/assets/MonsterIcons/)
are sourced from the Monster Hunter Wiki on Fandom, carried over from the
MHGU Quest Randomizer project. **Fandom content is licensed under
[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).**
Underlying Capcom game sprites remain Capcom property regardless of which
community wiki redistributes them.

### Item, fish and bait icons

The item and bait icons under [docs/assets/ItemIcons/](docs/assets/ItemIcons/)
and [docs/assets/BaitIcons/](docs/assets/BaitIcons/) are the game's own
coloured item sprites, joined to items by name from the colour-icon set in
the MHGU save editor project. Fish variants are tinted at runtime by ore
colour rather than shipped per-variant. These remain Capcom property.

---

## Fonts

The MHFU display font under [docs/assets/fonts/](docs/assets/fonts/) is a
fan-made recreation of the Monster Hunter interface typeface, carried over
from the MHGU Quest Randomizer project.

---

## Development — AI assistance

A large share of this project's source code, its data generator, its balance
harness, and its documentation was written with
**[Claude Code](https://claude.com/claude-code)** (Anthropic), directed and
reviewed by the author. Commits made that way carry a `Co-Authored-By: Claude`
trailer.

This is disclosed for transparency rather than to satisfy a licence term. The
project's code remains MIT-licensed (see [LICENSE](LICENSE)).

---

## Reporting Misattribution

If a person, project, or organization is misattributed or omitted from this
notice, please open an issue on the project repository and the file will be
updated.
