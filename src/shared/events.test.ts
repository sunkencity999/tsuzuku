import { bus, type Events } from './events';

beforeEach(() => {
  bus.reset();
});

describe('bus', () => {
  it('emit is synchronous and ordered', () => {
    const seen: string[] = [];
    bus.on('xp:gained', (p) => seen.push(`a${p.amount}`));
    bus.on('xp:gained', (p) => seen.push(`b${p.amount}`));
    bus.emit('xp:gained', { amount: 2, reason: 'review', total: 2 });
    expect(seen).toEqual(['a2', 'b2']);
    bus.emit('xp:gained', { amount: 3, reason: 'review', total: 5 });
    expect(seen).toEqual(['a2', 'b2', 'a3', 'b3']);
  });

  it('a throwing subscriber does not stop the others', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: number[] = [];
    bus.on('level:up', () => {
      throw new Error('boom');
    });
    bus.on('level:up', (p) => seen.push(p.level));
    expect(() => bus.emit('level:up', { level: 5 })).not.toThrow();
    expect(seen).toEqual([5]);
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  it('unsubscribe works, also from inside a handler', () => {
    const seen: string[] = [];
    const off = bus.on('michikusa:read', (p) => seen.push(p.id));
    bus.emit('michikusa:read', { id: 'm-01-1' });
    off();
    bus.emit('michikusa:read', { id: 'm-01-2' });
    expect(seen).toEqual(['m-01-1']);

    const inner: string[] = [];
    const off2 = bus.on('michikusa:read', (p) => {
      inner.push(p.id);
      off2();
    });
    bus.on('michikusa:read', (p) => inner.push(`after-${p.id}`));
    bus.emit('michikusa:read', { id: 'x' });
    bus.emit('michikusa:read', { id: 'y' });
    expect(inner).toEqual(['x', 'after-x', 'after-y']);
    expect(bus.listenerCount('michikusa:read')).toBe(1);
  });

  it('once fires a single time', () => {
    const seen: number[] = [];
    bus.once('day:rolled', (p) => seen.push(p.day));
    bus.emit('day:rolled', { day: 1, awayDays: 0 });
    bus.emit('day:rolled', { day: 2, awayDays: 0 });
    expect(seen).toEqual([1]);
  });

  it('reset clears subscribers and the ring', () => {
    bus.on('kiai:entered', () => {
      throw new Error('should not run');
    });
    bus.emit('kiai:entered', {});
    expect(bus.recent()).toHaveLength(1);
    bus.reset();
    expect(bus.recent()).toHaveLength(0);
    expect(bus.listenerCount('kiai:entered')).toBe(0);
    expect(() => bus.emit('kiai:entered', {})).not.toThrow();
  });

  it('recent keeps the last 200 events, oldest first', () => {
    for (let i = 0; i < 250; i++) bus.emit('xp:gained', { amount: i, reason: 'r', total: i });
    const r = bus.recent();
    expect(r).toHaveLength(200);
    expect(r[0]).toEqual(['xp:gained', { amount: 50, reason: 'r', total: 50 }]);
    expect(r[199]?.[1]).toEqual({ amount: 249, reason: 'r', total: 249 });
  });

  it('payloads are typed (compile-time check)', () => {
    const payload: Events['badge:earned'] = { id: 'first-step' };
    bus.on('badge:earned', (p) => {
      expectTypeOf(p.id).toEqualTypeOf<Events['badge:earned']['id']>();
    });
    bus.emit('badge:earned', payload);
    // @ts-expect-error — wrong payload shape
    const bad: Events['badge:earned'] = { id: 'not-a-badge' };
    expect(bad).toBeTruthy();
    expectTypeOf<Events['attempt:graded']['rating']>().toEqualTypeOf<1 | 2 | 3 | 4 | null>();
  });

  it('listening:set accepts storyId null with refs in walk mode and the text-mode shape unchanged (design 08 §10.4)', () => {
    const seen: Events['listening:set'][] = [];
    bus.on('listening:set', (p) => seen.push(p));
    const walk: Events['listening:set'] = { storyId: null, refs: ['v-n5-0249#ex0', 's-07-2#L3'], correct: 5, total: 6, rate: 1, minutes: 2.5, mode: 'walk', cold: false };
    const text: Events['listening:set'] = { storyId: 's-07-1', correct: 6, total: 6, rate: 1.1, minutes: 3, genre: 'news', bridge: false, authentic: true, cold: true, mode: 'text' };
    const legacy: Events['listening:set'] = { storyId: 's-04-1', correct: 4, total: 6, rate: 0.9, minutes: 2 };
    bus.emit('listening:set', walk);
    bus.emit('listening:set', text);
    bus.emit('listening:set', legacy);
    expect(seen.map((p) => p.storyId)).toEqual([null, 's-07-1', 's-04-1']);
    expect(seen[0]?.refs).toHaveLength(2);
    expectTypeOf<Events['listening:set']['storyId']>().toEqualTypeOf<string | null>();
    expectTypeOf<Events['listening:set']['mode']>().toEqualTypeOf<'text' | 'walk' | undefined>();
    // @ts-expect-error — refs are strings
    const bad: Events['listening:set'] = { storyId: null, refs: [1], correct: 0, total: 0, rate: 1, minutes: 0 };
    expect(bad).toBeTruthy();
  });

  it('listen:played with gistCorrect null type-checks and round-trips (design 08 §12)', () => {
    const seen: Events['listen:played'][] = [];
    bus.on('listen:played', (p) => seen.push(p));
    const radio: Events['listen:played'] = { source: 'radio', refs: ['s-07-1'], seconds: 600, rate: 1.1, cold: false, authentic: true, gistCorrect: true };
    const readalong: Events['listen:played'] = { source: 'readalong', refs: ['s-04-1'], seconds: 300, rate: 0.9, cold: true, authentic: false, gistCorrect: null };
    bus.emit('listen:played', radio);
    bus.emit('listen:played', readalong);
    expect(seen).toEqual([radio, readalong]);
    expectTypeOf<Events['listen:played']['gistCorrect']>().toEqualTypeOf<boolean | null>();
    expectTypeOf<Events['listen:played']['source']>().toEqualTypeOf<'radio' | 'readalong'>();
    // @ts-expect-error — only radio and readalong log passive hearing
    const bad: Events['listen:played'] = { source: 'arena', refs: [], seconds: 0, rate: 1, cold: false, authentic: false, gistCorrect: null };
    expect(bad).toBeTruthy();
  });
});
