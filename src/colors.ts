// Generation colour ramp: warm = most recent, cool = oldest.
const STOPS = ['#e03131', '#f76707', '#f2a000', '#74b816', '#0ca678', '#1098ad', '#1c7ed6', '#5f3dc4', '#862e9c'];

const hexToRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbToHex = (rgb: number[]) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** Colour for generation `g` (0 = most recent) out of `maxGen`. */
export function generationColor(g: number, maxGen: number): string {
  if (maxGen <= 0) return STOPS[0];
  // Small trees use the stops directly so neighbouring generations stay distinct.
  if (maxGen < STOPS.length) return STOPS[Math.round((g / maxGen) * (STOPS.length - 1))];
  const t = (g / maxGen) * (STOPS.length - 1);
  const i = Math.min(Math.floor(t), STOPS.length - 2);
  const f = t - i;
  const a = hexToRgb(STOPS[i]);
  const b = hexToRgb(STOPS[i + 1]);
  return rgbToHex(a.map((v, k) => v + (b[k] - v) * f));
}

/**
 * A more vibrant version of a colour: the same hue and lightness, but close to full saturation.
 * Used where colours are drawn translucent, so they stay vivid instead of looking pastel.
 */
export function vibrant(color: string): string {
  const [r, g, b] = hexToRgb(color).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return color; // greys have no hue to boost
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const s = d / (1 - Math.abs(2 * l - 1));
  const s2 = Math.max(s, 0.92);
  // HSL back to RGB, keeping the original lightness.
  const c = (1 - Math.abs(2 * l - 1)) * s2;
  const hh = ((h % 6) + 6) % 6;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const [r1, g1, b1] =
    hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return rgbToHex([r1 + m, g1 + m, b1 + m].map((v) => v * 255));
}
