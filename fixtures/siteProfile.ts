/**
 * SITE PROFILE — every site-specific value lives in this one object.
 *
 * Adopting the framework for another site means writing a new profile plus
 * page objects for that site's navigation; nothing in utils/ references
 * Sanlam directly.
 */

/**
 * Build a selector for a BUILD-HASHED class name.
 *
 * This is the single most important thing to know about automating this
 * site, so it sits at the top of the profile rather than buried in a page
 * object.
 *
 * Sanlam Online is a Next.js app whose styles are compiled to CSS modules,
 * so every class in the markup carries a build hash:
 *
 *     <nav class="sd-header-site-31e5M9p1fn sd-header-site--small-31e5jdbO0e">
 *     <h6  class="sd-typography-31e5_j7j1D sd-typography--h6-31e5f1Ql78">
 *
 * The `31e5…` suffix is generated at build time. It is stable for as long as
 * a given deployment is live and changes the next time the site ships — so a
 * selector written `.sd-header-site-31e5M9p1fn` passes every run until a
 * deploy, then matches nothing, and the suite reports the header as missing
 * on a site that is perfectly healthy. That failure looks exactly like a real
 * regression and is the most expensive kind of false alarm.
 *
 * So never write the full class. Match the stable PREFIX instead:
 *
 *     cls('sd-header-site')  →  [class*="sd-header-site"]
 *
 * Two further wrinkles, both observed on the live home page:
 *
 *  - There is more than one hash namespace. The header hashes to `31e5…`
 *    while the button library hashes to `91a4…` (`sd-button-91a4NVsQ9v`),
 *    so the hash is per-bundle and cannot be pinned globally either.
 *  - Some components are styled-components rather than CSS modules, and
 *    those class names are pure entropy with no readable prefix at all
 *    (`sc-gsTDHW cReWEw`). Nothing can be keyed on those, so the page
 *    objects reach for a role, an aria-label or authored text instead.
 *
 * Prefix matching is why the locator chains in pages/ read the way they do.
 */
export function cls(prefix: string): string {
  return `[class*="${prefix}"]`;
}

export interface SiteProfile {
  /** Human name — used in logs, reports, and test titles. */
  name: string;
  /** Default base URL; the BASE_URL env var overrides it. */
  baseUrl: string;
  /** Entry path the scan launches from. */
  entryPath: string;
  /** Browser locale for the test context. */
  locale: string;
  /**
   * Query parameters that change between page loads without changing the
   * destination. Dropped when a link's identity is computed, so a rotating
   * campaign tag cannot churn the baseline snapshot.
   */
  volatileQueryParams: string[];
  /**
   * Hosts a link check must never follow, whatever a page links to.
   *
   * login.sanlamonline.co.za is Azure AD B2C. Every "Login" control on the
   * site lands there, and fetching it is worse than pointless: the URL
   * carries a PKCE challenge and a redirect_uri, so a request opens a real
   * authorisation transaction against the tenant and can only ever answer a
   * sign-in page. The suite is read-only — see the README — and this list is
   * where that guarantee is enforced for hosts.
   */
  excludedHosts: string[];
  /**
   * Paths on the site's OWN host that a link check must never follow.
   *
   * This is the piece the sibling frameworks do not have, and it exists
   * because Sanlam is shaped differently from them. Emirates NBD puts its
   * authenticated banking behind a separate host, so excluding a host was
   * enough. Sanlam serves its authenticated servicing area from the SAME
   * host as the marketing site — /servicing/dashboard sits alongside
   * /personal/insurance — so a host-level exclusion would not catch it and
   * the read-only guarantee would quietly have a hole in it.
   *
   * Every entry here is also disallowed in the site's own robots.txt:
   *
   *     Disallow: /logout/
   *     Disallow: /reset-password
   *     Disallow: /auth/
   *     Disallow: /servicing/
   *     Disallow: /_next/
   *
   * which is the site telling automated clients exactly this. /_next/ is the
   * build-asset directory — not a customer journey, and not something a link
   * report should carry noise about.
   */
  excludedPaths: RegExp;
  /**
   * Header hooks. Every one is a hashed-class PREFIX — see cls() above for
   * why writing the full class name would break on the next deploy.
   */
  header: {
    /** Top utility bar: Personal / Business / Corporate, and the country picker. */
    utilityNav: string;
    /** The product pillar bar: Insure / Retire / Invest / Plan / Credit / … */
    pillarNav: string;
    /** The drawer the hamburger opens — a separate tree, not a restyle. */
    mobileNav: string;
    /**
     * The hamburger itself.
     *
     * It is a `<label>`, not a button — see HeaderNav.openMobileMenu() for
     * what that costs — so it cannot be found by role, and a class prefix is
     * the only handle it offers.
     */
    mobileMenuToggle: string;
  };
  /** The content region below the header — everything the customer reads. */
  contentRoot: string;
  /**
   * The consent banner, when the site serves one.
   *
   * Sanlam Online serves NONE. That is not an oversight in this profile — it
   * was checked: the page sets analytics cookies (_ga, _fbp, _ttp, moe_uuid)
   * and loads Segment, MoEngage, TikTok and Meta tags on first paint with no
   * banner in the DOM, no shadow root anywhere on the page, and nothing
   * cookie- or consent-named to dismiss.
   *
   * It is left `undefined` rather than deleted from the interface for two
   * reasons. It documents that the absence is a finding rather than a gap —
   * every sibling framework in this group carries a hard-won comment about
   * its vendor's banner, and "this one has no banner" is worth recording in
   * the same place. And it keeps BasePage's handler shared with those
   * frameworks, so a banner appearing here later is a one-line profile
   * change rather than a page-object change.
   */
  consentBanner?: string;
  /**
   * A dismissible promotional bar above the header. Not a consent banner and
   * not modal — it sits in normal flow — but it is the one piece of chrome
   * on this site that can be closed, and it shifts the header down while it
   * is up.
   */
  promoBar?: { container: string; close: string };
  /**
   * Signatures of a bot-protection interstitial — the URL it redirects to,
   * and text unique to the page. When a request is served one of these the
   * test skips rather than false-failing.
   *
   * Sanlam Online is a static export on S3 behind CloudFront with no bot
   * manager in front of it, and a datacenter IP is served the real page — so
   * unlike the Emirates NBD suite this is not expected to fire. It is kept
   * because CloudFront can have a WAF attached without warning, and the cost
   * of the check is one regex against a URL.
   */
  botBlockUrlPattern?: RegExp;
  botBlockPattern?: RegExp;
}

/**
 * Sanlam Online — South Africa. The public marketing site: a Next.js static
 * export on S3/CloudFront that serves an automated browser normally.
 *
 * robots.txt disallows the authenticated servicing area and the build-asset
 * directory only, so the pages this suite reads are ones the site invites
 * crawlers into. See excludedPaths.
 *
 * The suite is read-only: it never signs in, never enters personal data, and
 * never submits a quote or an application.
 */
export const sanlamOnlineZA: SiteProfile = {
  name: 'Sanlam Online',
  baseUrl: 'https://www.sanlamonline.co.za',
  entryPath: '/',
  locale: 'en-ZA',
  volatileQueryParams: [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'gclid', 'fbclid', 'ttclid', 'msclkid', 'icid', 'cid',
  ],
  excludedHosts: ['login.sanlamonline.co.za'],
  excludedPaths: /^\/(auth|servicing|logout|reset-password|_next)(\/|$)/i,
  header: {
    utilityNav: cls('sd-header-main'),
    pillarNav: cls('sd-header-site'),
    mobileNav: cls('sd-mobile-menu'),
    mobileMenuToggle: cls('sd-header-site-mobile__menu-toggle__menu-icon'),
  },
  contentRoot: 'main',
  // No banner is served — see SiteProfile.consentBanner.
  consentBanner: undefined,
  promoBar: {
    container: cls('sd-notification-bar'),
    // aria-label, not a class: the dismiss control's own class carries the
    // build hash like everything else, but its label is authored content and
    // survives a rebuild.
    close: 'button[aria-label="Dismiss notification"]',
  },
  botBlockUrlPattern: /\/cdn-cgi\/|challenges\.cloudflare\.com/i,
  botBlockPattern: /attention required|checking your browser|verify you are human|request blocked/i,
};

/** The profile the suite runs against. */
export const site: SiteProfile = sanlamOnlineZA;
