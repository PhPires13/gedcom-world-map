// Confidence rules: how a relationship's level follows from the claims linked to it.
// Pure functions: no I/O, same answer on the server and in the browser.

import {
  CONFIDENCE_LEVELS,
  type ConfidenceExplanation,
  type ConfidenceLevel,
  type EvidenceType,
  type Extractor,
  type Id,
  type InformationQuality,
  type ReadingConfidence,
  type ReviewStatus,
  type SourceKind,
  type Stance,
  type TreeHealth,
} from './types';

/** One claim as it bears on one relationship: the claim, its source, and the link's stance. */
export interface EvidenceItem {
  claimId: Id;
  sourceId: Id;
  sourceKind: SourceKind;
  stance: Stance;
  evidence: EvidenceType;
  information: InformationQuality;
  reading: ReadingConfidence;
  extractedBy: Extractor['kind'];
  review: ReviewStatus;
}

/** True when this item alone is enough to call the link proven (if nothing contradicts it). */
export function isProof(e: EvidenceItem): boolean {
  return (
    e.stance === 'supports' &&
    e.evidence === 'direct' &&
    e.information === 'primary' &&
    e.sourceKind === 'original' &&
    e.reading !== 'uncertain'
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Computes a relationship's confidence level from the claims linked to it.
 *
 * 1. Rejected claims are ignored.
 * 2. AI claims nobody has reviewed yet (`review: 'proposed'`) are "pending": they can lift a link
 *    to `possible` at most, and a pending contradiction does not put it in conflict.
 * 3. Claims from `authored` sources (a GEDCOM, a published family tree) are someone else's
 *    conclusions, not evidence, and are ignored.
 * 4. Any remaining claim that contradicts the link → `conflict`.
 * 5. A claim that states the link directly, with primary information, from an original record,
 *    read without doubt → `proven`.
 * 6. Any other direct claim, or supporting claims from two or more different sources → `probable`.
 * 7. One supporting claim, or a pending AI proposal → `possible`.
 * 8. Nothing → `unsupported`.
 */
export function computeConfidence(items: readonly EvidenceItem[]): ConfidenceExplanation {
  const live = items.filter((e) => e.review !== 'rejected');
  const pending = live.filter((e) => e.review === 'proposed');
  const reviewed = live.filter((e) => e.review !== 'proposed');
  const authored = reviewed.filter((e) => e.sourceKind === 'authored');
  const counted = reviewed.filter((e) => e.sourceKind !== 'authored');
  const supporting = counted.filter((e) => e.stance === 'supports');
  const contradicting = counted.filter((e) => e.stance === 'contradicts');
  const pendingSupport = pending.filter((e) => e.stance === 'supports');

  const reasons: string[] = [];
  const result = (level: ConfidenceLevel): ConfidenceExplanation => {
    if (authored.length) reasons.push(`${plural(authored.length, 'claim')} from compiled trees not counted as evidence.`);
    if (pending.length) reasons.push(`${plural(pending.length, 'AI proposal')} waiting for review.`);
    return {
      level,
      reasons,
      supporting: supporting.length,
      contradicting: contradicting.length,
      pendingProposals: pending.length,
    };
  };

  if (contradicting.length) {
    reasons.push(
      supporting.length
        ? `Sources disagree: ${plural(supporting.length, 'claim')} for, ${plural(contradicting.length, 'claim')} against.`
        : `${plural(contradicting.length, 'claim')} contradict${contradicting.length === 1 ? 's' : ''} this link and none supports it.`,
    );
    return result('conflict');
  }

  const proof = supporting.find(isProof);
  if (proof) {
    reasons.push('An original record states this link directly, from first-hand information.');
    if (supporting.length > 1) reasons.push(`${plural(supporting.length - 1, 'other claim')} agree.`);
    return result('proven');
  }

  const direct = supporting.filter((e) => e.evidence === 'direct');
  const sources = new Set(supporting.map((e) => e.sourceId));
  if (direct.length || sources.size >= 2) {
    if (direct.length) {
      const d = direct[0];
      const why =
        d.reading === 'uncertain'
          ? 'but the reading is uncertain'
          : d.information !== 'primary'
            ? 'but from second-hand information'
            : 'but in a copy or index, not the original record';
      reasons.push(`A record states this link directly, ${why}.`);
    }
    if (sources.size >= 2) reasons.push(`${plural(sources.size, 'different source')} agree.`);
    return result('probable');
  }

  if (supporting.length) {
    reasons.push('One piece of indirect evidence supports this link.');
    return result('possible');
  }

  if (pendingSupport.length) {
    reasons.push('Only proposed by the AI so far; nobody has confirmed it.');
    return result('possible');
  }

  reasons.push('No source supports this link yet.');
  return result('unsupported');
}

/** Rank for sorting: 0 = proven … 4 = unsupported. */
export const confidenceRank = (level: ConfidenceLevel) => CONFIDENCE_LEVELS.indexOf(level);

/** Counts links per level; the health indicator is the share of proven links. */
export function treeHealth(levels: Iterable<ConfidenceLevel>): TreeHealth {
  const counts = Object.fromEntries(CONFIDENCE_LEVELS.map((l) => [l, 0])) as Record<ConfidenceLevel, number>;
  let total = 0;
  for (const l of levels) {
    counts[l]++;
    total++;
  }
  return { total, counts, provenShare: total ? counts.proven / total : 0 };
}
