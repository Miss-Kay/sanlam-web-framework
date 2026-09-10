import { defineConfig, devices } from '@playwright/test';
import { site } from './fixtures/siteProfile';

/**
 * BASE_URL is env-driven so the same framework runs against:
 *  - the site profile's production URL (local, headed, exploratory runs)
 *  - a staging environment                (CI — if production ever blocks bots)
 */
export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'test-results/junit.xml' }], // Jira/Xray-importable
  ],
  use: {
    baseURL: process.env.BASE_URL || site.baseUrl, // empty/unset → site profile
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: site.locale,
  },
  /**
   * Two projects, not one. This header renders BOTH its desktop bar and its
   * mobile drawer into every page at every breakpoint, keeping the unused
   * copy in the DOM at zero height rather than unmounting it. That is
   * precisely the condition that makes `.first()` resolve an invisible
   * element, so running the mobile breakpoint is worth doing rather than
   * assuming — the two projects exercise opposite copies of the same nav.
   */
  projects: [
    {
      /**
       * Desktop: the link scan and the desktop header bar.
       *
       * The nav spec is desktop-only because at the phone breakpoint the
       * pillar bar is not rendered on screen at all — it collapses behind a
       * hamburger into a separate tree. Running it on mobile does not test
       * the same thing badly, it tests nothing: every pillar assertion fails
       * on a page that is working correctly. The drawer gets its own spec.
       */
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      testIgnore: /mobile-menu\.spec\.ts/,
    },
    {
      // Pixel 7, not an iPhone: iPhone descriptors run on WebKit, and CI
      // installs chromium only. Same breakpoint, one browser download.
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      /**
       * The mobile project runs the drawer spec ONLY.
       *
       * Not the link scan: because this header keeps both nav copies mounted
       * at every breakpoint, the collected link set is identical on the two
       * projects — 348 anchors at 1440px, 348 at 375px. Running it on both
       * would prove nothing new and would double every request the check
       * makes to two dozen third-party hosts, which is the exact thing the
       * union-once design in tests/link-integrity.spec.ts exists to avoid.
       *
       * And not the desktop nav spec, for the reason above. What genuinely
       * differs at this breakpoint is which nav a customer can reach, and
       * that is what tests/mobile-menu.spec.ts covers.
       */
      testMatch: /mobile-menu\.spec\.ts/,
    },
  ],
});
