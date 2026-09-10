import { Page, Locator } from '@playwright/test';

/**
 * SELF-HEALING LOCATOR
 * --------------------
 * Instead of one brittle selector, each element is defined by an ordered
 * chain of strategies (most stable first). If the primary selector breaks
 * after a UI change, the next candidate is tried automatically, and the
 * "heal" is logged so you know which selectors need updating.
 *
 * Keep it simple: no AI, no external service — just ordered fallbacks.
 */
/**
 * Poll a locator's matches for the first VISIBLE one.
 *
 * Exported because it is not a self-healing concern — it is the answer to a
 * problem this shop creates everywhere. Vodacom's storefront renders every
 * step of a flow, and every modal, into one document, so a search for
 * "Get this deal" or "Data & voice minutes" routinely matches several nodes
 * of which only one is on screen. Asserting on `.first()` then asserts on
 * whichever copy happens to come first in DOM order, which is usually a
 * hidden one, and the assertion fails on a page that is working correctly.
 *
 * The match cap is a safety valve, not a tuning knob: a loose locator can
 * match hundreds of nodes and visibility costs a round-trip each, so
 * capping keeps a bad selector cheap to fail.
 */
export async function firstVisible(
  page: Page,
  locator: Locator,
  timeout = 3000,
): Promise<Locator | null> {
  const MAX_MATCHES = 20;
  const POLL_MS = 250;
  const deadline = Date.now() + timeout;

  do {
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < Math.min(count, MAX_MATCHES); index += 1) {
      const match = locator.nth(index);
      if (await match.isVisible().catch(() => false)) return match;
    }
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(POLL_MS);
  } while (Date.now() < deadline);

  return null;
}

/**
 * Poll a locator's matches for the first one actually INSIDE the viewport.
 *
 * A sibling of firstVisible(), and necessary for the same reason taken one
 * step further. `isVisible()` asks whether an element has a non-empty box and
 * is not hidden by CSS — it does not ask whether the customer can see it.
 * Sanlam's mobile drawer is moved off-screen with a transform rather than
 * unmounted, and its sub-panels are stacked off to the side the same way, so
 * every row in it reports as visible at all times, open or closed. A closed
 * drawer therefore satisfies isVisible() completely.
 *
 * Position is the only honest signal there, and the drawer holds several
 * copies of each label (one per panel), so "the first match" and "the match
 * on screen" are routinely different elements.
 *
 * Worth porting to the sibling frameworks: any nav built as an off-canvas
 * drawer has this shape.
 */
export async function firstInViewport(
  page: Page,
  locator: Locator,
  timeout = 5000,
): Promise<Locator | null> {
  const MAX_MATCHES = 30;
  const POLL_MS = 250;
  const deadline = Date.now() + timeout;

  do {
    const viewport = page.viewportSize();
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < Math.min(count, MAX_MATCHES); index += 1) {
      const match = locator.nth(index);
      const box = await match.boundingBox().catch(() => null);
      if (!box || !viewport) continue;
      const onScreen =
        box.x + box.width > 0
        && box.x < viewport.width
        && box.y + box.height > 0
        && box.y < viewport.height;
      if (onScreen) return match;
    }
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(POLL_MS);
  } while (Date.now() < deadline);

  return null;
}

export interface HealingCandidate {
  name: string;      // human-readable label for logs
  build: (page: Page) => Locator;
}

export class SelfHealingLocator {
  constructor(
    private page: Page,
    private elementName: string,
    private candidates: HealingCandidate[],
  ) {}

  /**
   * Returns the first candidate that resolves to a VISIBLE element.
   *
   * Note "first visible", not "first". A candidate is a selector, and a
   * selector routinely matches several nodes — Vodacom's shop renders every
   * step and every modal of a flow into one document, so a search for
   * "Get a new contract" also finds copies sitting in collapsed steps and
   * unopened dialogs. Waiting on .first() then means waiting on whichever
   * copy happens to come first in DOM order, which is frequently a hidden
   * one, and the candidate is written off as broken while the element the
   * customer can actually see is sitting two nodes further down.
   *
   * So each candidate's matches are scanned, not just its first, and the
   * scan is repeated until the deadline so an element that is still being
   * revealed gets its chance.
   */
  async resolve(timeoutPerCandidate = 3000): Promise<Locator> {
    const failures: string[] = [];

    for (const [index, candidate] of this.candidates.entries()) {
      const locator = candidate.build(this.page);
      const visible = await this.firstVisible(locator, timeoutPerCandidate);

      if (visible) {
        if (index > 0) {
          // A heal happened — surface it so the team fixes the primary selector.
          console.warn(
            `[SELF-HEAL] "${this.elementName}": primary selector failed, ` +
            `healed using fallback "${candidate.name}" (candidate #${index + 1}). ` +
            `Failed candidates: ${failures.join(', ')}`,
          );
        }
        return visible;
      }
      failures.push(candidate.name);
    }

    throw new Error(
      `[SELF-HEAL] "${this.elementName}": ALL ${this.candidates.length} ` +
      `locator strategies failed (${failures.join(', ')}). Element needs re-mapping.`,
    );
  }

  private firstVisible(locator: Locator, timeout: number): Promise<Locator | null> {
    return firstVisible(this.page, locator, timeout);
  }

  async click(): Promise<void> {
    await (await this.resolve()).click();
  }

  async fill(value: string): Promise<void> {
    await (await this.resolve()).fill(value);
  }

  /**
   * Type character-by-character with real key events — needed for
   * autocomplete widgets that ignore programmatic fill() and only
   * build their suggestion list from keystrokes.
   */
  async type(value: string): Promise<void> {
    const locator = await this.resolve();
    await locator.click();
    await locator.fill(''); // clear any prefilled value
    await locator.pressSequentially(value, { delay: 60 });
  }
}

/** Convenience factory so page objects read cleanly. */
export function healing(
  page: Page,
  elementName: string,
  candidates: HealingCandidate[],
): SelfHealingLocator {
  return new SelfHealingLocator(page, elementName, candidates);
}
