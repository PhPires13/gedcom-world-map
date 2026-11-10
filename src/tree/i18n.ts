// The Tree view's words, in the visitor's language (see src/i18n/README.md).

import { makeT } from '../i18n/core';
import { treeMessages } from '../i18n/messages/tree';
import type { ConfidenceLevel } from '../model';
import { ApiError } from './api';

export const t = makeT(treeMessages);

/** "Comprovado", "Proven", "Comprobado"… (the glossary's names for the confidence levels). */
export const levelLabel = (level: ConfidenceLevel) => t(`level.${level}`);

/**
 * A failure as the visitor should read it. The server's own message (in English) is kept as the
 * detail; a request that never reached the server says so in the visitor's language.
 */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) return t('error.server', { status: e.status, message: e.message });
  if (e instanceof TypeError) return t('error.network');
  return e instanceof Error ? e.message : String(e);
}
