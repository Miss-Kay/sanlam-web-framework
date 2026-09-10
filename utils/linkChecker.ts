import { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { site } from '../fixtures/siteProfile';

/**
 * LINK INTEGRITY CHECKER
 * ----------------------
 * Collects every anchor on a page and resolves each one over HTTP, so a
 * link that has quietly rotted is caught before a customer clicks it.
 *
 * The classification below is the important part. A link check that simply
 * fails on "not 200" is useless against a site like this one: Sanlam Online
 * links out to two dozen hosts it does not control — sibling Sanlam
 * businesses across seven countries, plus Google, YouTube, X, Facebook,
 * LinkedIn, Instagram and TikTok — and several of those answer an automated
 * request with 403 while serving a human perfectly. We therefore only fail
 * on links we can PROVE are broken, and report the rest as unverified.
 */

export type LinkVerdict = 'ok' | 'broken' | 'blocked' | 'unreachable' | 'skipped';

export interface PageLink {
  /** The raw href attribute as authored. */
  href: string;
  /** Resolved absolute URL (fragment included — this is what gets fetched). */
  url: string;
  /**
   * Stable identity: origin + path + query, with the fragment dropped. Two
   * anchors to /page#a and /page#b are one link. This is what the baseline
   * snapshot is keyed on, so a changed #section can't churn the snapshot.
   */
  key: string;
  /** Visible link text (first occurrence), for the report. */
  text: string;
  /** Number of times this URL appears across the pages it was found on. */
  occurrences: number;
  /** True when the URL is on the same host as the page under test. */
  internal: boolean;
  /**
   * Labels of the scanned pages this link was found on.
   *
   * The suite scans six pages that share a header and footer, and resolves
   * the union of their links exactly once. Without this the report can say a
   * link is broken but not where a customer would meet it, which is the
   * first thing anyone asks. A link on all six is in the shared nav; a link
   * on one is body content.
   */
  pages: string[];
}

export interface LinkResult extends PageLink {
  verdict: LinkVerdict;
  status?: number;
  /** Final URL after redirects, when it differs from the requested one. */
  redirectedTo?: string;
  detail?: string;
}

/** Schemes that are not fetchable and are reported as skipped, not broken. */
const NON_HTTP_SCHEME = /^(mailto|tel|javascript|sms|whatsapp|data|blob):/i;

/**
 * Collect every anchor on the page, resolved to absolute URLs and deduped.
 * In-page anchors ("#main") and non-HTTP schemes are dropped here — they
 * are not link rot, and fetching them is meaningless.
 *
 * Deduping is not a nicety on this site. The header mega-menu is rendered
 * TWICE into every page — once for the desktop bar and once for the mobile
 * drawer, both present in the DOM at all times with one copy at zero height
 * — so a raw anchor count roughly doubles the number of real destinations.
 * The home page carries 348 anchors resolving to about 130 unique URLs.
 */
export async function collectLinks(page: Page, pageLabel: string): Promise<PageLink[]> {
  const raw = await page.$$eval('a[href]', anchors =>
    anchors.map(a => ({
      href: a.getAttribute('href') ?? '',
      url: (a as HTMLAnchorElement).href,
      text: (a.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
    })),
  );

  const pageHost = new URL(page.url()).host;
  const byUrl = new Map<string, PageLink>();

  for (const link of raw) {
    const href = link.href.trim();
    if (!href || href.startsWith('#') || NON_HTTP_SCHEME.test(href)) continue;

    let parsed: URL;
    try {
      parsed = new URL(link.url);
    } catch {
      continue; // unparseable href — reported by collectMalformedLinks below
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;

    // Never follow the identity provider. Every "Login" control on the site
    // lands on login.sanlamonline.co.za with a PKCE challenge in the query,
    // so a request there opens a real authorisation transaction against the
    // Azure AD B2C tenant and can only ever answer a sign-in page. The suite
    // is read-only; this is where that holds for hosts.
    if (site.excludedHosts.some(host => parsed.host === host || parsed.host.endsWith(`.${host}`))) {
      continue;
    }

    // ...and never follow the authenticated servicing area, which lives on
    // the SAME host as the marketing site. /servicing/dashboard sits next to
    // /personal/insurance, so excluding hosts alone would leave the
    // read-only guarantee with a hole in it. Every path matched here is also
    // Disallow-ed in the site's own robots.txt. See SiteProfile.excludedPaths.
    if (parsed.host === pageHost && site.excludedPaths.test(parsed.pathname)) continue;

    // Ignore the fragment when deduping: /page and /page#section are one URL.
    // Volatile parameters are dropped too — see SiteProfile.volatileQueryParams.
    const stableParams = new URLSearchParams(parsed.search);
    for (const param of site.volatileQueryParams) stableParams.delete(param);
    const stableSearch = stableParams.toString();

    // The SCHEME is not part of a link's identity. A site that authors the
    // same destination as http:// on one render and https:// on another
    // reports one journey lost and one gained on every run where the two
    // disagree, and it is one link. (An http:// self-link is a real defect
    // in its own right and is reported by collectHrefHygiene, not hidden
    // here.) The trailing slash is normalised for the same reason: this is a
    // Next.js static export, so /help and /help/ are the same document.
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    const key = `https://${parsed.host}${path}${stableSearch ? `?${stableSearch}` : ''}`;
    const existing = byUrl.get(key);
    if (existing) {
      existing.occurrences += 1;
      if (!existing.text && link.text) existing.text = link.text;
      continue;
    }
    byUrl.set(key, {
      href,
      url: parsed.toString(),
      key,
      text: link.text,
      occurrences: 1,
      internal: parsed.host === pageHost,
      pages: [pageLabel],
    });
  }

  return [...byUrl.values()];
}

/**
 * Union the link sets of several pages into one, so a link shared by all of
 * them is resolved once rather than once per page.
 *
 * Occurrences add up and page labels merge; the first non-empty link text
 * wins, because icon-only links (the social row in the footer) carry no text
 * on some pages and a label on others.
 */
export function mergeLinks(sets: PageLink[][]): PageLink[] {
  const merged = new Map<string, PageLink>();
  for (const set of sets) {
    for (const link of set) {
      const existing = merged.get(link.key);
      if (!existing) {
        merged.set(link.key, { ...link, pages: [...link.pages] });
        continue;
      }
      existing.occurrences += link.occurrences;
      if (!existing.text && link.text) existing.text = link.text;
      for (const label of link.pages) {
        if (!existing.pages.includes(label)) existing.pages.push(label);
      }
    }
  }
  return [...merged.values()];
}

/** Anchors whose href cannot be resolved to a URL at all — always a defect. */
export async function collectMalformedLinks(page: Page): Promise<string[]> {
  return page.$$eval('a[href]', anchors =>
    anchors
      .filter(a => {
        const href = (a.getAttribute('href') ?? '').trim();
        if (!href || href.startsWith('#')) return false;
        if (/^(mailto|tel|javascript|sms|whatsapp|data|blob):/i.test(href)) return false;
        try {
          new URL((a as HTMLAnchorElement).href);
          return false;
        } catch {
          return true;
        }
      })
      .map(a => `${(a.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 50)} → ${a.getAttribute('href')}`),
  );
}

/**
 * HREF HYGIENE — authored defects that a link check cannot see.
 *
 * These are reported, never failed, because the browser forgives them and
 * the customer is not affected today. They are how a CMS tells you it is
 * about to break something.
 *
 * Three classes, all found in the wild on this group's targets:
 *
 *  - PADDED: `href="     /personal/insurance"`. The DOM property trims it,
 *    so the link resolves and the check passes. What breaks is any selector
 *    written `a[href="/personal/insurance"]`, which silently matches
 *    nothing. Emirates NBD's entire main nav is authored this way.
 *
 *  - DOUBLED: an href with a second `http` inside it, e.g.
 *    `/shop/simonlyhttps://www.example.com/shop/simonly?x=1` — a CMS field
 *    that concatenated a path and an absolute URL. This one IS customer
 *    facing: it 404s. It is reported here as well as failing the link check
 *    so the report says what went wrong rather than just "404".
 *
 *  - INSECURE: the site linking to itself over http://. It resolves, via a
 *    redirect, and costs the customer one unencrypted request first.
 *
 * Sanlam Online's home page is clean on all three today. The check still
 * runs on every page in the scan set, because "clean today" is a fact with
 * a short shelf life and this is the cheapest possible way to keep it true.
 */
export interface HrefHygiene {
  padded: string[];
  doubled: string[];
  insecure: string[];
}

export async function collectHrefHygiene(page: Page): Promise<HrefHygiene> {
  return page.$$eval('a[href]', anchors => {
    const padded: string[] = [];
    const doubled: string[] = [];
    const insecure: string[] = [];
    const ownHost = location.host;
    for (const a of anchors) {
      const href = a.getAttribute('href') ?? '';
      if (!href) continue;
      const text = (a.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
      if (href !== href.trim()) padded.push(`${text || '(no text)'} → ${JSON.stringify(href)}`);
      if (/.+https?:\/\//i.test(href.trim())) doubled.push(`${text || '(no text)'} → ${href.trim()}`);
      try {
        const parsed = new URL((a as HTMLAnchorElement).href);
        if (parsed.protocol === 'http:' && parsed.host === ownHost) {
          insecure.push(`${text || '(no text)'} → ${parsed.href}`);
        }
      } catch {
        /* unparseable — reported by collectMalformedLinks */
      }
    }
    return { padded, doubled, insecure };
  });
}

/** A readable hygiene note, attached to the run so the report explains itself. */
export function formatHygiene(pageLabel: string, hygiene: HrefHygiene): string {
  const lines = [`# Href hygiene — ${pageLabel}`, ''];
  if (
    hygiene.padded.length === 0
    && hygiene.doubled.length === 0
    && hygiene.insecure.length === 0
  ) {
    lines.push('Every href on the page is cleanly authored.', '');
    return lines.join('\n');
  }
  if (hygiene.doubled.length > 0) {
    lines.push(
      `## Doubled URLs (${hygiene.doubled.length}) — these break for customers`,
      '',
      ...hygiene.doubled.map(entry => `- ${entry}`),
      '',
    );
  }
  if (hygiene.insecure.length > 0) {
    lines.push(
      `## Insecure scheme (${hygiene.insecure.length}) — the site linking to itself over http://`,
      '',
      'These resolve, because the host redirects to https. They still send the',
      'customer through one unencrypted request first, on a financial services',
      'site, and they are what makes a link set look like it changed when it',
      'has not.',
      '',
      ...hygiene.insecure.map(entry => `- ${entry}`),
      '',
    );
  }
  if (hygiene.padded.length > 0) {
    lines.push(
      `## Padded hrefs (${hygiene.padded.length}) — authored with stray whitespace`,
      '',
      'The browser trims these, so customers are unaffected. They break exact',
      'attribute selectors, so they are worth fixing before they cost a test run.',
      '',
      ...hygiene.padded.map(entry => `- ${entry}`),
      '',
    );
  }
  return lines.join('\n');
}

export interface CheckOptions {
  /** Parallel requests. Kept modest so the check isn't mistaken for an attack. */
  concurrency?: number;
  /** Per-request timeout in ms. */
  timeout?: number;
}

/** Resolve every link over HTTP, a few at a time. See checkOne() for the rules. */
export async function checkLinks(
  request: APIRequestContext,
  links: PageLink[],
  options: CheckOptions = {},
): Promise<LinkResult[]> {
  const concurrency = options.concurrency ?? 6;
  const timeout = options.timeout ?? 25_000;
  const results: LinkResult[] = new Array(links.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < links.length) {
      const index = cursor++;
      results[index] = await checkOne(request, links[index], timeout);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, links.length) }, worker));
  return results;
}

/**
 * Resolve one link.
 *
 * Two rules earned by running this against real pages:
 *
 * 1. HEAD and GET disagree. Several hosts answer one and refuse the other —
 *    facebook.com returns 200 to a bare request and 400 to a browser-shaped
 *    one, purely as bot handling. So we try both and take the BEST answer:
 *    if either resolves, the link is not broken.
 *
 * 2. Only 404/410 is unambiguous. "Not found" and "gone" mean the link is
 *    dead no matter who asks. Every other 4xx from a third-party host
 *    (400/401/403/405/429/451) is that host deciding it does not serve
 *    robots — a fact about the checker, not about the link — so it is
 *    reported as unverified rather than failed. Anything on Sanlam's own
 *    host is held to the strict standard: they control it, so any error
 *    there is a real defect.
 */
async function checkOne(
  request: APIRequestContext,
  link: PageLink,
  timeout: number,
): Promise<LinkResult> {
  const attempt = async (method: 'HEAD' | 'GET') => {
    const response = await request.fetch(link.url, {
      method,
      timeout,
      maxRedirects: 10,
      failOnStatusCode: false,
      headers: { accept: 'text/html,application/xhtml+xml,*/*' },
    });
    return {
      status: response.status(),
      finalUrl: response.url(),
    };
  };

  let best: { status: number; finalUrl: string } | undefined;
  let networkError: string | undefined;

  for (const method of ['HEAD', 'GET'] as const) {
    try {
      const outcome = await attempt(method);
      if (!best || outcome.status < best.status) best = outcome;
      if (outcome.status < 400) break; // resolved — no need to try the other verb
    } catch (error) {
      networkError = error instanceof Error ? error.message.split('\n')[0] : String(error);
    }
  }

  if (!best) {
    return { ...link, verdict: 'unreachable', detail: networkError ?? 'no response' };
  }

  const { status, finalUrl } = best;
  const redirectedTo = finalUrl !== link.url ? finalUrl : undefined;

  if (status < 400) return { ...link, verdict: 'ok', status, redirectedTo };

  // Definitively dead, whoever is asking.
  if (status === 404 || status === 410) {
    return { ...link, verdict: 'broken', status, redirectedTo };
  }

  // Sanlam's own host is held to the strict standard.
  if (link.internal) return { ...link, verdict: 'broken', status, redirectedTo };

  return {
    ...link,
    verdict: 'blocked',
    status,
    redirectedTo,
    detail: 'third-party host refused an automated request — not verified',
  };
}

/**
 * SECOND PASS — re-check "blocked" links in a real browser.
 *
 * A host that refuses Playwright's request context often serves a browser
 * perfectly. Leaving those unverified would mean the suite quietly checks
 * nothing for them, so we open each in a real page and use what the browser
 * actually got.
 *
 * A browser 404/410 here is conclusive — the link really is dead.
 */
export async function verifyBlockedInBrowser(
  context: BrowserContext,
  results: LinkResult[],
  options: { timeout?: number; max?: number } = {},
): Promise<LinkResult[]> {
  const timeout = options.timeout ?? 30_000;
  const max = options.max ?? 20;
  const blocked = results.filter(result => result.verdict === 'blocked').slice(0, max);
  if (blocked.length === 0) return results;

  const verified = new Map<string, LinkResult>();

  for (const link of blocked) {
    const page = await context.newPage();
    try {
      const response = await page.goto(link.url, {
        waitUntil: 'domcontentloaded',
        timeout,
      });
      const status = response?.status();

      if (status !== undefined && status < 400) {
        verified.set(link.url, {
          ...link,
          verdict: 'ok',
          status,
          detail: `refused an API request (${link.status}) but renders in a browser`,
        });
      } else if (status === 404 || status === 410) {
        verified.set(link.url, {
          ...link,
          verdict: 'broken',
          status,
          detail: 'confirmed dead in a real browser',
        });
      } else if (status !== undefined) {
        verified.set(link.url, { ...link, status, detail: `browser also got ${status}` });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message.split('\n')[0] : String(error);
      verified.set(link.url, { ...link, detail: `browser check failed: ${detail}` });
    } finally {
      await page.close();
    }
  }

  return results.map(result => verified.get(result.url) ?? result);
}

/** Group results by verdict, for assertions and reporting. */
export function groupByVerdict(results: LinkResult[]): Record<LinkVerdict, LinkResult[]> {
  const grouped: Record<LinkVerdict, LinkResult[]> = {
    ok: [],
    broken: [],
    blocked: [],
    unreachable: [],
    skipped: [],
  };
  for (const result of results) grouped[result.verdict].push(result);
  return grouped;
}

/** A readable report, attached to the test so it lands in the HTML report. */
export function formatReport(scope: string, results: LinkResult[]): string {
  const grouped = groupByVerdict(results);
  const browserVerified = grouped.ok.filter(r => r.detail?.includes('renders in a browser')).length;
  const lines: string[] = [
    `# Link integrity — ${scope}`,
    '',
    `Checked ${results.length} unique links `
      + `(${results.filter(r => r.internal).length} internal, `
      + `${results.filter(r => !r.internal).length} external)`,
    '',
    `- OK: ${grouped.ok.length}` + (browserVerified ? ` (${browserVerified} verified in a browser after an API refusal)` : ''),
    `- BROKEN: ${grouped.broken.length}`,
    `- UNREACHABLE: ${grouped.unreachable.length}`,
    `- BLOCKED (bot protection, not verified): ${grouped.blocked.length}`,
    '',
  ];

  const section = (title: string, items: LinkResult[]) => {
    if (items.length === 0) return;
    lines.push(`## ${title}`, '');
    for (const item of items) {
      const status = item.status ? `HTTP ${item.status}` : (item.detail ?? 'no response');
      lines.push(
        `- [${status}] "${item.text || '(no text)'}" → ${item.url}`
          + ` — on ${item.pages.join(', ')}`
          + `${item.occurrences > 1 ? ` (×${item.occurrences})` : ''}`
          + `${item.detail && item.status ? ` — ${item.detail}` : ''}`,
      );
    }
    lines.push('');
  };

  section('Broken', grouped.broken);
  section('Unreachable', grouped.unreachable);
  section('Blocked — could not verify', grouped.blocked);
  section('OK', grouped.ok);

  return lines.join('\n');
}
