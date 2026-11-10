import { afterAll, describe, expect, it } from 'vitest';
import { LOCALES, setLocale } from '../../src/i18n/core';
import { treeMessages } from '../../src/i18n/messages/tree';
import { computeConfidence, type EvidenceItem } from '../../src/model';
import { gedcomDate, lifespan } from '../../src/tree/format';
import { reasonMessage, translateReason } from '../../src/tree/reasons';

let n = 0;
const item = (over: Partial<EvidenceItem> = {}): EvidenceItem => ({
  claimId: `c${++n}`,
  sourceId: `s${n}`,
  sourceKind: 'original',
  stance: 'supports',
  evidence: 'direct',
  information: 'primary',
  reading: 'clear',
  extractedBy: 'person',
  review: 'accepted',
  ...over,
});

/** Claims that make `computeConfidence` write every kind of sentence it has. */
const SCENARIOS: EvidenceItem[][] = [
  [],
  [item({ stance: 'contradicts' })],
  [item({ stance: 'contradicts' }), item({ stance: 'contradicts' })],
  [item(), item({ stance: 'contradicts' }), item({ stance: 'contradicts' })],
  [item(), item({ evidence: 'indirect' })],
  [item(), item(), item()],
  [item({ reading: 'uncertain' })],
  [item({ information: 'secondary' })],
  [item({ sourceKind: 'derivative' })],
  [item({ evidence: 'indirect' }), item({ evidence: 'indirect' })],
  [item({ evidence: 'indirect' })],
  [item({ extractedBy: 'ai', review: 'proposed' })],
  [item({ extractedBy: 'ai', review: 'proposed' }), item({ extractedBy: 'ai', review: 'proposed' })],
  [item({ sourceKind: 'authored' })],
  [item({ sourceKind: 'authored' }), item({ sourceKind: 'authored' })],
];

afterAll(() => setLocale('pt'));

describe('tree messages', () => {
  it('have every Portuguese key in English and Spanish, and fill every placeholder', () => {
    const keys = Object.keys(treeMessages.pt).sort();
    const vars = { count: 2, people: 3, links: 4, for: 1, against: 2, proven: 1, total: 5, name: 'Ana', n: 2, level: 'X', kind: 'Y', file: 'f.ged', status: 500, message: 'm', detail: 'd', date: '1850', a: '1850', b: '1860', year: 1898, v: '12', role: 'pai' };
    for (const l of LOCALES) {
      expect(Object.keys(treeMessages[l]).sort()).toEqual(keys);
      for (const [key, msg] of Object.entries(treeMessages[l])) {
        if (typeof msg === 'function') expect(msg(vars), `${l} ${key}`).not.toMatch(/\{\w+\}|undefined|NaN/);
        else expect(msg.trim(), `${l} ${key}`).not.toBe('');
      }
    }
  });
});

describe('confidence reasons', () => {
  const reasons = [...new Set(SCENARIOS.flatMap((s) => computeConfidence(s).reasons))];

  it('recognises every sentence computeConfidence writes', () => {
    expect(reasons.length).toBeGreaterThanOrEqual(13);
    for (const r of reasons) expect(reasonMessage(r), r).not.toBeNull();
  });

  it('covers every reason message', () => {
    const used = new Set(reasons.map((r) => reasonMessage(r)!.key));
    const all = Object.keys(treeMessages.pt).filter((k) => k.startsWith('reason.'));
    expect([...used].sort()).toEqual(all.sort());
  });

  it('shows them in the visitor language, and unknown sentences as written', () => {
    setLocale('en');
    // Same sentences as the model's, with its one grammar slip fixed.
    for (const r of reasons) expect(translateReason(r)).toBe(r === '1 other claim agree.' ? '1 other claim agrees.' : r);
    setLocale('pt');
    expect(translateReason('2 other claims agree.')).toBe('Outras 2 afirmações concordam.');
    expect(translateReason('No source supports this link yet.')).toBe('Nenhuma fonte apoia este vínculo ainda.');
    expect(translateReason('Something new.')).toBe('Something new.');
    setLocale('es');
    expect(translateReason('Sources disagree: 1 claim for, 2 claims against.')).toBe(
      'Las fuentes no coinciden: 1 afirmación a favor, 2 afirmaciones en contra.',
    );
  });
});

describe('dates and lifespans', () => {
  it('reads GEDCOM dates in the visitor language', () => {
    setLocale('en');
    expect(gedcomDate('3 JAN 1898')).toBe('Jan 3, 1898');
    expect(gedcomDate('ABT 1850')).toBe('about 1850');
    setLocale('pt');
    expect(gedcomDate('BET 1850 AND 1860')).toBe('entre 1850 e 1860');
    expect(gedcomDate('bef 12 mar 1901')).toMatch(/^antes de 12 de mar\.? de 1901$/);
    setLocale('es');
    expect(gedcomDate('AFT 1850')).toBe('después de 1850');
    expect(gedcomDate('Spring 1850')).toBe('Spring 1850');
    expect(gedcomDate('31 FEB 1850')).toBe('31 FEB 1850');
  });

  it('marks a baptism year in the visitor language', () => {
    setLocale('pt');
    expect(lifespan({ baptism: { year: 1898 } })).toBe('bat. 1898–');
    setLocale('en');
    expect(lifespan({ baptism: { year: 1898 }, death: { year: 1950 } })).toBe('bap. 1898–1950');
  });
});
