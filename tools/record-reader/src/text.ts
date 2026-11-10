/** Text helpers shared by hint matching and the evaluation scorer. */

/** Removes "[illegible…]" / "[?x?]" markup, keeping uncertain readings' text. */
export function stripMarkup(s: string): string {
  return s
    .replace(/\[illegible[^\]]*\]/gi, " ")
    .replace(/\[\?([^\]]*?)\?\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lowercase, no accents, no punctuation, collapsed spaces. */
export function fold(s: string): string {
  return stripMarkup(s)
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Folds historical Portuguese/Italian/Spanish spelling variants together so
 * "Thereza", "Tereza" and "Teresa", or "Jozé" and "José", compare equal.
 */
export function foldName(s: string): string {
  return fold(s)
    .replace(/ph/g, "f")
    .replace(/th/g, "t")
    .replace(/y/g, "i")
    .replace(/([a-z])\1/g, "$1")
    .replace(/(?<=[aeiou])z(?=[aeiou])/g, "s")
    .replace(/(?<=[aeiou])z\b/g, "s")
    .replace(/oel\b/g, "uel") // Manoel → Manuel
    .replace(/\b(d|de|da|do|das|dos|di|del|della|e)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Character error rate on folded names (spelling variants like Thereza/Teresa do not count as errors). */
export function nameCer(expected: string, predicted: string): number {
  const e = foldName(expected);
  const p = foldName(predicted);
  if (!e.length) return p.length ? 1 : 0;
  return Math.min(1, levenshtein(e, p) / e.length);
}

/** 1 − normalised edit distance, on folded names. */
export function nameSimilarity(a: string, b: string): number {
  const x = foldName(a);
  const y = foldName(b);
  if (!x && !y) return 1;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length, 1);
}

/** Character error rate of `predicted` against `expected` (folded, accent-insensitive). */
export function cer(expected: string, predicted: string): number {
  const e = fold(expected);
  const p = fold(predicted);
  if (!e.length) return p.length ? 1 : 0;
  return Math.min(1, levenshtein(e, p) / e.length);
}

/**
 * How well a searched name matches a name on the record: each query token must
 * be close to some record token (handles "Ferreira" vs "Joaquim Ferreira").
 */
export function queryMatchScore(query: string, name: string): number {
  const q = foldName(query).split(" ").filter(Boolean);
  const n = foldName(name).split(" ").filter(Boolean);
  if (!q.length || !n.length) return 0;
  let total = 0;
  for (const qt of q) {
    let best = 0;
    for (const nt of n) best = Math.max(best, 1 - levenshtein(qt, nt) / Math.max(qt.length, nt.length));
    total += best;
  }
  return total / q.length;
}
