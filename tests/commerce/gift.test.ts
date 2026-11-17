import { describe, expect, it } from 'vitest';
import { formatGiftCode, GIFT_CODE_ALPHABET, GiftError, isGiftCodeShape, maskGiftCode, normaliseGiftCode, parseGift } from '../../src/commerce/gift';
import { amountCharged, amountDue } from '../../src/commerce/order';
import { generateGiftCode } from '../../server/commerce/giftcards';

describe('parseGift', () => {
  const physical = { physical: true, addressName: 'Ana Costa' };

  it('is no gift when nothing is sent', () => {
    for (const v of [undefined, null, false]) expect(parseGift(v, physical)).toBeUndefined();
  });

  it('defaults the recipient to the address name and tidies the message', () => {
    expect(parseGift({ message: '  Para você,\r\n\r\n\r\n\r\ncom carinho.  ' }, physical)).toEqual({ recipientName: 'Ana Costa', message: 'Para você,\n\ncom carinho.' });
    expect(parseGift({ recipientName: ' Vovó\tMaria ', message: '' }, physical)).toEqual({ recipientName: 'Vovó Maria' });
    // Invisible and control characters are dropped.
    expect(parseGift({ message: 'a​b‮c\u0007' }, physical)?.message).toBe('abc');
  });

  it('refuses gifts that are too long, the wrong type, or not shipped', () => {
    expect(() => parseGift({ message: 'x'.repeat(301) }, physical)).toThrow(/too long \(max 300/);
    expect(parseGift({ message: 'x'.repeat(300) }, physical)?.message).toHaveLength(300);
    expect(() => parseGift({ message: 'a\nb\nc\nd\ne\nf\ng\nh\ni' }, physical)).toThrow(/too many lines/);
    expect(() => parseGift({ message: 7 }, physical)).toThrow(GiftError);
    expect(() => parseGift('yes', physical)).toThrow(/must be an object/);
    expect(() => parseGift({}, { physical: true })).toThrow(/recipientName is required/);
    expect(() => parseGift({ recipientName: 'x'.repeat(101) }, physical)).toThrow(/recipientName is too long/);
    expect(() => parseGift({ message: 'hi' }, { physical: false })).toThrow(/only printed products/);
  });
});

describe('gift card codes', () => {
  it('are 12 unambiguous random characters, never the same twice', () => {
    const codes = new Set(Array.from({ length: 2000 }, generateGiftCode));
    expect(codes.size).toBe(2000);
    for (const c of codes) {
      expect(isGiftCodeShape(c)).toBe(true);
      expect(c).not.toMatch(/[01OILU]/);
    }
    // Every symbol of the alphabet turns up (the draw is not biased to a few).
    expect(new Set([...codes].join('')).size).toBe(GIFT_CODE_ALPHABET.length);
  });

  it('read the way people type them, and show in groups or masked', () => {
    expect(normaliseGiftCode(' abcd-2345 efgh ')).toBe('ABCD2345EFGH');
    expect(isGiftCodeShape('ABCD2345EFGH')).toBe(true);
    expect(isGiftCodeShape('ABCD2345EFG')).toBe(false);
    expect(isGiftCodeShape('ABCD2345EFG0')).toBe(false);
    expect(formatGiftCode('ABCD2345EFGH')).toBe('ABCD-2345-EFGH');
    expect(maskGiftCode('ABCD2345EFGH')).toBe('••••-••••-EFGH');
  });
});

describe('amounts', () => {
  it('charges the price less the gift card, and refunds what Stripe took', () => {
    const o = { totalAmount: 68980, giftCardAmount: 20000, discountAmount: 0, amountPaid: undefined };
    expect(amountDue(o)).toBe(48980);
    expect(amountDue({ totalAmount: 6990, giftCardAmount: 6990 })).toBe(0);
    expect(amountCharged(o)).toBe(48980);
    expect(amountCharged({ ...o, discountAmount: 4898 })).toBe(44082);
    expect(amountCharged({ ...o, amountPaid: 1000 })).toBe(1000);
  });
});
