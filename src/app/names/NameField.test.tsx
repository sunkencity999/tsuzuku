import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { S, fmt } from '@/i18n/strings';
import { NAME_MAX_GLYPHS } from '@/store';
import { EMPTY_NAME_DRAFT, NameField, hasLatin, isKanaName, resolveName, shownWord, type NameDraft } from './NameField';
import { lookupName, type NameTable } from './index';

const FIXTURE: NameTable = [
  ['christopher', 'クリストファー', 'kurisutofa-'],
  ['hana', 'ハナ', 'hana'],
  ['sean', 'ショーン', 'sho-n'],
  ['jose', 'ホセ', 'hose'],
];
const lookup = (s: string) => lookupName(FIXTURE, s);

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

interface Harness {
  onSubmit: ReturnType<typeof vi.fn>;
  draft(): NameDraft;
}

function Host(p: { initial: NameDraft; onSubmit(): void; onDraft(d: NameDraft): void; maxLength?: number }) {
  const [d, setD] = useState<NameDraft>(p.initial);
  p.onDraft(d);
  return <NameField value={d} onChange={setD} onSubmit={p.onSubmit} lookup={lookup} maxLength={p.maxLength} autoFocus />;
}

function mount(initial: NameDraft = EMPTY_NAME_DRAFT, maxLength?: number): Harness {
  const onSubmit = vi.fn();
  let latest = initial;
  act(() => render(<Host initial={initial} onSubmit={onSubmit} onDraft={(d) => (latest = d)} maxLength={maxLength} />, root));
  return { onSubmit, draft: () => latest };
}

const q = <T extends Element = HTMLElement>(sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
const has = (sel: string): boolean => root.querySelector(sel) !== null;
const text = (sel: string): string => q(sel).textContent ?? '';
const click = (sel: string): void => {
  act(() => {
    q<HTMLButtonElement>(sel).click();
  });
};
const setValue = (input: HTMLInputElement, v: string): void => {
  act(() => {
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
/** Types into the English field (one input event; a paste is the same). */
const typeEnglish = (v: string): void => setValue(q<HTMLInputElement>('[data-name-input]'), v);
/** Types into the kana-mode IME one key at a time. */
const typeKana = (keys: string): void => {
  const input = q<HTMLInputElement>('.kana-input__field');
  for (const ch of keys) setValue(input, input.value + ch);
};
const pressEnter = (sel: string): void => {
  act(() => {
    q(sel).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
};

describe('<NameField> English mode (default)', () => {
  it('is a plain labelled text input with the katakana helper, not the IME', () => {
    mount();
    expect(q('.name-field').getAttribute('data-name-mode')).toBe('english');
    const input = q<HTMLInputElement>('[data-name-input]');
    expect(input.tagName).toBe('INPUT');
    expect(has('.kana-input')).toBe(false);
    const label = q<HTMLLabelElement>('label[for="onb-name"]');
    expect(label.textContent).toBe(S.onbNameFieldLabel);
    expect(input.id).toBe('onb-name');
    expect(q(`#${input.getAttribute('aria-describedby')}`).textContent).toBe(S.onbNameHelp);
    expect(S.onbNameHelp).toContain('カタカナ');
    expect(q('[data-name-live]').getAttribute('aria-live')).toBe('polite');
    expect(has('[data-name-suggest]')).toBe(false);
    expect(has('[data-name-nomatch]')).toBe(false);
  });

  it('shows the suggestion card for a known name: katakana, sound-it-out guide, one sentence, a Use button', () => {
    mount();
    typeEnglish('Christopher Bradford');
    const card = q('[data-name-suggest]');
    expect(q('[data-name-kana]').textContent).toBe('クリストファー');
    expect(q('[data-name-kana]').getAttribute('lang')).toBe('ja');
    expect(q('[data-name-guide]').textContent).toBe('ku・ri・su・to・fa・ー');
    expect(card.textContent).toContain(fmt(S.onbNameSuggestWhy, { name: 'Christopher' }));
    const use = q<HTMLButtonElement>('[data-name-accept]');
    expect(use.tagName).toBe('BUTTON');
    expect(use.type).toBe('button');
    expect(use.textContent).toBe(fmt(S.onbNameUse, { ja: 'クリストファー' }));
    expect(use.querySelector('[lang="ja"]')?.textContent).toBe('クリストファー');
    expect(has('[data-name-nomatch]')).toBe(false);
  });

  it('matches case- and accent-insensitively and capitalises the sentence', () => {
    mount();
    typeEnglish('josé');
    expect(q('[data-name-kana]').textContent).toBe('ホセ');
    expect(text('[data-name-suggest]')).toContain(fmt(S.onbNameSuggestWhy, { name: 'José' }));
  });

  it('Use puts the katakana into the field, confirms it, and Change brings the Latin back', () => {
    const h = mount();
    typeEnglish('Christopher');
    click('[data-name-accept]');
    expect(q<HTMLInputElement>('[data-name-input]').value).toBe('クリストファー');
    expect(has('[data-name-suggest]')).toBe(false);
    expect(text('[data-name-confirm]')).toContain(fmt(S.onbNameConfirm, { ja: 'クリストファー' }));
    expect(h.draft()).toEqual({ text: 'クリストファー', mode: 'english', latin: 'Christopher', accepted: 'suggestion' });
    expect(resolveName(h.draft())).toBe('クリストファー');
    click('[data-name-change]');
    expect(q<HTMLInputElement>('[data-name-input]').value).toBe('Christopher');
    expect(has('[data-name-confirm]')).toBe(false);
    expect(has('[data-name-suggest]')).toBe(true);
    expect(h.draft().accepted).toBeNull();
  });

  it('Enter accepts a shown suggestion; without one Enter is Next', () => {
    const h = mount();
    typeEnglish('Christopher');
    pressEnter('[data-name-input]');
    expect(q<HTMLInputElement>('[data-name-input]').value).toBe('クリストファー');
    expect(h.onSubmit).not.toHaveBeenCalled();
    pressEnter('[data-name-input]');
    expect(h.onSubmit).toHaveBeenCalledTimes(1);
    typeEnglish('Xylophone');
    pressEnter('[data-name-input]');
    expect(h.onSubmit).toHaveBeenCalledTimes(2);
  });

  it('no match: says so and offers Type it by sound and Keep … in English', () => {
    mount();
    typeEnglish('Xylophone');
    expect(has('[data-name-suggest]')).toBe(false);
    expect(text('[data-name-nomatch]')).toContain(fmt(S.onbNameNoMatch, { name: 'Xylophone' }));
    expect(q('[data-name-sound]').textContent).toBe(S.onbNameTypeBySound);
    expect(q('[data-name-keep]').textContent).toBe(fmt(S.onbNameKeepEnglish, { name: 'Xylophone' }));
    for (const b of Array.from(root.querySelectorAll('button'))) expect(b.type).toBe('button');
  });

  it('Keep in English accepts the Latin spelling and says what that means; Change reopens the choice; typing clears it', () => {
    const h = mount();
    typeEnglish('Xylophone');
    click('[data-name-keep]');
    expect(has('[data-name-nomatch]')).toBe(false);
    expect(text('[data-name-kept]')).toContain(fmt(S.onbNameKeptNote, { name: 'Xylophone' }));
    expect(h.draft().accepted).toBe('latin');
    expect(resolveName(h.draft())).toBe('Xylophone');
    expect(isKanaName(resolveName(h.draft()))).toBe(false);
    click('[data-name-change]');
    expect(has('[data-name-kept]')).toBe(false);
    expect(has('[data-name-nomatch]')).toBe(true);
    click('[data-name-keep]');
    typeEnglish('Xylophones');
    expect(h.draft().accepted).toBeNull();
    expect(has('[data-name-kept]')).toBe(false);
  });

  it('pasted kana is accepted as kana: confirmation, no suggestion, no no-match note', () => {
    const h = mount();
    typeEnglish('ハナ');
    expect(text('[data-name-confirm]')).toContain(fmt(S.onbNameConfirm, { ja: 'ハナ' }));
    expect(has('[data-name-suggest]')).toBe(false);
    expect(has('[data-name-nomatch]')).toBe(false);
    expect(resolveName(h.draft())).toBe('ハナ');
    typeEnglish('はな');
    expect(text('[data-name-confirm]')).toContain(fmt(S.onbNameConfirm, { ja: 'はな' }));
  });

  it('caps the typed or pasted text at maxLength glyphs in the DOM and the draft', () => {
    const h = mount(EMPTY_NAME_DRAFT, NAME_MAX_GLYPHS);
    const long = 'あいうえおかきくけこ'.repeat(10);
    typeEnglish(long);
    expect(Array.from(q<HTMLInputElement>('[data-name-input]').value).length).toBe(NAME_MAX_GLYPHS);
    expect(h.draft().text).toBe(long.slice(0, NAME_MAX_GLYPHS));
    expect(q<HTMLInputElement>('[data-name-input]').getAttribute('maxlength')).toBeNull();
  });
});

describe('<NameField> kana mode', () => {
  it('Type it by sound switches to the katakana IME with the compact guide and a way back', () => {
    const h = mount();
    typeEnglish('Xylophone');
    click('[data-name-sound]');
    expect(q('.name-field').getAttribute('data-name-mode')).toBe('kana');
    expect(has('[data-name-input]')).toBe(false);
    expect(q('.kana-input').getAttribute('data-katakana')).toBe('true');
    expect(q<HTMLLabelElement>('label[for="onb-name"]').textContent).toBe(S.onbNameKanaLabel);
    expect(q<HTMLInputElement>('.kana-input__field').id).toBe('onb-name');
    expect(q<HTMLInputElement>('.kana-input__field').value).toBe('');
    const guide = text('[data-name-kana-guide]');
    for (const line of [S.onbNameSoundGuide1, S.onbNameSoundGuide2, S.onbNameSoundGuide3, S.onbNameSoundGuide4]) expect(guide).toContain(line);
    expect(S.onbNameSoundGuide4).toContain('kurisutofa-');
    expect(S.onbNameSoundGuide4).toContain('クリストファー');
    expect(q('[data-name-back]').textContent).toBe(S.onbNameBackToEnglish);
    expect(h.draft()).toEqual({ text: '', mode: 'kana', latin: 'Xylophone', accepted: null });
  });

  it('typing by sound resolves to katakana; a lone pending letter is explained inline, never shown alone', () => {
    const h = mount();
    typeEnglish('Xylophone');
    click('[data-name-sound]');
    typeKana('kurisutofar');
    expect(q<HTMLInputElement>('.kana-input__field').value).toBe('クリストファr');
    expect(text('[data-name-pending]')).toBe(fmt(S.onbNamePending, { letters: 'r' }));
    expect(has('[data-name-confirm]')).toBe(false);
    // The IME's own pending span is hidden inside the field by the stylesheet; the guide carries the letter instead.
    const css = readFileSync(resolve(process.cwd(), 'src/app/names/NameField.css'), 'utf8');
    expect(css).toMatch(/\.name-field \.kana-input__pending\s*\{\s*display:\s*none;\s*\}/);
    // Backspace the stray r, then the long mark.
    const field = q<HTMLInputElement>('.kana-input__field');
    setValue(field, field.value.slice(0, -1));
    typeKana('-');
    expect(q<HTMLInputElement>('.kana-input__field').value).toBe('クリストファー');
    expect(has('[data-name-pending]')).toBe(false);
    expect(text('[data-name-confirm]')).toContain(fmt(S.onbNameConfirm, { ja: 'クリストファー' }));
    expect(resolveName(h.draft())).toBe('クリストファー');
    expect(isKanaName(resolveName(h.draft()))).toBe(true);
  });

  it('a trailing n is not "waiting": it becomes ン at Enter, and Enter is Next', () => {
    const h = mount();
    typeEnglish('Xylophone');
    click('[data-name-sound]');
    typeKana('jon');
    expect(q<HTMLInputElement>('.kana-input__field').value).toBe('ジョn');
    expect(has('[data-name-pending]')).toBe(false);
    expect(text('[data-name-confirm]')).toContain(fmt(S.onbNameConfirm, { ja: 'ジョン' }));
    pressEnter('.kana-input__field');
    expect(h.onSubmit).toHaveBeenCalledTimes(1);
    expect(h.draft().text).toBe('ジョン');
    expect(resolveName(h.draft())).toBe('ジョン');
  });

  it('Back to English keeps a finished kana name, or restores the Latin spelling when nothing resolved', () => {
    const h = mount();
    typeEnglish('Xylophone');
    click('[data-name-sound]');
    click('[data-name-back]');
    expect(q('.name-field').getAttribute('data-name-mode')).toBe('english');
    expect(q<HTMLInputElement>('[data-name-input]').value).toBe('Xylophone');
    expect(has('[data-name-nomatch]')).toBe(true);

    click('[data-name-sound]');
    typeKana('kurisutofa-');
    click('[data-name-back]');
    expect(q<HTMLInputElement>('[data-name-input]').value).toBe('クリストファー');
    expect(text('[data-name-confirm]')).toContain(fmt(S.onbNameConfirm, { ja: 'クリストファー' }));
    expect(h.draft().latin).toBe('Xylophone');
    click('[data-name-change]');
    expect(q<HTMLInputElement>('[data-name-input]').value).toBe('Xylophone');
  });

  it('the mixed leftovers of an English word typed into the IME are not kana', () => {
    const h = mount();
    typeEnglish('Xylophone');
    click('[data-name-sound]');
    typeKana('christopher');
    expect(q<HTMLInputElement>('.kana-input__field').value).toBe('chリsトpヘr');
    expect(text('[data-name-pending]')).toBe(fmt(S.onbNamePending, { letters: 'r' }));
    expect(resolveName(h.draft())).toBe('chリsトpヘr');
    expect(isKanaName(resolveName(h.draft()))).toBe(false);
  });
});

describe('helpers', () => {
  it('isKanaName: hiragana, katakana, ー, ・ and spaces only; never Latin or blank', () => {
    expect(isKanaName('クリストファー')).toBe(true);
    expect(isKanaName('はな')).toBe(true);
    expect(isKanaName('ハナ・チャン')).toBe(true);
    expect(isKanaName('ハナ ちゃん')).toBe(true);
    expect(isKanaName('ジョン')).toBe(true);
    expect(isKanaName('')).toBe(false);
    expect(isKanaName('   ')).toBe(false);
    expect(isKanaName('Christopher')).toBe(false);
    expect(isKanaName('chリsトpヘr')).toBe(false);
    expect(isKanaName('ジョn')).toBe(false);
    expect(isKanaName('無名')).toBe(false);
  });

  it('hasLatin sees accented letters too', () => {
    expect(hasLatin('José')).toBe(true);
    expect(hasLatin('é')).toBe(true);
    expect(hasLatin('クリス')).toBe(false);
    expect(hasLatin('')).toBe(false);
  });

  it('resolveName finalises kana mode, trims and clamps; English mode is kept verbatim', () => {
    expect(resolveName({ ...EMPTY_NAME_DRAFT, text: ' Christopher ' })).toBe('Christopher');
    expect(resolveName({ ...EMPTY_NAME_DRAFT, text: 'クリストファー' })).toBe('クリストファー');
    expect(resolveName({ ...EMPTY_NAME_DRAFT, text: 'ジョn', mode: 'kana' })).toBe('ジョン');
    expect(resolveName({ ...EMPTY_NAME_DRAFT, text: 'クリストファr', mode: 'kana' })).toBe('クリストファr');
    expect(resolveName({ ...EMPTY_NAME_DRAFT, text: '' })).toBe('');
    expect(resolveName({ ...EMPTY_NAME_DRAFT, text: 'a'.repeat(40) }, 24)).toBe('a'.repeat(24));
    expect(resolveName({ ...EMPTY_NAME_DRAFT, text: 'a'.repeat(40) })).toBe('a'.repeat(NAME_MAX_GLYPHS));
  });

  it('shownWord: first word, first letter capitalised', () => {
    expect(shownWord('christopher bradford')).toBe('Christopher');
    expect(shownWord('  McKenzie ')).toBe('McKenzie');
    expect(shownWord('josé')).toBe('José');
    expect(shownWord('')).toBe('');
  });
});
