import { S as RECORDS } from '@/records/strings';
import { S } from './strings';

describe('shell page copy (design 01 §3)', () => {
  it('the kana-check hint matches the plain input: no live conversion is promised', () => {
    expect(S.onbKanaPromptHint).not.toMatch(/as you type/);
    expect(S.onbKanaPromptHint).toBe('Type romaji or kana. Enter checks it.');
  });

  it('no zero-based slot numbers or spec jargon reach the learner', () => {
    const values = Object.values(S as Record<string, unknown>).filter((v): v is string => typeof v === 'string');
    for (const v of values) {
      expect(v).not.toMatch(/slot 0/i);
      expect(v).not.toMatch(/content pack/i);
    }
  });

  it('listening honesty (design 08 §10.1 / §12): the three source words, the honest share, and never "recorded voice"', () => {
    expect(S.sourcePack).toBe('synthetic voice (VOICEVOX)');
    expect(S.sourceDevice).toBe('device voice');
    expect(S.sourceNone).toBe('text only');
    expect(S.honestShare).toMatch(/39 hours/);
    expect(S.honestShare).toMatch(/7 hours/);
    expect(S.honestShare).toMatch(/75–95 hours/);
    expect(S.honestShare).toMatch(/1,500-hour goal/);
    // Design 08 §12 (re-pinned from the published three-tier pack a-754179a939): two-thirds of the weekly target at White and Yellow, all of it at Orange.
    expect(S.honestShare).toMatch(/two-thirds of the weekly listening target at White and Yellow and all of it at Orange/);
    // The Ledger (records tier, which cannot import app strings) carries the same words.
    expect(RECORDS.honestShare).toBe(S.honestShare);
    // The pace step's honesty clause is the honest share, not the old device-TTS sentence.
    expect(S.onbTtsNotice).toBe(S.honestShare);
    expect(S.onbTtsNotice).not.toMatch(/device’s text-to-speech/);
    expect(S.setPackNone).toBe('This build has no voice pack; your device voice speaks.');
    expect(S.aboutVoicesNone).toBe('No voice pack in this build; your device voice speaks.');
    expect(S.setPackExplain).toMatch(/^Pre-rendered synthetic voices \(VOICEVOX\)\./);
    const values = Object.values(S as Record<string, unknown>).filter((v): v is string => typeof v === 'string');
    for (const v of values) {
      expect(v).not.toMatch(/recorded voice/i);
      expect(v).not.toMatch(/every voice in the app is text-to-speech/i);
      expect(v).not.toMatch(/real listening is the hours you log/i);
    }
    // Every Japanese label on these pages has an English gloss key beside it.
    expect(S.onbMeetName).toBe('ハナ');
    expect(S.onbMeetNameEn).toBe('Hana');
    expect(S.onbMeetGreetingEn).toBe('hello');
    expect(S.setPackTitleJa).toBe('音声パック');
    expect(S.setPackTitle).toBe('Voice pack');
    expect(S.dojoRadioTitleJa).toBe('茶屋ラジオ');
    expect(S.dojoRadioTitle).toBe('Teahouse Radio');
    expect(S.aboutVoicesTitleJa).toBe('声');
    expect(S.aboutVoicesTitle).toBe('Voices');
    expect(S.aboutPrintsTitleJa).toBe('画');
    expect(S.aboutPrintsTitle).toBe('Prints');
  });

  it('prints (design 09 §12.1 d78): the no-pack line names the drawn room, the licence line says public domain and not CC BY-SA', () => {
    expect(S.aboutPrintsNone).toBe('No print pack in this build; the drawn room stands.');
    expect(S.aboutLicensePrints).toMatch(/public-domain/);
    expect(S.aboutLicensePrints).toMatch(/CC0/);
    expect(S.aboutLicensePrints).toMatch(/not CC BY-SA/);
    expect(S.aboutLicensePrints).not.toContain('!');
  });
});
