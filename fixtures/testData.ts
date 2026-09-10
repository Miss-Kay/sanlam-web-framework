/** Typed test data — single source of truth, easy to extend to data-driven runs. */

export interface ScanTarget {
  /** Human label, used in step titles and the report. */
  label: string;
  /** Path to scan, relative to the site profile's base URL. */
  path: string;
  /** Committed link snapshot for this page, a filename inside fixtures/. */
  baseline: string;
  /**
   * Floor for "the page rendered at all".
   *
   * Deliberately loose. This is not an assertion about the page's content —
   * the baseline snapshot is what holds that precisely. It exists only to
   * catch the case where the scan ran against an error page or an unhydrated
   * shell, which would otherwise report every link on the page as missing
   * and read like a catastrophic regression.
   */
  minLinks: number;
}

/**
 * The pages the link check covers.
 *
 * These are the six entry points a personal customer actually starts from:
 * the home page plus every pillar in the header bar that is a real link.
 * Together they are the whole top of the funnel.
 *
 * They share a header and footer, so their link sets overlap heavily — the
 * mega-menu alone is over 250 anchors and is rendered into every page. The
 * spec therefore collects per page but resolves the UNION once, so a link in
 * the shared nav is fetched a single time no matter how many pages carry it.
 * Checking per page instead would multiply every third-party request by six
 * and make a link check look like a small denial-of-service attempt.
 */
export const scanTargets: ScanTarget[] = [
  { label: 'Home',    path: '/',                          baseline: 'home-links.baseline.json',    minLinks: 80 },
  { label: 'Insure',  path: '/personal/insurance',        baseline: 'insure-links.baseline.json',  minLinks: 60 },
  { label: 'Retire',  path: '/personal/retirement',       baseline: 'retire-links.baseline.json',  minLinks: 60 },
  { label: 'Plan',    path: '/financialplanning',         baseline: 'plan-links.baseline.json',    minLinks: 60 },
  { label: 'Credit',  path: '/personal/credit-solutions', baseline: 'credit-links.baseline.json',  minLinks: 60 },
  { label: 'Help',    path: '/help',                      baseline: 'help-links.baseline.json',    minLinks: 60 },
];

/**
 * The product pillars in the header bar, as a customer reads them.
 *
 * `href` is null for a pillar that is NOT a link. That is not a gap in this
 * table — it is the finding the nav-reachability spec exists to pin down.
 *
 * Insure, Retire, Plan, Credit and Help are anchors with real destinations.
 * Invest, Wealth and Rewards are not. Each is a bare `<h6>`:
 *
 *     <div class="sd-header-item__title-container-…" tabindex="0">
 *       <div class="sd-header-item__title-wrapper-…" tabindex="-1">
 *         <div class="sd-linker-… sd-header-item__title-…">
 *           <h6 class="sd-typography-…">Invest</h6>
 *
 * Be precise about what is wrong with that, because the obvious reading is
 * wrong. These pillars ARE focusable: the container carries tabindex="0", so
 * a keyboard user tabbing the header does land on them. What they cannot do
 * is open them. Measured on the live page: focus the container and press
 * Enter, then Space, and the number of visible links on the page does not
 * move (98 → 98 → 98); hover the same element with a real mouse and the
 * flyout mounts its category links (98 → 106).
 *
 * So the defect is "focusable but not operable", not "invisible to the
 * keyboard" — and there is no role on the focusable element either, so a
 * screen reader announces a tab stop that is neither link nor button. Three
 * of the eight pillars are reachable by pointer only.
 *
 * For automation the consequence is blunter: `getByRole('link', { name:
 * 'Invest' })` matches nothing at all.
 *
 * Their flyout children ARE anchors and are in the DOM at first paint, so
 * the link check still covers the destinations underneath them. What is lost
 * is the pillar itself.
 */
export const headerPillars: { label: string; href: string | null }[] = [
  { label: 'Insure',  href: '/personal/insurance' },
  { label: 'Retire',  href: '/personal/retirement' },
  { label: 'Invest',  href: null },
  { label: 'Plan',    href: '/financialplanning' },
  { label: 'Credit',  href: '/personal/credit-solutions' },
  { label: 'Wealth',  href: null },
  { label: 'Rewards', href: null },
  { label: 'Help',    href: '/help' },
];

/**
 * Known-broken links, quarantined so the suite still fails on NEW breakage.
 *
 * A permanently red pipeline hides the next regression, so a defect that is
 * already reported and still live is listed here with the date it was found
 * and re-reported in the run's attachments rather than failing it.
 *
 * Re-check them on demand with: npm run test:links
 */
export const knownBrokenLinks: { url: RegExp; found: string; note: string }[] = [
  {
    url: /sanlamonline\.co\.za\/servicing-withdrawals$/i,
    found: '2026-09-10',
    note:
      'The promotional bar above the header — "Need a partial cash withdrawal? '
      + 'Request it directly through Sanlam Online." — 404s. Confirmed outside '
      + 'Playwright with a plain browser-shaped request, so it is the page '
      + 'that is gone, not the checker being refused. '
      + 'Home page only: checked from three fresh browser contexts, the bar '
      + 'renders on / and on neither /help nor /personal/insurance, so this '
      + 'is not a once-per-session banner that the scan order hid. '
      + 'Two things make it easy to miss. It is injected client-side after '
      + 'hydration and is NOT in the served HTML, so an HTML-only crawler '
      + 'cannot see it at all. And closing the bar deletes the anchor and '
      + 'persists that across reloads — see BasePage.dismissPromoBar(). '
      + 'The href is authored RELATIVE with no leading slash — '
      + 'href="servicing-withdrawals" — so it only resolves to '
      + '/servicing-withdrawals because the bar happens to be on the root '
      + 'page. Put the same component on /personal/insurance and it would '
      + 'point at /personal/servicing-withdrawals instead: a second, '
      + 'different 404. Worth fixing as an absolute path even after the '
      + 'destination page exists.',
  },
  {
    url: /sanlamonline\.co\.za\/021%20916%201500$/i,
    found: '2026-09-10',
    note:
      'A phone number authored as a bare href — <a href="021 916 1500"> with '
      + 'no tel: scheme — so the browser resolves it as a site-relative path '
      + 'and it 404s. On /help and /help/contact-us. Clicking the switchboard '
      + 'number on the contact page lands the customer on an error page.',
  },
  {
    url: /sanlamonline\.co\.za\/0860%20726%20526$/i,
    found: '2026-09-10',
    note:
      'The same defect as the 021 number above, on the same two pages: '
      + '<a href="0860 726 526"> with no tel: scheme. Worth noting that the '
      + 'SAME number is authored correctly elsewhere on the page as a '
      + 'tel: link and as a wa.me link, so this is one component out of step '
      + 'rather than a site-wide convention.',
  },
];
