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
