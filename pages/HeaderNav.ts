import { Locator } from '@playwright/test';
import { BasePage } from './BasePage';
import { site } from '../fixtures/siteProfile';
import { firstInViewport, firstVisible } from '../utils/selfHealing';

/**
 * The site header: the utility bar, the product pillar bar and the mobile
 * drawer.
 *
 * Two things about this header shape every locator in the class.
 *
 * 1. EVERY NAV LINK IS RENDERED TWICE. The desktop bar and the mobile drawer
 *    are both in the DOM at all times, on every breakpoint, with the copy
 *    that is not in use sitting at zero height rather than being unmounted.
 *    So `page.getByRole('link', { name: 'Insure' })` matches two elements,
 *    and `.first()` is a coin flip that lands on the invisible one often
 *    enough to matter. Everything below resolves the first VISIBLE match.
 *
 * 2. THE CLASS NAMES CARRY A BUILD HASH. `sd-header-site-31e5M9p1fn` is
 *    stable for one deployment and gone the next. Only the prefix is
 *    matched, via cls() in the site profile.
 */
export class HeaderNav extends BasePage {
  /** The product pillar bar: Insure / Retire / Invest / Plan / Credit / … */
  get pillarBar(): Locator {
    return this.page.locator(site.header.pillarNav).first();
  }

  /** The top utility bar: Personal / Business / Corporate, country picker. */
  get utilityBar(): Locator {
    return this.page.locator(site.header.utilityNav).first();
  }

  /**
   * The visible anchor for a pillar, or null when that pillar is not a link.
   *
   * Exact text matching is deliberate. The mega-menu under "Insure" contains
   * "About insurance", "Life insurance", "Disability cover" and a dozen more
   * — a substring match on "Insure" pulls in half of them, and the first one
   * in DOM order is not the pillar.
   */
  async pillarLink(label: string): Promise<Locator | null> {
    const anchors = this.page.getByRole('link', { name: label, exact: true });
    return firstVisible(this.page, anchors, 5000);
  }

  /**
   * The pillar as the customer sees it, link or not.
   *
   * Three of the eight pillars — Invest, Wealth and Rewards — are not links.
   * Each is a bare `<h6>` inside `div[class*="sd-linker"]` with no href, no
   * role, no tabindex and nothing focusable wrapping it, so it can only be
   * reached with a mouse. This method finds them the only way they can be
   * found: by their text and their heading level.
   *
   * It exists so the nav-reachability spec can state that distinction as a
   * fact about the page rather than quietly skipping the three pillars that
   * do not fit the pattern.
   */
  async pillarHeading(label: string): Promise<Locator | null> {
    const headings = this.page
      .locator(`${site.header.pillarNav} h6`)
      .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`) });
    return firstVisible(this.page, headings, 5000);
  }

  /**
   * True when a keyboard user can put focus on this pillar at all.
   *
   * The walk up the tree is BOUNDED, and that is the whole point. An earlier
   * version used a bare `element.closest('… [tabindex] …')`, which walks all
   * the way to the document root and cheerfully matched some unrelated
   * react-aria wrapper hundreds of nodes up — so every pillar reported as
   * focusable and the check proved nothing. It stops at the header item.
   *
   * `tabindex="-1"` deliberately does NOT count. It makes an element
   * focusable by script, not reachable by tabbing, and the question here is
   * whether a person with a keyboard can get to it. That distinction matters
   * on this header, because the pillar's own wrapper is tabindex="-1" and
   * only its parent container is tabindex="0".
   */
  async pillarIsFocusable(label: string): Promise<boolean> {
    const link = await this.pillarLink(label);
    if (link) return true;

    const heading = await this.pillarHeading(label);
    if (!heading) return false;

    return heading.evaluate(element => {
      const tabbable = (el: Element): boolean => {
        if (el.matches('a[href], button')) return true;
        const index = el.getAttribute('tabindex');
        return index !== null && Number(index) >= 0;
      };
      // Boundary: this pillar's own header item, and no further.
      //
      // Note the trailing hyphen — `[class*="sd-header-item-"]` matches the
      // item root (`sd-header-item-31e5SExXu5`) but NOT its descendants
      // (`sd-header-item__title-container-…`), whose names continue with a
      // double underscore. Without it the substring match fires on the very
      // first parent and the walk stops one node BELOW the tabindex="0"
      // container it was looking for — which is how this method spent its
      // first run confidently reporting that every pillar was unfocusable.
      const ITEM_ROOT = '[class*="sd-header-item-"]';

      let node: Element | null = element;
      while (node) {
        if (tabbable(node)) return true;
        if (node.matches(ITEM_ROOT)) return false;
        node = node.parentElement;
      }
      return false;
    });
  }

  /**
   * Open a pillar's flyout with the keyboard, and report whether it opened.
   *
   * "Opened" is measured as a rise in the number of VISIBLE links on the
   * page, which is the only signal this header gives that is not tied to a
   * hashed class name. The flyout mounts its ~8 category links into the
   * document when it opens, so the count moves decisively — on the day this
   * was written, 98 visible links became 106.
   */
  async pillarOpensWithKeyboard(label: string): Promise<boolean> {
    const heading = await this.pillarHeading(label);
    if (!heading) return false;

    const focused = await heading.evaluate(element => {
      let node: Element | null = element;
      while (node && node.getAttribute('tabindex') !== '0') node = node.parentElement;
      if (!node) return false;
      (node as HTMLElement).focus();
      return document.activeElement === node;
    });
    if (!focused) return false;

    const before = await this.visibleLinkCount();
    for (const key of ['Enter', ' ']) {
      await this.page.keyboard.press(key);
      await this.page.waitForTimeout(1200);
      if (await this.visibleLinkCount() > before) return true;
    }
    return false;
  }

  /**
   * Open a pillar's flyout with a real mouse hover, and report whether it
   * opened.
   *
   * A real hover, not a dispatched MouseEvent. The group learned that one
   * the hard way: synthetic events do not drive a React tree the way a real
   * pointer does, and a suite that concludes a flow is broken from them is
   * reporting a defect that does not exist.
   */
  async pillarOpensWithMouse(label: string): Promise<boolean> {
    const heading = await this.pillarHeading(label);
    if (!heading) return false;

    const before = await this.visibleLinkCount();
    await heading.hover();
    await this.page.waitForTimeout(1500);
    return (await this.visibleLinkCount()) > before;
  }

  // ---------------------------------------------------------------- mobile

  /**
   * The mobile menu button — which is not a button.
   *
   * It is a `<label for="menu-toggle">` wrapping an icon, bound to a hidden
   * `<input type="checkbox" id="menu-toggle">`: the CSS checkbox-hack menu.
   * So there is nothing to find by role, and the hashed class prefix is the
   * only stable handle. See openMobileMenu() for the consequence.
   */
  get mobileMenuToggle(): Locator {
    return this.page.locator(site.header.mobileMenuToggle);
  }

  /** The drawer the toggle opens — a separate tree from the desktop bar. */
  get mobileDrawer(): Locator {
    return this.page.locator(site.header.mobileNav);
  }

  /**
   * Tap the hamburger. Returns the drawer, once it is actually on screen.
   *
   * firstInViewport, not firstVisible: the drawer is translated off-screen
   * when closed rather than unmounted, so it reports as visible whether it
   * is open or shut and firstVisible would hand back a closed drawer without
   * complaint.
   */
  async openMobileMenu(): Promise<Locator> {
    const toggle = await firstVisible(this.page, this.mobileMenuToggle, 10_000);
    if (!toggle) throw new Error('the mobile menu toggle is not visible at this breakpoint');

    /**
     * Tap, then CHECK, and tap again if nothing happened.
     *
     * The first tap is routinely swallowed. The header ships in the served
     * HTML, so the hamburger is present and passes every actionability check
     * Playwright makes long before the app has hydrated — and a tap that
     * lands in that window does nothing at all. No error, no warning: the
     * checkbox behind the label simply does not flip, and the drawer stays
     * where it is.
     *
     * That is the group's oldest rule wearing a different hat. Vodacom's
     * suite believed a card count it had not waited for; this would believe
     * a tap it had not waited for. The failure mode is the same and so is
     * the tell: it passes locally, where hydration wins the race on a warm
     * cache, and fails from a CI runner.
     *
     * Waiting on a load state does not fix it — these pages pull in enough
     * third-party tracking that 'load' may never settle on a runner — and a
     * fixed sleep is just a slower guess. So the tap asserts its own effect
     * and repeats if it had none. Re-tapping is safe: each attempt confirms
     * the drawer is still off-screen before tapping again, so a tap that did
     * work is never undone by the next one.
     */
    const ATTEMPTS = 4;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      await toggle.click();

      const drawer = await firstInViewport(this.page, this.mobileDrawer, 3000);
      if (drawer) {
        if (attempt > 1) {
          console.warn(`[NAV] the hamburger needed ${attempt} taps — the header was not hydrated yet`);
        }
        return drawer;
      }
    }

    throw new Error(
      `the mobile drawer did not come on screen after ${ATTEMPTS} taps of the hamburger`,
    );
  }

  /**
   * A product pillar's row in the open mobile drawer, or null if it is not
   * on screen.
   *
   * Scoped to the drawer and resolved by position, because the drawer holds
   * several copies of each label — the top-level list plus every sub-panel
   * that mentions it — stacked off to the side. Matching by text alone finds
   * a copy the customer cannot see.
   */
  async drawerPillar(label: string): Promise<Locator | null> {
    const rows = this.mobileDrawer.getByText(label, { exact: true });
    return firstInViewport(this.page, rows, 10_000);
  }

  /**
   * True when a keyboard user can operate the mobile menu at all.
   *
   * The label is inert on its own; what matters is the checkbox it is bound
   * to. An `<input>` with `display: none` is removed from the accessibility
   * tree and from the tab order entirely, so if that is how the menu is
   * built there is no key a customer can press to open it.
   *
   * The `for` attribute is resolved by hand rather than with
   * `document.getElementById`, because this page ships DUPLICATE IDs — there
   * are two elements with `id="menu-toggle"` — and getElementById silently
   * returns the first. Which one the label is really bound to is the whole
   * question, so we look at what the label points at and check every element
   * carrying that id.
   */
  async mobileMenuIsKeyboardOperable(): Promise<boolean> {
    const toggle = await firstVisible(this.page, this.mobileMenuToggle, 10_000);
    if (!toggle) return false;

    return toggle.evaluate(label => {
      const id = label.getAttribute('for');
      const inputs: Element[] = id
        ? [...document.querySelectorAll(`input[id="${CSS.escape(id)}"]`)]
        : [...label.querySelectorAll('input')];
      if (inputs.length === 0) return false;

      // Operable if ANY input bound to this label is actually tabbable.
      return inputs.some(input => {
        const style = getComputedStyle(input);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if ((input as HTMLInputElement).disabled) return false;
        const index = input.getAttribute('tabindex');
        return index === null || Number(index) >= 0;
      });
    });
  }

  /**
   * Element ids used more than once on the page.
   *
   * Not a nicety. `label[for]` and every `document.getElementById` in the
   * page's own code resolve to the FIRST match, so a duplicated id on a
   * control means the label may be wired to a different element than the one
   * the author meant. This header duplicates both `menu-toggle` and
   * `right-drawer-toggle`, which is exactly where it matters most.
   */
  async duplicateElementIds(): Promise<string[]> {
    return this.page.evaluate(() => {
      const seen = new Map<string, number>();
      for (const element of document.querySelectorAll('[id]')) {
        const id = element.id;
        if (id) seen.set(id, (seen.get(id) ?? 0) + 1);
      }
      return [...seen.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id} (×${n})`);
    });
  }

  /** Links a customer can actually see right now — the flyout-open signal. */
  private visibleLinkCount(): Promise<number> {
    return this.page.evaluate(
      () => [...document.querySelectorAll('a[href]')]
        .filter(a => a.getBoundingClientRect().height > 0).length,
    );
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
