import { describe, expect, it } from 'vitest';
import { pressRing } from './press-ring';

describe('pressRing (design 09 §5.3, §12.1 d41)', () => {
  it('presses the hanko under the pointer and releases it on pointerup anywhere, from one delegated root', () => {
    const root = document.createElement('div');
    root.innerHTML = '<a class="hanko" href="#"><span class="hanko__face">Begin</span></a><button class="btn" type="button">x</button>';
    document.body.append(root);
    const off = pressRing(root);
    const face = root.querySelector('.hanko__face')!;
    face.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(root.querySelector('.hanko')?.classList.contains('is-pressed')).toBe(true);
    document.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(root.querySelector('.hanko')?.classList.contains('is-pressed')).toBe(false);
    // a plain button is not a seal
    root.querySelector('.btn')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(root.querySelector('.is-pressed')).toBeNull();
    // pointercancel releases too
    face.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    document.dispatchEvent(new Event('pointercancel', { bubbles: true }));
    expect(root.querySelector('.is-pressed')).toBeNull();
    // the canceller unbinds and releases
    face.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    off();
    expect(root.querySelector('.is-pressed')).toBeNull();
    face.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(root.querySelector('.is-pressed')).toBeNull();
    root.remove();
  });
});
