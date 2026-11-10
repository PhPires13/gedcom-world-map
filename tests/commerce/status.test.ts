import { describe, expect, it } from 'vitest';
import { allowedNext, canTransition, isFinal, nextManualStep, ORDER_STATUSES } from '../../src/commerce/status';

describe('order status machine', () => {
  it('follows the happy path for a physical print', () => {
    const path = ['created', 'paid', 'file_ready', 'sent_to_production', 'shipped', 'delivered'] as const;
    for (let i = 1; i < path.length; i++) expect(canTransition(path[i - 1], path[i], 'framed')).toBe(true);
  });

  it('delivers digital orders straight from file_ready, never through production', () => {
    expect(canTransition('file_ready', 'delivered', 'digital')).toBe(true);
    expect(canTransition('file_ready', 'sent_to_production', 'digital')).toBe(false);
    expect(canTransition('file_ready', 'delivered', 'print')).toBe(false);
  });

  it('never skips payment or goes backwards', () => {
    expect(canTransition('created', 'file_ready')).toBe(false);
    expect(canTransition('created', 'delivered')).toBe(false);
    expect(canTransition('shipped', 'sent_to_production')).toBe(false);
    expect(canTransition('delivered', 'shipped')).toBe(false);
    expect(canTransition('paid', 'created')).toBe(false);
  });

  it('allows cancelling until shipping, and refunding any paid or cancelled order', () => {
    for (const s of ['created', 'paid', 'file_ready', 'sent_to_production'] as const) expect(canTransition(s, 'cancelled')).toBe(true);
    expect(canTransition('shipped', 'cancelled')).toBe(false);
    for (const s of ['paid', 'file_ready', 'sent_to_production', 'shipped', 'delivered', 'cancelled'] as const) expect(canTransition(s, 'refunded')).toBe(true);
    expect(canTransition('created', 'refunded')).toBe(false);
  });

  it('ends at refunded', () => {
    expect(allowedNext('refunded')).toEqual([]);
    expect(isFinal('refunded')).toBe(true);
    expect(isFinal('delivered')).toBe(false);
    expect(ORDER_STATUSES.filter(isFinal)).toEqual(['refunded']);
  });

  it('gives operators the next manual step', () => {
    expect(nextManualStep('file_ready', 'print')).toBe('sent_to_production');
    expect(nextManualStep('sent_to_production', 'framed')).toBe('shipped');
    expect(nextManualStep('shipped', 'framed')).toBe('delivered');
    expect(nextManualStep('delivered', 'framed')).toBeUndefined();
    expect(nextManualStep('file_ready', 'digital')).toBeUndefined();
  });
});
