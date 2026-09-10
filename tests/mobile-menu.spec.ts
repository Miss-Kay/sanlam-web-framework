import { expect, test } from '@playwright/test';
import { HeaderNav } from '../pages/HeaderNav';
import { site } from '../fixtures/siteProfile';
import { headerPillars } from '../fixtures/testData';

/**
 * MOBILE MENU REACHABILITY — Sanlam Online
 *
 * At the phone breakpoint the entire product nav collapses behind one
 * hamburger. Nothing in the header bar is visible until it is opened, so on
 * mobile this control is the only door to the site's navigation — every
 * link the link-integrity suite proves healthy sits behind it.
 *
 * That makes it worth its own spec. It also turns out to be built the same
 * way as the desktop pillars: out of elements that are not controls.
 */
test.describe(`${site.name} — mobile menu`, () => {
  test.beforeEach(async ({ page }) => {
    const header = new HeaderNav(page);
    await header.open(site.entryPath);
    test.skip(
      await header.isBotBlocked(),
      `${site.name} served a bot interstitial to this runner IP — skipping (not a code failure)`,
    );
  });

  /**
   * The control that matters most: tapping the hamburger opens the drawer
   * and the drawer really is on screen.
   *
   * toBeInViewport, not toBeVisible. The drawer is translated off-screen
   * when closed rather than unmounted, so its links keep a non-zero bounding
   * box the whole time and every ordinary visibility check answers "yes"
   * while the customer can see nothing. Position is the only honest signal.
   */
  test('the hamburger opens the navigation drawer @nav @smoke', async ({ page }) => {
    const header = new HeaderNav(page);
    const drawer = await header.openMobileMenu();
    await expect(drawer).toBeInViewport({ timeout: 10_000 });
  });

  /**
   * Every pillar is present in the drawer — including the three that are not
   * links on the desktop bar.
   */
  test('every product pillar is listed in the drawer @nav @smoke', async ({ page }) => {
    const header = new HeaderNav(page);
    await header.openMobileMenu();

    // Collected and asserted once, rather than failing on the first gap, so
    // the report names every pillar that is missing instead of only the
    // earliest one alphabetically.
    const missing: string[] = [];
    for (const pillar of headerPillars) {
      if (!(await header.drawerPillar(pillar.label))) missing.push(pillar.label);
    }

    expect(
      missing,
      `${missing.length} pillar(s) are not on screen in the mobile drawer — on a phone `
        + `those have no entry point at all: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  /**
   * CHARACTERISATION TEST — quarantining a live accessibility defect.
   *
   * The hamburger is a CSS checkbox-hack menu: a `<label for="menu-toggle">`
   * bound to an `<input type="checkbox" id="menu-toggle">` whose computed
   * style is `display: none`. A display:none input is out of the tab order
   * and out of the accessibility tree, so there is no key a customer can
   * press to open this menu — and on a phone it is the only route to the
   * site's navigation.
   *
   * This is the same shape as the desktop pillar defect and strictly worse
   * in consequence: on the desktop bar a keyboard user loses three pillars,
   * here they lose all eight.
   *
   * Quarantined rather than left red, per the group's convention, and
   * asserted INVERTED on purpose: it passes while the defect is present and
   * fails once Sanlam ships a fix, at which point this test should be
   * deleted. The pointer path is asserted separately above, so a genuine
   * break of the menu still fails loudly.
   */
  test('the hamburger is still not keyboard operable @nav @known-defect', async ({ page }) => {
    const header = new HeaderNav(page);

    expect(
      await header.mobileMenuIsKeyboardOperable(),
      'the mobile menu toggle is now keyboard operable — the accessibility defect '
        + 'appears to be FIXED. Delete this test.',
    ).toBe(false);
  });

  /**
   * Duplicate ids on the header's own controls.
   *
   * `label[for]` binds to the FIRST element with a matching id, so a
   * duplicated id on a toggle means the label may be driving a different
   * element than the one the author intended. Both `menu-toggle` and
   * `right-drawer-toggle` are declared twice on this page.
   *
   * Reported as a soft assertion: it is invalid markup that happens to work
   * today, so it should be visible in every report without failing a run on
   * its own.
   */
  test('the header does not duplicate the ids of its own controls @nav @known-defect', async ({ page }) => {
    const header = new HeaderNav(page);
    const duplicates = await header.duplicateElementIds();

    await test.info().attach('duplicate-element-ids.md', {
      body:
        `# Duplicate element ids (${duplicates.length})\n\n`
        + (duplicates.length === 0
          ? 'Every id on the page is unique.\n'
          : duplicates.map(entry => `- ${entry}`).join('\n') + '\n'),
      contentType: 'text/markdown',
    });

    expect
      .soft(
        duplicates.filter(entry => /^(menu-toggle|right-drawer-toggle)\b/.test(entry)),
        'the header toggles no longer duplicate their ids — tidy this test up',
      )
      .not.toHaveLength(0);
  });
});
