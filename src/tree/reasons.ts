// Why a link has its confidence level. `computeConfidence` (src/model/confidence.ts, shared with
// the server) explains itself in English sentences; the Tree view shows them in the visitor's
// language by recognising each sentence and using the matching message.

import type { TreeMessageKey } from '../i18n/messages/tree';
import { t } from './i18n';

type Pattern = [RegExp, TreeMessageKey, ...string[]];

/** Every sentence `computeConfidence` can write, with the names of its numbers. */
const PATTERNS: Pattern[] = [
  [/^(\d+) claims? from compiled trees not counted as evidence\.$/, 'reason.authored', 'count'],
  [/^(\d+) AI proposals? waiting for review\.$/, 'reason.pending', 'count'],
  [/^Sources disagree: (\d+) claims? for, (\d+) claims? against\.$/, 'reason.disagree', 'for', 'against'],
  [/^(\d+) claims? contradicts? this link and none supports it\.$/, 'reason.contradicted', 'count'],
  [/^An original record states this link directly, from first-hand information\.$/, 'reason.proof'],
  [/^(\d+) other claims? agree\.$/, 'reason.othersAgree', 'count'],
  [/^A record states this link directly, but the reading is uncertain\.$/, 'reason.directUncertain'],
  [/^A record states this link directly, but from second-hand information\.$/, 'reason.directSecondHand'],
  [/^A record states this link directly, but in a copy or index, not the original record\.$/, 'reason.directDerivative'],
  [/^(\d+) different sources? agree\.$/, 'reason.sourcesAgree', 'count'],
  [/^One piece of indirect evidence supports this link\.$/, 'reason.indirect'],
  [/^Only proposed by the AI so far; nobody has confirmed it\.$/, 'reason.aiOnly'],
  [/^No source supports this link yet\.$/, 'reason.none'],
];

/** The message for one of `computeConfidence`'s sentences, or null for a sentence it does not know. */
export function reasonMessage(reason: string): { key: TreeMessageKey; vars: Record<string, number> } | null {
  for (const [re, key, ...names] of PATTERNS) {
    const m = re.exec(reason);
    if (m) return { key, vars: Object.fromEntries(names.map((n, i) => [n, Number(m[i + 1])])) };
  }
  return null;
}

/** A reason in the visitor's language (an unknown sentence is shown as the server wrote it). */
export function translateReason(reason: string): string {
  const r = reasonMessage(reason);
  return r ? t(r.key, r.vars) : reason;
}
