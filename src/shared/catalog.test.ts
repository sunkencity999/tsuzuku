import { BELT_IDS, EXERCISE_IDS } from '../content/types';
import {
  BADGE_IDS,
  BELT_BADGE,
  MISSIONS,
  QUESTS,
  QUEST_IDS,
  SFX_NAMES,
  SHINSA_SECTIONS,
  SHINSA_SECTION_JA,
  WALLPAPER_IDS,
  beltBadgeId,
} from './catalog';

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const unique = (xs: readonly string[]) => new Set(xs).size === xs.length;

describe('catalog counts', () => {
  it('68 badges / 29 wallpapers / 17 quests (design 08 §11), unique and kebab-case', () => {
    expect(BADGE_IDS).toHaveLength(68);
    expect(WALLPAPER_IDS).toHaveLength(29);
    expect(QUEST_IDS).toHaveLength(17);
    for (const list of [BADGE_IDS, WALLPAPER_IDS, QUEST_IDS, SFX_NAMES]) {
      expect(unique(list)).toBe(true);
      for (const id of list) expect(id).toMatch(KEBAB);
    }
  });

  it('ids named in the design docs are present', () => {
    for (const id of ['gatekeepers-respect', 'one-minute-monologue', 'form-chain-20', 'beyond-the-wall', 'tsuzuku', 'first-step']) {
      expect(BADGE_IDS).toContain(id);
    }
    for (const id of ['okaeri', 'kana-grid', 'fuji-ridge', 'daruma', 'vs-wall', 'wall-broken', 'kyoto-arrival', 'koi-dragon', 'end-card']) {
      expect(WALLPAPER_IDS).toContain(id);
    }
    expect(WALLPAPER_IDS).not.toContain('continue');
  });

  it('design 08 §11 adds the two listening badges and the teahouse wallpaper; the quest pool stays pinned', () => {
    expect(BADGE_IDS).toContain('teahouse-regular');
    expect(BADGE_IDS).toContain('first-hearing');
    expect(WALLPAPER_IDS).toContain('chaya-lanterns');
    expect(QUEST_IDS).not.toContain('radio-fifteen');
    expect(BADGE_IDS).not.toContain('voice-ear');
    // the end card stays the last kakejiku; つづく stays the last mon
    expect(WALLPAPER_IDS[WALLPAPER_IDS.length - 1]).toBe('end-card');
    expect(BADGE_IDS[BADGE_IDS.length - 1]).toBe('tsuzuku');
  });

  it('BADGE_IDS, WALLPAPER_IDS, QUEST_IDS and EXERCISE_IDS are pairwise disjoint', () => {
    const lists: readonly (readonly string[])[] = [BADGE_IDS, WALLPAPER_IDS, QUEST_IDS, EXERCISE_IDS];
    for (let i = 0; i < lists.length; i++) {
      for (let j = i + 1; j < lists.length; j++) {
        const b = new Set(lists[j]);
        for (const id of lists[i]!) expect(b.has(id)).toBe(false);
      }
    }
  });
});

describe('belt badges', () => {
  it('one per belt above White, in the badge list', () => {
    for (const belt of BELT_IDS) {
      const id = beltBadgeId(belt);
      if (belt === 'white') expect(id).toBeNull();
      else {
        expect(id).toBe(`belt-${belt}`);
        expect(BADGE_IDS).toContain(id);
        expect(BELT_BADGE[belt]).toBe(id);
      }
    }
  });
});

describe('quests and missions', () => {
  it('QUESTS covers QUEST_IDS exactly, in order, with all three strands', () => {
    expect(QUESTS.map((q) => q.id)).toEqual([...QUEST_IDS]);
    expect(new Set(QUESTS.map((q) => q.strand))).toEqual(new Set(['form', 'input', 'output']));
    for (const q of QUESTS) {
      expect(q.target).toBeGreaterThan(0);
      expect(q.fromStation).toBeGreaterThanOrEqual(1);
      if (q.requires) expect(EXERCISE_IDS).toContain(q.requires);
    }
    // the four Phase-2 drills keep their quests out of the Phase-1 pool
    for (const q of QUESTS.filter((x) => x.requires && ['nemesis-duel', 'rapid-fire', 'role-play', 'field-mission'].includes(x.requires))) {
      expect(q.phase).toBe(2);
    }
  });
  it('Stations 1–2 can always draw two Kata: form and input each hold ≥ 2 quests from Station 1 with no `requires`', () => {
    const fromOne = (strand: string) => QUESTS.filter((q) => q.strand === strand && q.fromStation <= 1 && q.requires === undefined).map((q) => q.id);
    expect(fromOne('form').length).toBeGreaterThanOrEqual(2);
    // michikusa-one closes once every fragment of stations ≤ current + 1 is collected (setQuestGates);
    // outside-twenty is the second input Kata because the ledger exists from the first save.
    expect(fromOne('input')).toEqual(expect.arrayContaining(['michikusa-one', 'outside-twenty']));
    // The output strand has no drill before shadow (design 04 §13), so the third Kata starts at Station 3.
    expect(Math.min(...QUESTS.filter((q) => q.strand === 'output').map((q) => q.fromStation))).toBe(3);
  });
  it('MISSIONS escalate by tier with XP in 30–100 and exactly one conversation tier', () => {
    expect(MISSIONS.map((m) => m.tier)).toEqual([1, 2, 3, 4, 5]);
    for (const m of MISSIONS) {
      expect(m.id).toMatch(KEBAB);
      expect(m.xp[0]).toBeGreaterThanOrEqual(30);
      expect(m.xp[1]).toBeLessThanOrEqual(100);
      expect(m.xp[0]).toBeLessThanOrEqual(m.xp[1]);
      expect(BELT_IDS).toContain(m.belt);
      expect(m.minutes).toBeGreaterThan(0);
    }
    expect(MISSIONS.filter((m) => m.conversation)).toHaveLength(1);
    expect(MISSIONS[0]!.fromStation).toBe(3);
  });
  it('Shinsa sections', () => {
    expect(SHINSA_SECTIONS).toEqual(['ear', 'read', 'form', 'mouth', 'write']);
    for (const s of SHINSA_SECTIONS) expect(SHINSA_SECTION_JA[s]).toHaveLength(1);
  });
});
