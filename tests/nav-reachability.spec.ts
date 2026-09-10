import { expect, test } from '@playwright/test';
import { HeaderNav } from '../pages/HeaderNav';
import { site } from '../fixtures/siteProfile';
import { headerPillars } from '../fixtures/testData';

/**
 * HEADER NAV REACHABILITY — Sanlam Online
 *
 * A link check proves that the URLs on a page resolve. It says nothing about
 * whether a customer can get to them, because it only ever sees `a[href]` —
 * and on this site three of the eight product pillars are not anchors at
 * all. This spec covers that gap.
 */
test.describe(`${site.name} — header navigation`, () => {
  const linkedPillars = headerPillars.filter(pillar => pillar.href !== null);
  const unlinkedPillars = headerPillars.filter(pillar => pillar.href === null);

  test.beforeEach(async ({ page }) => {
    const header = new HeaderNav(page);
    await header.open(site.entryPath);
    test.skip(
      await header.isBotBlocked(),
      `${site.name} served a bot interstitial to this runner IP — skipping (not a code failure)`,
    );
    await expect(header.pillarBar).toBeAttached({ timeout: 30_000 });
  });

  /**
   * The pillars that ARE links point where they should.
   *
   * Each is resolved as the first VISIBLE match, not the first match: the
   * header renders every nav link twice — once for the desktop bar, once for
   * the mobile drawer — and the unused copy sits at zero height in the DOM
   * rather than being unmounted. `.first()` here is a coin flip.
   */
  for (const pillar of linkedPillars) {
    test(`"${pillar.label}" is reachable and points at ${pillar.href} @nav @smoke`, async ({ page }) => {
      const header = new HeaderNav(page);

      const link = await header.pillarLink(pillar.label);
      expect(link, `the "${pillar.label}" pillar is not a visible link in the header`).not.toBeNull();

      expect(await link!.getAttribute('href')).toBe(pillar.href);
    });
  }

  /**
   * CHARACTERISATION TEST — quarantining a live accessibility defect.
   *
   * Invest, Wealth and Rewards are not links. Each is a bare `<h6>` inside a
   * container that carries tabindex="0" and no role.
   *
   * The precise defect is "focusable but not operable". A keyboard user CAN
   * tab onto these pillars — the first version of this spec claimed
   * otherwise and was wrong — but pressing Enter or Space does nothing,
   * while a mouse hover opens the flyout. So three of the eight pillars can
   * be opened by pointer only, and the tab stop a keyboard user lands on has
   * no role for a screen reader to announce.
   *
   * All three legs are asserted, because the interesting failure is any one
   * of them changing:
   *
   *   - it is still not a link
   *   - the keyboard still cannot open it   (the defect)
   *   - the mouse still can                 (the control — if this breaks,
   *     the pillar is broken for everyone, which is a far bigger deal)
   *
   * This is recorded the way the group quarantines any known-open defect,
   * rather than left to redden the pipeline, so new breakage still fails
   * loudly. Note that the first two assertions are INVERTED on purpose: they
   * pass while the defect is present and fail once Sanlam ships a fix. That
   * is the intent. A green run means "the header still behaves the way
   * fixtures/testData.ts says it does"; a red one means it changed and the
   * table needs revisiting. Either way nobody has to rediscover this.
   */
  for (const pillar of unlinkedPillars) {
    test(`"${pillar.label}" opens by pointer only @nav @known-defect`, async ({ page }) => {
      const header = new HeaderNav(page);

      // It is on the page — this is an operability defect, not a missing pillar.
      const heading = await header.pillarHeading(pillar.label);
      expect(heading, `the "${pillar.label}" pillar has vanished from the header entirely`)
        .not.toBeNull();

      // ...and it is still not a link.
      expect(
        await header.pillarLink(pillar.label),
        `"${pillar.label}" is now a real link — the defect appears to be FIXED. `
          + 'Move it to the linked pillars in fixtures/testData.ts and delete it from here.',
      ).toBeNull();

      // It IS a tab stop. Recorded so nobody re-reports this as
      // "keyboard users cannot reach it", which is the wrong finding.
      expect(
        await header.pillarIsFocusable(pillar.label),
        `"${pillar.label}" is no longer focusable — that is a REGRESSION, not a fix: `
          + 'the pillar used to be a tab stop that could not be activated, and now '
          + 'the keyboard cannot even land on it.',
      ).toBe(true);

      // The defect itself: focus it, press Enter and Space, nothing opens.
      expect(
        await header.pillarOpensWithKeyboard(pillar.label),
        `"${pillar.label}" now opens with the keyboard — the accessibility defect `
          + 'appears to be FIXED. Update fixtures/testData.ts and remove this test.',
      ).toBe(false);

      // The control. A real hover, never a dispatched MouseEvent — synthetic
      // events do not drive this React tree the way a pointer does.
      expect(
        await header.pillarOpensWithMouse(pillar.label),
        `"${pillar.label}" no longer opens on hover either — the pillar is now `
          + 'broken for EVERY customer, not just keyboard users. This is worse than '
          + 'the defect this test was written to quarantine.',
      ).toBe(true);
    });
  }
});
