// The style registry: every JSON file in this folder is a print style. Add a file to add a style.
import { validateStyle, type PrintStyle } from '../style';

const files = import.meta.glob<PrintStyle>('./*.json', { eager: true, import: 'default' });

export const STYLES: PrintStyle[] = Object.entries(files)
  .filter(([path, s]) => {
    const errors = validateStyle(s);
    if (errors.length) console.error(`Print style ${path} is invalid:\n  ${errors.join('\n  ')}`);
    return !errors.length;
  })
  .map(([, s]) => s)
  // Antique first: it's the flagship look.
  .sort((a, b) => (a.id === 'antique' ? -1 : b.id === 'antique' ? 1 : a.name.localeCompare(b.name)));

export const styleById = (id: string) => STYLES.find((s) => s.id === id) ?? STYLES[0];
