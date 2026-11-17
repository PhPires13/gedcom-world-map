// Layouts, borders and finishes: every JSON file in layouts/, borders/ and finishes/ is one
// option, checked on load. (Styles live in styles/index.ts.) A server without Vite can import
// the JSON files directly; the renderer takes the specs themselves, not their ids.
import { validateBorder, validateFinish, type BorderSpec, type FinishSpec } from './borders';
import { validateLayout, type LayoutSpec } from './layouts';

function load<T extends { id: string }>(files: Record<string, T>, validate: (x: unknown) => string[], kind: string, first: string): T[] {
  return Object.entries(files)
    .filter(([path, s]) => {
      const errors = validate(s);
      if (errors.length) console.error(`Print ${kind} ${path} is invalid:\n  ${errors.join('\n  ')}`);
      return !errors.length;
    })
    .map(([, s]) => s)
    .sort((a, b) => (a.id === first ? -1 : b.id === first ? 1 : 0));
}

/** The order layouts are offered in. */
const LAYOUT_ORDER = ['accurate', 'closeup', 'homelands', 'storybook', 'vignette'];

export const LAYOUTS: LayoutSpec[] = load(
  import.meta.glob<LayoutSpec>('./layouts/*.json', { eager: true, import: 'default' }),
  validateLayout,
  'layout',
  'accurate',
).sort((a, b) => LAYOUT_ORDER.indexOf(a.id) - LAYOUT_ORDER.indexOf(b.id));

export const BORDERS: BorderSpec[] = load(import.meta.glob<BorderSpec>('./borders/*.json', { eager: true, import: 'default' }), validateBorder, 'border', 'engraved');

export const FINISHES: FinishSpec[] = load(import.meta.glob<FinishSpec>('./finishes/*.json', { eager: true, import: 'default' }), validateFinish, 'finish', 'clean');

export const layoutById = (id: string) => LAYOUTS.find((l) => l.id === id);
export const borderById = (id: string) => BORDERS.find((b) => b.id === id);
export const finishById = (id: string) => FINISHES.find((f) => f.id === id);
