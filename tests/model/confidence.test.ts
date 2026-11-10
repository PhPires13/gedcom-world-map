import { describe, expect, it } from 'vitest';
import { computeConfidence, treeHealth, type EvidenceItem } from '../../src/model';

let n = 0;
/** A claim that proves the link, unless overridden. */
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

const level = (items: EvidenceItem[]) => computeConfidence(items).level;

describe('computeConfidence', () => {
  it('is unsupported with no claims', () => {
    const r = computeConfidence([]);
    expect(r.level).toBe('unsupported');
    expect(r.reasons).toEqual(['No source supports this link yet.']);
  });

  it('is proven by an original record stating the link directly with primary information', () => {
    expect(level([item()])).toBe('proven');
  });

  it('is only probable when the direct statement is second-hand, uncertain or from a copy', () => {
    expect(level([item({ information: 'secondary' })])).toBe('probable');
    expect(level([item({ information: 'undetermined' })])).toBe('probable');
    expect(level([item({ reading: 'uncertain' })])).toBe('probable');
    expect(level([item({ sourceKind: 'derivative' })])).toBe('probable');
  });

  it('is possible with one indirect piece of evidence', () => {
    expect(level([item({ evidence: 'indirect' })])).toBe('possible');
  });

  it('is probable when indirect evidence from two different sources agrees', () => {
    expect(level([item({ evidence: 'indirect' }), item({ evidence: 'indirect' })])).toBe('probable');
  });

  it('does not count two claims from the same source as independent', () => {
    expect(level([item({ evidence: 'indirect', sourceId: 'x' }), item({ evidence: 'indirect', sourceId: 'x' })])).toBe(
      'possible',
    );
  });

  it('is in conflict when a confirmed claim contradicts, even if another proves it', () => {
    const r = computeConfidence([item(), item({ stance: 'contradicts', evidence: 'indirect' })]);
    expect(r.level).toBe('conflict');
    expect(r.supporting).toBe(1);
    expect(r.contradicting).toBe(1);
  });

  it('is in conflict when only contradicting claims exist', () => {
    expect(level([item({ stance: 'contradicts' })])).toBe('conflict');
  });

  it('ignores rejected claims', () => {
    expect(level([item({ review: 'rejected' })])).toBe('unsupported');
    expect(level([item(), item({ stance: 'contradicts', review: 'rejected' })])).toBe('proven');
  });

  it('treats unreviewed AI proposals as possible at most', () => {
    const r = computeConfidence([item({ extractedBy: 'ai', review: 'proposed' })]);
    expect(r.level).toBe('possible');
    expect(r.pendingProposals).toBe(1);
    expect(level([item({ extractedBy: 'ai', review: 'accepted' })])).toBe('proven');
  });

  it('does not put a link in conflict on an unreviewed AI contradiction', () => {
    expect(level([item(), item({ stance: 'contradicts', extractedBy: 'ai', review: 'proposed' })])).toBe('proven');
    expect(level([item({ stance: 'contradicts', extractedBy: 'ai', review: 'proposed' })])).toBe('unsupported');
  });

  it('does not count compiled trees (authored sources) as evidence', () => {
    const r = computeConfidence([item({ sourceKind: 'authored' })]);
    expect(r.level).toBe('unsupported');
    expect(r.reasons.join(' ')).toMatch(/compiled trees/);
  });
});

describe('treeHealth', () => {
  it('counts levels and the share of proven links', () => {
    const h = treeHealth(['proven', 'proven', 'possible', 'unsupported']);
    expect(h.total).toBe(4);
    expect(h.counts).toEqual({ proven: 2, probable: 0, possible: 1, conflict: 0, unsupported: 1 });
    expect(h.provenShare).toBe(0.5);
  });

  it('is zero for an empty tree', () => {
    expect(treeHealth([]).provenShare).toBe(0);
  });
});
