// Gifts: a printed map sent to someone else with a card, and gift cards (vale-presente) bought in
// the shop and spent on a map. Pure functions shared by the server (validation) and the browser
// (limits, formatting the code as it is typed).

/** A present: who it is for and what the little card says. Prices never go in the parcel. */
export interface GiftDetails {
  /** The name on the card ("Para: Vovó Maria"); defaults to the delivery address's name. */
  recipientName: string;
  /** Printed on a small card in the parcel (the production sheet carries it to the lab). */
  message?: string;
}

export const GIFT_MESSAGE_MAX = 300;
export const GIFT_MESSAGE_MAX_LINES = 8;
const RECIPIENT_MAX = 100;

export class GiftError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
// Control and invisible characters (tabs, escapes, zero-width and direction marks) other than the line break.
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g;

/**
 * Checks a gift sent by a browser: `undefined`/`null`/`false` means not a gift. Only shipped
 * products can be gifts (`physical`); the recipient defaults to the delivery address's name.
 */
export function parseGift(v: unknown, opts: { physical: boolean; addressName?: string }): GiftDetails | undefined {
  if (v === undefined || v === null || v === false) return undefined;
  if (!isObj(v)) throw new GiftError('gift must be an object');
  if (!opts.physical) throw new GiftError('gift: only printed products can be sent as a gift');
  const name = v.recipientName === undefined || v.recipientName === null || v.recipientName === '' ? opts.addressName : v.recipientName;
  if (typeof name !== 'string' || !name.replace(CONTROL, '').trim()) throw new GiftError('gift.recipientName is required');
  const recipientName = name.replace(/\s+/g, ' ').replace(CONTROL, '').trim();
  if (recipientName.length > RECIPIENT_MAX) throw new GiftError(`gift.recipientName is too long (max ${RECIPIENT_MAX} characters)`);
  let message: string | undefined;
  if (v.message !== undefined && v.message !== null) {
    if (typeof v.message !== 'string') throw new GiftError('gift.message must be text');
    message = v.message
      .replace(/\r\n?/g, '\n')
      .replace(/\t/g, ' ')
      .replace(CONTROL, '')
      .replace(/[ ]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (message.length > GIFT_MESSAGE_MAX) throw new GiftError(`gift.message is too long (max ${GIFT_MESSAGE_MAX} characters)`);
    if (message.split('\n').length > GIFT_MESSAGE_MAX_LINES) throw new GiftError(`gift.message has too many lines (max ${GIFT_MESSAGE_MAX_LINES})`);
    if (!message) message = undefined;
  }
  return { recipientName, ...(message ? { message } : {}) };
}

// ---------- Gift card codes ----------

/**
 * The characters a code is made of: no 0/O, 1/I/L or U, so it can be read out and typed without
 * mistakes. 30 symbols × 12 characters ≈ 59 bits: not guessable.
 */
export const GIFT_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const GIFT_CODE_LENGTH = 12;

/** What a customer typed → the stored form (upper case, without spaces or dashes). */
export const normaliseGiftCode = (input: string) => input.toUpperCase().replace(/[\s\-_.]/g, '');

/** True when a normalised code could be one of ours (checked before touching the database). */
export const isGiftCodeShape = (code: string) => code.length === GIFT_CODE_LENGTH && [...code].every((c) => GIFT_CODE_ALPHABET.includes(c));

/** ABCD2345EFGH → ABCD-2345-EFGH. */
export const formatGiftCode = (code: string) => code.match(/.{1,4}/g)?.join('-') ?? code;

/** For operators and the history: only the last four characters. */
export const maskGiftCode = (code: string) => `••••-••••-${code.slice(-4)}`;
