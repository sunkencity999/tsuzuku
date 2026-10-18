/**
 * Barrel split (review round 1 #12): the boot barrel `./index` carries only
 * the components A mounts at boot; the wallpaper registry and the PNG
 * pipeline are reachable through `./studio` alone. Static imports make a
 * broken barrel fail at `tsc` time as well as here.
 */
import * as boot from './index';
import * as studio from './studio';

const BOOT_NAMES = ['DojoScene', 'CeremonyHost', 'MonCrest', 'GoshuinStamp'] as const;
const STUDIO_NAMES = ['renderWallpaper', 'WALLPAPERS', 'exportPng', 'download', 'canRender4k', 'exportSizes', 'filenameFor'] as const;

describe('art barrels', () => {
  it('index exports exactly the boot-time components', () => {
    expect(Object.keys(boot).sort()).toEqual([...BOOT_NAMES].sort());
    for (const n of BOOT_NAMES) expect(typeof boot[n]).toBe('function');
  });

  it('studio exports the wallpaper registry and the PNG pipeline', () => {
    expect(Object.keys(studio).sort()).toEqual([...STUDIO_NAMES].sort());
    expect(Object.keys(studio.WALLPAPERS).length).toBe(29);
    for (const n of STUDIO_NAMES) if (n !== 'WALLPAPERS') expect(typeof studio[n]).toBe('function');
  });

  it('the boot barrel does not re-export anything from the studio barrel', () => {
    const bootKeys = new Set(Object.keys(boot));
    for (const n of STUDIO_NAMES) expect(bootKeys.has(n)).toBe(false);
  });
});
