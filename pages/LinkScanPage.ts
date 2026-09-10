import { BrowserContext, expect, test } from '@playwright/test';
import { BasePage } from './BasePage';
import { site } from '../fixtures/siteProfile';
import {
  LinkResult,
  PageLink,
  checkLinks,
  collectHrefHygiene,
  collectLinks,
  collectMalformedLinks,
  formatHygiene,
  verifyBlockedInBrowser,
} from '../utils/linkChecker';
import {
  BaselineDiff,
  baselineExists,
  diffAgainstBaseline,
  formatDiff,
  isUpdateRun,
  loadBaseline,
  saveBaseline,
  toBaseline,
} from '../utils/linkBaseline';

/**
 * Any page whose links are being checked. Deliberately not tied to one URL:
 * the same object scans the home page, a pillar page or the help centre
 * without change — which is what lets the spec drive it from a table.
 */
export class LinkScanPage extends BasePage {
  /**
   * A link scan never closes the promotional bar.
   *
   * Closing it deletes an anchor from the page and the dismissal sticks
   * across reloads, so it would blank that link surface for the whole scan —
   * and the link it removes is currently a live 404. The bar is not modal
   * and this object clicks nothing, so there is nothing to gain by tidying
   * it away. The full story is in BasePage.dismissPromoBar().
   */
  protected get dismissesPromoBar(): boolean {
    return false;
  }

  /**
   * Every anchor on the page, deduped and resolved to absolute URLs.
   *
   * `label` is the human name of the page from the scan table. It rides
   * along on every link so the report can say WHERE a broken link appears,
   * which is the first thing anyone asks when six pages are scanned at once.
   */
  async links(label: string): Promise<PageLink[]> {
    // Sections mount as they scroll into view, so links below the fold are
    // not in the DOM until the page has been scrolled.
    await this.scrollThroughPage();
    // ...and hydration can still be adding to the tree. See BasePage.
    const anchors = await this.waitForStableLinkCount();
    const links = await collectLinks(this.page, label);
    console.info(`[LINKS] ${label}: ${anchors} anchors → ${links.length} unique links`);
    return links;
  }

  /** Anchors whose href cannot be resolved to a URL at all — always a defect. */
  async malformedLinks(): Promise<string[]> {
    return collectMalformedLinks(this.page);
  }

  /**
   * Authored href defects that resolve anyway. Attached to the run and
   * reported, never failed — see collectHrefHygiene for why.
   */
  async reportHrefHygiene(label: string): Promise<{ padded: number; doubled: number; insecure: number }> {
    const hygiene = await collectHrefHygiene(this.page);
    await test.info().attach(`href-hygiene-${slug(label)}.md`, {
      body: formatHygiene(label, hygiene),
      contentType: 'text/markdown',
    });
    if (hygiene.padded.length > 0) {
      console.info(`[LINKS] ${label}: ${hygiene.padded.length} href(s) authored with stray whitespace`);
    }
    if (hygiene.doubled.length > 0) {
      console.warn(`[LINKS] ${label}: ${hygiene.doubled.length} href(s) contain a doubled URL`);
    }
    if (hygiene.insecure.length > 0) {
      console.warn(`[LINKS] ${label}: ${hygiene.insecure.length} href(s) link to this site over http://`);
    }
    return {
      padded: hygiene.padded.length,
      doubled: hygiene.doubled.length,
      insecure: hygiene.insecure.length,
    };
  }

  /**
   * Resolve every link, then re-check in a real browser any that a
   * third-party host refused. See utils/linkChecker.ts for the rules.
   */
  async checkAllLinks(context: BrowserContext, links: PageLink[]): Promise<LinkResult[]> {
    const apiResults = await checkLinks(this.page.request, links);
    const blocked = apiResults.filter(result => result.verdict === 'blocked').length;
    if (blocked > 0) {
      console.info(`[LINKS] re-checking ${blocked} refused link(s) in a real browser`);
    }
    return verifyBlockedInBrowser(context, apiResults);
  }

  /**
   * Diff this page's collected links against its committed snapshot.
   *
   * Returns an empty diff on an update run, having rewritten the snapshot.
   */
  async compareToBaseline(
    label: string,
    baselinePath: string,
    links: PageLink[],
  ): Promise<BaselineDiff> {
    if (isUpdateRun()) {
      saveBaseline(baselinePath, toBaseline(this.page.url(), links));
      console.info(`[BASELINE] ${label}: snapshot rewritten with ${links.length} links`);
      return { missing: [], added: [] };
    }

    if (!baselineExists(baselinePath)) {
      test.skip(true, `No link baseline captured for ${label} yet. Run: npm run baseline:update`);
      return { missing: [], added: [] };
    }

    const baseline = loadBaseline(baselinePath);
    const diff = diffAgainstBaseline(baseline, links);

    await test.info().attach(`link-baseline-${slug(label)}.md`, {
      body: formatDiff(baseline, diff, links.length),
      contentType: 'text/markdown',
    });

    // Both directions go to the console, not only the attachment. A CI run
    // publishes its attachments to the HTML report, but the report artifact
    // does not always carry them and the Actions log elides attachment
    // bodies — so a drift that only exists in an attachment is a drift you
    // cannot diagnose without re-running. The console survives both.
    for (const link of diff.missing) {
      console.info(`[BASELINE] ${label}: MISSING "${link.text || '(no text)'}" → ${link.key}`);
    }
    for (const link of diff.added) {
      console.info(`[BASELINE] ${label}: ADDED   "${link.text || '(no text)'}" → ${link.key}`);
    }
    console.info(
      `[BASELINE] ${label}: ${baseline.linkCount} at baseline, ${links.length} now `
        + `(missing=${diff.missing.length} added=${diff.added.length})`,
    );

    return diff;
  }

  /** The page rendered at all — a blank shell has no links to be missing. */
  async assertLoaded(): Promise<void> {
    await expect(this.page.locator(site.contentRoot).first()).toBeVisible({ timeout: 30_000 });
  }
}

/** Attachment names have to survive being written to a filesystem. */
function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
