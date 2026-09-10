import { expect, test } from '@playwright/test';
import path from 'path';
import { LinkScanPage } from '../pages/LinkScanPage';
import { PageLink, formatReport, groupByVerdict, mergeLinks } from '../utils/linkChecker';
import { site } from '../fixtures/siteProfile';
import { knownBrokenLinks, scanTargets } from '../fixtures/testData';

const FIXTURES = path.join(__dirname, '..', 'fixtures');

/**
 * LINK INTEGRITY — Sanlam Online
 *
 * Walks the six pages a personal customer starts from (home, plus every
 * pillar in the header bar that is a real link), collects the links on each,
 * and resolves the UNION of them exactly once.
 *
 * The union matters. These pages share a header and footer, and the header
 * mega-menu alone is over 250 anchors rendered into every template — so
 * checking per page would fetch the same third-party host six times and make
 * a link check look like a small denial-of-service attempt. Collect six
 * times, resolve once.
 *
 * The run FAILS only on links proven broken. Third-party hosts that refuse
 * an automated request (403/429) are re-checked in a real browser and, if
 * they still refuse, reported as unverified rather than failed — see
 * utils/linkChecker.ts for why that distinction is the difference between a
 * useful suite and a permanently red one.
 *
 * Never fetched: the Azure AD B2C identity provider, and the authenticated
 * servicing area that shares this host. See SiteProfile.excludedHosts and
 * .excludedPaths.
 */
test.describe(`${site.name} — link integrity`, () => {
  test('every link across the primary pages resolves @links @smoke', async ({ page, context }) => {
    // Six page loads, each scrolled to mount its lazy sections, plus one
    // resolution pass over a few hundred URLs against two dozen hosts. The
    // 120s default is a per-page budget, not a per-suite one.
    test.setTimeout(15 * 60 * 1000);

    const scan = new LinkScanPage(page);
    const collected: PageLink[][] = [];
    const lostJourneys: string[] = [];

    for (const target of scanTargets) {
      await test.step(`Collect — ${target.label} (${target.path})`, async () => {
        await scan.open(target.path);

        test.skip(
          await scan.isBotBlocked(),
          `${site.name} served a bot interstitial to this runner IP — skipping (not a code failure)`,
        );
        await scan.assertLoaded();

        // An href that cannot be parsed into a URL is a defect on any page,
        // and it is soft so one bad anchor does not hide the other five
        // pages' findings.
        const malformed = await scan.malformedLinks();
        expect
          .soft(malformed, `${target.label}: anchors with unparseable hrefs`)
          .toEqual([]);

        // Reported, never failed: the browser forgives these. See
        // collectHrefHygiene.
        await scan.reportHrefHygiene(target.label);

        const links = await scan.links(target.label);
        expect(
          links.length,
          `${target.label}: only ${links.length} links collected — the page did not render`,
        ).toBeGreaterThan(target.minLinks);
        collected.push(links);

        // Resolving every link proves nothing is broken; it cannot prove
        // nothing has gone MISSING. A page that loses half its navigation
        // still passes a pure link check, because everything left over
        // resolves perfectly. New links are reported, never failed.
        const diff = await scan.compareToBaseline(
          target.label,
          path.join(FIXTURES, target.baseline),
          links,
        );
        for (const link of diff.missing) {
          lostJourneys.push(`${target.label}: "${link.text || '(no text)'}" → ${link.key}`);
        }
      });
    }

    const links = mergeLinks(collected);

    await test.step(`Resolve — ${links.length} unique links across ${scanTargets.length} pages`, async () => {
      const results = await scan.checkAllLinks(context, links);
      const grouped = groupByVerdict(results);

      await test.info().attach('link-integrity-report.md', {
        body: formatReport(`${site.name} — ${scanTargets.map(t => t.label).join(', ')}`, results),
        contentType: 'text/markdown',
      });

      // Unreachable internal links are broken links: Sanlam controls that
      // host, so a DNS/TLS/timeout failure there is a real defect.
      const internalUnreachable = grouped.unreachable.filter(result => result.internal);
      const failures = [...grouped.broken, ...internalUnreachable];

      const known = failures.filter(result => knownBrokenLinks.some(k => k.url.test(result.url)));
      const fresh = failures.filter(result => !knownBrokenLinks.some(k => k.url.test(result.url)));

      if (known.length > 0) {
        await test.info().attach('known-broken-links.md', {
          body:
            '# Known broken links still live\n\n'
            + known
              .map(result => {
                const entry = knownBrokenLinks.find(k => k.url.test(result.url));
                return `- ${result.url} (found ${entry?.found}) — ${entry?.note}`;
              })
              .join('\n')
            + '\n',
          contentType: 'text/markdown',
        });
      }

      console.info(
        `[LINKS] ok=${grouped.ok.length} broken=${grouped.broken.length} `
          + `unreachable=${grouped.unreachable.length} blocked=${grouped.blocked.length}`,
      );
      for (const result of fresh) {
        console.warn(
          `[LINKS] BROKEN ${result.status ?? result.detail} "${result.text}" → ${result.url} `
            + `(on ${result.pages.join(', ')})`,
        );
      }

      expect
        .soft(
          fresh,
          `${fresh.length} NEW broken link(s):\n`
            + fresh
              .map(r => `  - ${r.status ?? r.detail} ${r.url} (on ${r.pages.join(', ')})`)
              .join('\n'),
        )
        .toHaveLength(0);
    });

    await test.step('No journey has gone missing since the baseline', async () => {
      expect
        .soft(
          lostJourneys,
          `${lostJourneys.length} link(s) present at baseline are gone — `
            + 'those journeys can no longer be reached from the page they were on:\n'
            + lostJourneys.map(entry => `  - ${entry}`).join('\n'),
        )
        .toHaveLength(0);
    });
  });
});
