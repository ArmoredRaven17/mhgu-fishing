// MHGU mining ores — game truth only.
//
// Every field here is transcribed from the community MHGU database
// (mhgu-collection-tracker/data-src/mhgu.db):
//   name, rarity, sell   <- items.name / items.rarity / items.sell
//   color                <- items.icon_color, mapped 0..16 -> colour name
//                           (0 White, 1 Red, 2 Green, 3 Blue, 4 Yellow, 5 Purple,
//                            6 Light Blue, 7 Orange, 8 Pink, 10 Grey, ...)
//   icon                 <- mhgu-editor/src/assets/item_colored_icons.json
//   rank                 <- gathering table, site='Mine', which of LR/HR/G actually
//                           has nodes for it. Iron and Machalite have ZERO G nodes;
//                           Eltalite/Purecrystal/Ultimas/Allfire are G-exclusive.
//
// Nothing invented lives in this file. The game-design layer that decides how a
// Brachydios wearing each ore's colours behaves — tint, spawn weight, HP — lives in
// farm.js, deliberately kept apart from the transcribed facts.
//
// Note: the .png ore icons are actually WebP despite the extension (50x50, ~150 B).
// Browsers don't care; anything sniffing magic bytes would.
window.CF_ORES = {
  // rank: 0 = Low, 1 = High, 2 = G — the lowest rank that can mine it.
  list: [
    { id: "iron",        name: "Iron Ore",        rarity: 4, sell:   60, color: "Grey",       icon: "MH4G-Ore_Icon_Grey.png",       rank: 0 },
    { id: "earth",       name: "Earth Crystal",   rarity: 4, sell:   80, color: "White",      icon: "MH4G-Ore_Icon_White.png",      rank: 0 },
    { id: "machalite",   name: "Machalite Ore",   rarity: 4, sell:  160, color: "Blue",       icon: "MH4G-Ore_Icon_Blue.png",       rank: 0 },
    { id: "dragonite",   name: "Dragonite Ore",   rarity: 4, sell:  480, color: "Green",      icon: "MH4G-Ore_Icon_Green.png",      rank: 0 },

    { id: "carbalite",   name: "Carbalite Ore",   rarity: 6, sell:  680, color: "Purple",     icon: "MH4G-Ore_Icon_Purple.png",     rank: 1 },
    { id: "fucium",      name: "Fucium Ore",      rarity: 6, sell: 1020, color: "Pink",       icon: "MH4G-Ore_Icon_Pink.png",       rank: 1 },
    { id: "lightcrystal",name: "Lightcrystal",    rarity: 4, sell: 1150, color: "Grey",       icon: "MH4G-Ore_Icon_Grey.png",       rank: 1 },
    { id: "firecell",    name: "Firecell Stone",  rarity: 6, sell: 1720, color: "Orange",     icon: "MH4G-Ore_Icon_Orange.png",     rank: 1 },

    { id: "eltalite",    name: "Eltalite Ore",    rarity: 8, sell: 1280, color: "Red",        icon: "MH4G-Ore_Icon_Red.png",        rank: 2 },
    { id: "allfire",     name: "Allfire Stone",   rarity: 8, sell: 5160, color: "Red",        icon: "MH4G-Ore_Icon_Red.png",        rank: 2 },
    { id: "purecrystal", name: "Purecrystal",     rarity: 8, sell: 7320, color: "Light Blue", icon: "MH4G-Ore_Icon_Light_Blue.png", rank: 2 },
    { id: "ultimas",     name: "Ultimas Crystal", rarity: 8, sell: 7500, color: "Yellow",     icon: "MH4G-Ore_Icon_Yellow.png",     rank: 2 },
  ],
};
