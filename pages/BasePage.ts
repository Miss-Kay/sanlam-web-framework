import { Locator, Page, expect, test } from '@playwright/test';
import { site } from '../fixtures/siteProfile';

/**
 * BasePage: shared plumbing for every page object.
 * Keep this thin — if it grows past ~120 lines of code, something belongs
 * elsewhere.
 */
export abstract class BasePage {
  constructor(protected page: Page) {}

  /**
   * Whether this page object should close the promotional notification bar.
   *
   * Defaults to true — a page object that CLICKS things wants stable layout.
   * LinkScanPage turns it off, and the reason is worth reading before anyone
   * turns it back on: see dismissPromoBar().
   */
  protected get dismissesPromoBar(): boolean {
    return true;
  }

  async open(path = '/'): Promise<void> {
    await this.page.goto(path, { waitUntil: 'domcontentloaded' });
    await this.dismissConsentBanner();
    if (this.dismissesPromoBar) await this.dismissPromoBar();
  }

  /**
   * Consent banner.
   *
   * Sanlam Online serves none — see SiteProfile.consentBanner, which records
   * that as a checked finding rather than an omission. So this method exists
   * to return immediately, and the early return IS the implementation.
   *
   * That matters more than it looks. Every sibling framework in this group
   * carries a comment about the trap its vendor's banner set — OneTrust's
   * `#onetrust-consent-sdk` and consentmanager's `#cmpwrapper` both render a
   * full-width zero-height wrapper that reports as not visible while the
   * real banner covers the page. The lesson those cost was "wait on the
   * banner, never the wrapper". The lesson here is the cheaper one: if the
   * profile names no banner, do not go looking for one. A speculative
   * `waitFor` against a selector that will never match burns its full
   * timeout on every page open, and this suite opens six.
   */
  protected async dismissConsentBanner(): Promise<void> {
    if (!site.consentBanner) return; // no banner is served on this site

    const banner = this.page.locator(site.consentBanner);
    const shown = await banner
      .waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (!shown) return;

    // Least-permissive control first, so the run does not opt into more
    // tracking than a privacy-conscious customer would.
    const candidates = [
      this.page.getByRole('button', { name: /reject non-?essential|reject all|decline/i }),
      this.page.getByRole('link', { name: /reject non-?essential|reject all|decline/i }),
      this.page.getByRole('button', { name: /accept/i }),
    ];
    for (const candidate of candidates) {
      try {
        await candidate.first().click({ timeout: 3000 });
        await banner.waitFor({ state: 'hidden', timeout: 8000 });
        return;
      } catch {
        /* try the next control */
      }
    }
    console.warn('[CONSENT] banner was shown but could not be dismissed');
  }

  /**
   * A promotional bar above the header ("Need a partial cash withdrawal?").
   *
   * Not a consent banner and not modal — it sits in normal flow, so it
   * intercepts no clicks and the suite would pass with it left up. It is
   * dismissed anyway for page objects that click, because it mounts
   * client-side after hydration and pushes the header down when it arrives:
   * a click aimed at the pillar bar in the window between "header painted"
   * and "bar mounted" lands a row too high.
   *
   * NEVER DISMISS IT BEFORE A LINK SCAN. This is the trap that cost the most
   * to find on this site, and it is invisible when you fall into it.
   *
   *  - The bar contains a real link, and closing it removes that anchor from
   *    the DOM: 348 anchors become 347.
   *  - The dismissal is PERSISTED. Reload the page and the bar does not come
   *    back, so one dismissal blanks that link surface for every one of the
   *    six pages the scan visits, not just the page it happened on.
   *  - On the day this was written that link was `/servicing-withdrawals`,
   *    which is a live 404 on the site's own host — a promotional banner on
   *    every page pointing at a page that does not exist. So the exact link
   *    most worth catching is the one a tidy-up-the-chrome habit deletes
   *    before the scan can see it.
   *  - And it would have been deleted SILENTLY. A link that is never
   *    collected is not reported as broken; it is reported as nothing at
   *    all, and the run goes green.
   *
   * The first version of this suite got away with it by accident: the bar
   * mounts after hydration, this check does not wait for it, so the click
   * usually missed and the link usually survived. "Usually" is not a test
   * strategy. LinkScanPage now opts out via dismissesPromoBar.
   *
   * Best-effort by design: it is content, it is campaign-driven, and it will
   * not always be there. Nothing here fails the run.
   */
  protected async dismissPromoBar(): Promise<void> {
    if (!site.promoBar) return;
    const bar = this.page.locator(site.promoBar.container).first();
    if (!(await bar.isVisible().catch(() => false))) return;
    await bar
      .locator(site.promoBar.close)
      .first()
      .click({ timeout: 3000 })
      .catch(() => {
        console.info('[PROMO] notification bar present but its dismiss control did not respond');
      });
  }

  /**
   * Drop-off instrumentation: screenshot at each step, attached to the test
   * so it appears in the HTML report (and therefore on the S3 report site)
   * instead of dying on the CI runner's disk.
   *
   * Takes the page to shoot, because a step that opened a new tab must
   * capture the tab the customer is now looking at, not the one they left.
   */
  async checkpointReached(stepName: string, target: Page = this.page): Promise<void> {
    // Instrumentation must never fail the run it is instrumenting.
    //
    // A checkpoint records where the customer got to; it asserts nothing. On
    // a CI runner the capture can lose its race with the page — a step that
    // opens a new tab is navigating while the screenshot is taken, and
    // Chrome answers "Protocol error (Page.captureScreenshot): Unable to
    // capture screenshot". That failed a journey that had worked, and the
    // retry then passed, which is worse than either outcome: it turns a
    // green suite into a flaky one and trains people to re-run it.
    try {
      const screenshot = await target.screenshot({ fullPage: false });
      await test.info().attach(stepName, { body: screenshot, contentType: 'image/png' });
    } catch (error) {
      const detail = error instanceof Error ? error.message.split('\n')[0] : String(error);
      console.warn(`[JOURNEY] checkpoint "${stepName}" could not be captured: ${detail}`);
    }
    console.info(`[JOURNEY] checkpoint reached: ${stepName}`);
  }

  /**
   * Follow a link and return the page the journey continues on.
   *
   * This is not the one-liner it looks like. Links on this site do not all
   * behave the same way: the pillar bar routes in the same tab, while 21 of
   * the home page's anchors — the sibling Sanlam businesses, the country
   * sites and the social row — carry target="_blank" and open a NEW TAB.
   * Clicking one of those and then asserting on the original page silently
   * tests the page you were already on: the assertion waits out its full
   * timeout against a URL that was never going to change, and a journey that
   * actually works reports as broken.
   *
   * Both sibling frameworks paid for this lesson — Standard Bank on its
   * Wealth segment tab, Emirates NBD on every category link. Any link this
   * suite clicks goes through here.
   */
  protected async followLink(link: Locator, stepName: string): Promise<Page> {
    const opensNewTab = (await link.getAttribute('target')) === '_blank';

    if (!opensNewTab) {
      await link.click();
      await this.checkpointReached(stepName);
      return this.page;
    }

    const [popup] = await Promise.all([
      this.page.context().waitForEvent('page', { timeout: 45_000 }),
      link.click(),
    ]);
    await popup.waitForLoadState('domcontentloaded');
    console.info(`[JOURNEY] link opened in a new tab: ${popup.url()}`);
    await this.checkpointReached(stepName, popup);
    return popup;
  }

  /**
   * Dismiss whatever a freshly opened tab puts in front of the customer.
   * open() does this for a navigation; a popup never went through open().
   */
  async settle(): Promise<void> {
    await this.dismissConsentBanner();
    await this.dismissPromoBar();
  }

  /**
   * Deliberately toHaveURL and not waitForURL. waitForURL waits on the
   * navigation lifecycle, and these pages pull in enough third-party
   * tracking — Segment, MoEngage, TikTok, Meta, LinkedIn, Crazy Egg and GTM
   * all load on first paint — that "load" may never settle on a CI runner.
   * toHaveURL polls page.url(), which is what we actually mean by "we are on
   * this step".
   */
  async expectUrlContains(fragment: string | RegExp): Promise<void> {
    const pattern =
      typeof fragment === 'string'
        ? new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
        : fragment;
    await expect(this.page).toHaveURL(pattern, { timeout: 45_000 });
  }

  /**
   * True when a bot-protection response was served instead of the page.
   *
   * This is the single most consequential method in the suite, because on a
   * GitHub-hosted runner it returns TRUE for every test. Sanlam's CloudFront
   * WAF answers those runners with a 403 "Request blocked" page; a South
   * African address gets the real site. See SiteProfile.botBlockPattern for
   * the measurement.
   *
   * Skipping is correct: a WAF refusing a runner is not a defect in the site,
   * and without the skip the link checker would resolve every internal link
   * against a 403 and report the entire site as broken.
   *
   * What is NOT correct is letting a run in which everything skipped report
   * success, which is what Playwright's exit code does on its own. The
   * workflow fails the job when nothing ran — scripts/assert-suite-ran.mjs.
   */
  async isBotBlocked(): Promise<boolean> {
    if (site.botBlockUrlPattern?.test(this.page.url())) return true;
    if (!site.botBlockPattern) return false;
    return this.page
      .getByText(site.botBlockPattern)
      .first()
      .isVisible()
      .catch(() => false);
  }

  /**
   * Scroll the full height of the page so lazy-loaded sections mount and
   * their content enters the DOM. Without this a check silently covers only
   * the part of the page that happened to be above the fold.
   */
  protected async scrollThroughPage(): Promise<void> {
    await this.page.evaluate(async () => {
      const step = window.innerHeight;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      window.scrollTo(0, 0);
    });
    await this.page.waitForTimeout(1000);
  }

  /**
   * Wait until the anchor count stops growing, then return it.
   *
   * This is the group's oldest rule applied to a link scan: never believe a
   * count you did not wait for. Vodacom's suite reported "the funnel dies at
   * the plan step" for days because it counted cards the moment a heading
   * appeared, which raced the fetch that filled them — it passed next to the
   * origin and failed from a distant CI runner, which reads like a
   * geographic defect and was really just latency.
   *
   * The same shape is available here in a nastier form, because a link scan
   * that runs early does not fail loudly — it collects a SMALLER set and
   * every link in it resolves, so the run goes green while the baseline diff
   * quietly reports the rest of the page as missing journeys.
   *
   * Sanlam Online is a Next.js static export, so most anchors are in the
   * served HTML and this usually settles on the first sample. "Usually" is
   * the reason to check rather than the reason to skip: hydration can still
   * add to the tree, and the cost of being sure is two polls.
   */
  protected async waitForStableLinkCount(timeout = 15_000): Promise<number> {
    const POLL_MS = 500;
    const STABLE_SAMPLES = 3; // unchanged this many times in a row = settled
    const deadline = Date.now() + timeout;

    let last = -1;
    let stable = 0;

    for (;;) {
      const count = await this.page.locator('a[href]').count().catch(() => 0);
      stable = count === last && count > 0 ? stable + 1 : 0;
      last = count;
      if (stable >= STABLE_SAMPLES) return count;

      if (Date.now() >= deadline) {
        // A deadline is not a failure here — it means the page is still
        // adding anchors, which is worth saying out loud in the log rather
        // than silently scanning a moving target.
        console.warn(
          `[LINKS] anchor count never settled within ${timeout}ms (last: ${count}) — `
            + 'scanning anyway; treat a baseline diff on this run with suspicion',
        );
        return count;
      }
      await this.page.waitForTimeout(POLL_MS);
    }
  }
}
