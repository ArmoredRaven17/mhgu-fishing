// theme.js — the family's theme system, ported from the Quest Randomizer.
//
// Every shade is derived from ONE chosen colour by moving only its lightness in
// HSL, so hue and saturation are preserved and every derived surface stays "in
// family". That is why the palette can be a list of bare hexes rather than a set
// of hand-built themes.
//
// The palette's invariant lives in data/themes.js: every swatch must hold white
// text and a white checkbox tick. Both come off one number — the browser picks a
// checkbox's tick glyph itself, white below relative luminance .1791 and black
// above, and white body text needs its ground at .1833 or below to clear 4.5:1,
// so the checkbox line is the stricter of the two.
//
// Every theme clears it, so the isLight branch below never fires. It is kept as
// the guard for a colour added later that has not been checked, which is exactly
// when it would matter.

(function () {
  const THEMES = window.MF_THEMES || [];
  const KEY = 'mhgu-fishing-theme';
  const DEFAULT_HEX = '#1E2025';           // Forbidden, the family default
  const FALLBACK_ICON = 'assets/MonsterIcons/MHGU-Question_Mark_Icon.webp';

  const byHex = new Map(THEMES.map(t => [t.hex.toUpperCase(), t]));

  // A saved theme is a bare hex, so anyone sitting on a retired one keeps a colour that is no
  // longer in the list: it never picks up the change, and anything keyed off the hex (the
  // selected swatch, the theme's icon) stops matching. Remap on read, not on write — the stale
  // value is already in localStorage on every device that chose it.
  //
  // This app is new enough that none of these ever shipped from it, but the map is kept
  // identical to the other nine rather than trimmed to this app's own history: the palette is
  // hand-copied with no shared source, and a per-app map is one more thing to drift.
  const LEGACY_HEX = {
    '#C8A319': '#74631D', '#57470B': '#74631D', '#5E4D0C': '#74631D',           // Tigrex
    '#574916': '#74631D', '#68581A': '#74631D',
    '#F1D364': '#9C8328', '#B59417': '#9C8328', '#C39F19': '#9C8328',           // Rajang
    '#BEA031': '#9C8328',
    '#C65900': '#783E0F', '#FC933E': '#C7620E',                                 // Tetsucabra, Agnaktor
    '#68360D': '#783E0F', '#B5590D': '#C7620E',
    '#3A9B3F': '#39993E', '#2DAE85': '#279773',                                 // Rathian, Zinogre
    '#D84696': '#D4358C', '#CE79A8': '#C8679D',                                 // Mizutsune, Congalala
    '#B57C45': '#835A32', '#CFAA87': '#B17A47',                                 // Barroth, Bulldrome
    '#AEB5C1': '#7C879B',                                                       // Valstrax
    '#FFFFFF': '#1E2025',                                                       // the Randomizer's white gag
  };
  const migrateHex = (h) => (h && LEGACY_HEX[h.toUpperCase()]) || h;

  const monsterIcon = name => `assets/MonsterIcons/MHGU-${name.replace(/ /g, '_')}_Icon.webp`;

  // ── Colour maths (verbatim from the Randomizer) ───────────────────────────
  const hexRgb = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); };
  const clamp = n => Math.max(0, Math.min(255, Math.round(n)));
  const clamp01 = n => Math.max(0, Math.min(1, n));
  const rgbToHsl = ([r, g, b]) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const l = (max + min) / 2;
    if (d === 0) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6
      : max === g ? ((b - r) / d + 2) / 6
        : ((r - g) / d + 4) / 6;
    return [h, s, l];
  };
  const hslToRgb = ([h, s, l]) => {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h * 6) % 2 - 1)), m = l - c / 2;
    const hi = Math.floor(h * 6) % 6;
    const [r, g, b] = hi === 0 ? [c, x, 0] : hi === 1 ? [x, c, 0] : hi === 2 ? [0, c, x]
      : hi === 3 ? [0, x, c] : hi === 4 ? [x, 0, c] : [c, 0, x];
    return [r + m, g + m, b + m].map(v => clamp(v * 255));
  };
  // darken/lighten only nudge lightness, so every derived shade keeps the chosen
  // colour's hue and saturation.
  const darken = (rgb, f) => { const [h, s, l] = rgbToHsl(rgb); return hslToRgb([h, s, clamp01(l * f)]); };
  const lighten = (rgb, b) => { const [h, s, l] = rgbToHsl(rgb); return hslToRgb([h, s, clamp01(l + (1 - l) * b)]); };
  const css = rgb => `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;

  // ── Money colour ──────────────────────────────────────────────────────────
  // Zenny totals and prices used to be a fixed gold on every theme — the one thing on
  // screen that ignored the theme entirely. This lightens the theme's OWN colour until it
  // is as bright as that gold was, so the figures sit in family and no theme reads dimmer
  // than it used to.
  //
  // Matching brightness rather than a contrast ratio is deliberate. The grounds vary hugely
  // across the palette — white text measures 4.5:1 on a dark theme's panel and barely 4.5:1
  // on a bright one — so a fixed contrast target either undershoots the dark themes badly
  // (they can afford far more) or washes the bright ones out to near-white.
  //
  // The near-neutral themes come out grey, which is correct: they have almost no chroma of
  // their own, and forcing a tint would invent a hue out of rounding noise.
  const relLum = ([r, g, b]) => {
    const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
    return .2126 * f(r) + .7152 * f(g) + .0722 * f(b);
  };
  const MONEY_LUM = 0.567;            // relative luminance of #e3c545, the gold this replaced
  const moneyColor = (c) => {
    for (let b = 0; b <= .95; b += .01) {
      const cand = lighten(c, b);
      if (relLum(cand) >= MONEY_LUM) return cand;
    }
    return lighten(c, .95);
  };

  let current = DEFAULT_HEX;

  function applyTheme(hex) {
    const c = hexRgb(hex), r = document.documentElement.style;
    const bright = c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
    const isLight = bright > 230;
    if (isLight) {
      r.setProperty('--bg', css(darken(c, .99)));
      r.setProperty('--bg1', css(darken(c, .99)));
      r.setProperty('--bg2', css(darken(c, .99)));
      r.setProperty('--hover', css(darken(c, .99)));
      r.setProperty('--accent', css(darken(c, .99)));
      r.setProperty('--accent-hover', css(darken(c, 0.1)));
      r.setProperty('--money', css(darken(c, 0.45)));   // dark ink for a light ground
      r.setProperty('--titlebar-overlay', 'rgba(0,0,0,0.02)');
    } else {
      r.setProperty('--bg', css(darken(c, .70)));
      r.setProperty('--bg1', css(darken(c, .80)));
      r.setProperty('--bg2', css(darken(c, 0.95)));
      r.setProperty('--hover', css(darken(c, 0.30)));
      r.setProperty('--accent', css(darken(c, 0.7)));
      r.setProperty('--accent-hover', css(lighten(c, 0.4)));
      r.setProperty('--money', css(moneyColor(c)));
      r.setProperty('--titlebar-overlay', 'rgba(0,0,0,0.18)');
    }
    r.setProperty('--text', isLight ? '#000000' : '#ffffff');
    r.setProperty('--text-dim', isLight ? '#000000' : '#fffffff5');
    r.setProperty('--line', isLight ? 'rgba(0,0,0,0.15)' : 'rgba(11, 8, 8, 0.12)');
    r.setProperty('--card', isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.05)');

    current = hex;
    try { localStorage.setItem(KEY, hex); } catch (e) { /* private mode */ }

    document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('sel', s.dataset.hex === hex));
    const icon = document.querySelector('.title-icon');
    if (icon) {
      const t = byHex.get(hex.toUpperCase());
      icon.src = t ? monsterIcon(t.icon) : FALLBACK_ICON;
      icon.alt = t ? t.name : '';
    }
  }

  function renderSwatches() {
    const grid = document.getElementById('swatchGrid');
    if (!grid) return;
    grid.textContent = '';
    for (const t of THEMES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (t.hex === current ? ' sel' : '');
      b.dataset.hex = t.hex;
      b.style.background = t.hex;      // the tile IS the colour, as in every other app
      b.title = t.name;
      const img = document.createElement('img');
      img.className = 'swatch-icon';
      img.alt = '';
      img.src = monsterIcon(t.icon);
      img.onerror = () => { img.onerror = null; img.src = FALLBACK_ICON; };
      const span = document.createElement('span');
      span.textContent = t.name;
      b.append(img, span);
      b.addEventListener('click', () => applyTheme(t.hex));
      grid.appendChild(b);
    }
  }

  function init() {
    let saved = DEFAULT_HEX;
    try { saved = migrateHex(localStorage.getItem(KEY)) || DEFAULT_HEX; } catch (e) { /* private mode */ }
    applyTheme(saved);
    renderSwatches();
    applyTheme(saved);   // re-run so the freshly drawn swatches get the `sel` marker
  }

  window.MF_THEME = { applyTheme, renderSwatches, init, get current() { return current; } };
})();
