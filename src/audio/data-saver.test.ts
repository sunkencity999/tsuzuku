/**
 * data-saver.ts — the effective data-saver gate (design 08 §13): the learner's
 * `settings.dataSaver` OR the browser's `navigator.connection.saveData`.
 */
import { resetStoreForTests, store } from '../store';
import { saveDataRequested as fromClips } from './clips';
import { dataSaverOn, prefetchAllowed, saveDataRequested } from './data-saver';
import * as barrel from './index';

const on = { connection: { saveData: true } };
const off = { connection: { saveData: false } };

afterEach(() => {
  resetStoreForTests();
});

describe('saveDataRequested', () => {
  it('reads navigator.connection.saveData: true only when the API is present and set', () => {
    expect(saveDataRequested(on)).toBe(true);
    expect(saveDataRequested(off)).toBe(false);
    expect(saveDataRequested({})).toBe(false);
    expect(saveDataRequested(null)).toBe(false);
    expect(saveDataRequested(undefined)).toBe(false); // the default navigator: jsdom has no connection API
    expect(saveDataRequested({ connection: { saveData: 'yes' } })).toBe(false);
  });

  it('a throwing accessor reads as off', () => {
    const nav = {
      get connection(): never {
        throw new Error('denied');
      },
    };
    expect(saveDataRequested(nav)).toBe(false);
  });

  it('is the clips.ts body, re-exported (one implementation)', () => {
    expect(saveDataRequested).toBe(fromClips);
  });
});

describe('dataSaverOn / prefetchAllowed', () => {
  it('settings.dataSaver || saveDataRequested()', () => {
    expect(dataSaverOn({ dataSaver: false }, off)).toBe(false);
    expect(dataSaverOn({ dataSaver: true }, off)).toBe(true);
    expect(dataSaverOn({ dataSaver: false }, on)).toBe(true);
    expect(dataSaverOn({ dataSaver: true }, on)).toBe(true);
  });

  it('prefetchAllowed is the negation', () => {
    for (const s of [{ dataSaver: false }, { dataSaver: true }]) for (const nav of [on, off]) expect(prefetchAllowed(s, nav)).toBe(!dataSaverOn(s, nav));
  });

  it('defaults to the live store settings (dataSaver off in a fresh save) and the real navigator', () => {
    expect(store.settings.value.dataSaver).toBe(false);
    expect(dataSaverOn()).toBe(false);
    expect(prefetchAllowed()).toBe(true);
    store.patch('settings', (s) => ({ ...s, dataSaver: true }));
    expect(dataSaverOn()).toBe(true);
    expect(prefetchAllowed()).toBe(false);
  });

  it('the @/audio barrel exports the gate', () => {
    expect(barrel.dataSaverOn).toBe(dataSaverOn);
    expect(barrel.prefetchAllowed).toBe(prefetchAllowed);
    expect(barrel.saveDataRequested).toBe(saveDataRequested);
  });
});
