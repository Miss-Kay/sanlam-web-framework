# Sanlam Online — web automation framework

Playwright + TypeScript link-integrity and navigation-reachability suite for
[sanlamonline.co.za](https://www.sanlamonline.co.za), the Sanlam South Africa
public marketing site.

Fourth of the frameworks in the Misskay Automation Group and built on the same
architecture: a single site profile, page objects over a shared `BasePage`,
self-healing locators, and CI publishing reports to S3 over OIDC.

## What it checks

| Suite | Project | What it proves |
|---|---|---|
| `tests/link-integrity.spec.ts` | chromium | Every link on the six main entry pages resolves, and none has gone missing since the committed baseline |
| `tests/nav-reachability.spec.ts` | chromium | The desktop pillar bar points where it should, and the three pillars that are not links behave as recorded |
| `tests/mobile-menu.spec.ts` | mobile | The hamburger opens the drawer, every pillar is in it, and the toggle's known defects are still the known defects |

**The suite is read-only.** It never signs in, never enters personal data and
never submits a quote or an application. Two mechanisms enforce that rather
than leaving it to good intentions:

- `excludedHosts` — `login.sanlamonline.co.za`, the Azure AD B2C tenant. Every
  "Login" control lands there with a PKCE challenge in the query string, so a
  request would open a real authorisation transaction.
- `excludedPaths` — `/auth`, `/servicing`, `/logout`, `/reset-password`,
  `/_next`. Sanlam serves its authenticated servicing area from the **same
  host** as the marketing site, so excluding hosts alone would not be enough.
  Every path listed is also `Disallow`-ed in the site's own robots.txt.

## Running it

```bash
npm ci && npx playwright install --with-deps chromium && npm test
```

| Command | Does |
|---|---|
| `npm test` | Everything, both projects |
| `npm run test:links` | Link integrity only |
| `npm run test:nav` | Desktop nav only |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run report` | Open the last HTML report |
| `npm run baseline:update` | Re-capture the six link snapshots |

`BASE_URL` overrides the site profile's URL if the suite ever needs to run
against a staging environment.

## Live findings

Three broken links and three accessibility defects, all confirmed on
2026-09-10 and all **quarantined rather than left failing** — the group's
rule is that a permanently red pipeline hides the next regression. They are
re-reported in the run's attachments on every run, and anything NEW still
fails the suite.

### Broken links (`fixtures/testData.ts` → `knownBrokenLinks`)

| Link | Where | Why it broke |
|---|---|---|
| `/servicing-withdrawals` | Promo bar, home page | The "Need a partial cash withdrawal?" banner points at a page that 404s |
| `/021%20916%201500` | `/help`, `/help/contact-us` | `<a href="021 916 1500">` — a phone number with no `tel:` scheme, so it resolves as a path |
| `/0860%20726%20526` | `/help`, `/help/contact-us` | Same defect. The same number is authored correctly elsewhere on the page as both `tel:` and `wa.me` |

The promo-bar one is worth a second look for two reasons. Its href is
authored **relative with no leading slash** (`href="servicing-withdrawals"`),
so it only resolves to `/servicing-withdrawals` because the bar happens to sit
on the root page — the same component on `/personal/insurance` would point at
`/personal/servicing-withdrawals` instead. And the bar is injected
client-side, so it is not in the served HTML at all: an HTML-only crawler
cannot see this link, let alone that it is dead.

### Accessibility defects (`@known-defect`)

- **Invest, Wealth and Rewards are not links.** Each is a bare `<h6>` inside a
  container with `tabindex="0"` and no role. They *are* tab stops — but
  pressing Enter or Space does nothing, while a mouse hover opens the flyout.
  Focusable but not operable, and announced to a screen reader as a tab stop
  that is neither link nor button.
- **The mobile hamburger cannot be operated by keyboard at all.** It is a
  `<label for="menu-toggle">` bound to an `<input type="checkbox">` whose
  computed style is `display: none` — out of the tab order and out of the
  accessibility tree. On a phone that control is the only route to the site's
  navigation, so this is strictly worse than the desktop defect.
- **Duplicate element ids.** `menu-toggle` and `right-drawer-toggle` are each
  declared twice. `label[for]` binds to the first match, so a toggle may be
  wired to a different element than the author intended.

These are asserted **inverted** on purpose: they pass while the defect is
present and fail once Sanlam ships a fix, at which point the test says so and
asks to be deleted. Each also asserts the pointer path still works, so a
genuine break still fails loudly.

## Things about this site that will bite you

Every one of these cost a debugging session. They are commented at the place
in the code that deals with them; this is the index.

- **Class names carry a build hash.** `sd-header-site-31e5M9p1fn` is stable
  for one deployment and gone the next, and there is more than one hash
  namespace (`31e5…` for the header, `91a4…` for the button library). Some
  components are styled-components with no readable prefix at all
  (`sc-gsTDHW cReWEw`). Never write a full class name — use `cls()` in the
  site profile, which matches the prefix. See `fixtures/siteProfile.ts`.
- **Every nav link is rendered twice.** The desktop bar and the mobile drawer
  are both in the DOM at every breakpoint, with the unused copy at zero
  height rather than unmounted. `.first()` is a coin flip that lands on the
  invisible copy often enough to matter — and when it does, `.focus()` and
  `.click()` wait out their full timeout on a page that is working. Use
  `firstVisible()`. See `utils/selfHealing.ts`.
- **The drawer is moved off-screen, not unmounted.** So every row in it
  reports as visible whether the menu is open or shut, and `isVisible()`
  cannot tell you what the customer can see. Position is the only honest
  signal — use `firstInViewport()` or `toBeInViewport()`.
- **The first tap on the hamburger is usually swallowed.** The header is in
  the served HTML, so it passes every actionability check long before the app
  hydrates, and a tap in that window silently does nothing. `openMobileMenu()`
  taps, checks, and taps again rather than trusting the first one. This is the
  group's "never believe something you did not wait for" rule wearing a
  different hat, and it has the usual tell: passes locally, fails in CI.
- **Never dismiss the notification bar before a link scan.** Closing it
  deletes an anchor, the dismissal persists across reloads, and the link it
  removes is currently a live 404 — which would vanish from the report
  silently, because a link that is never collected is never reported as
  broken. `LinkScanPage` opts out via `dismissesPromoBar`. See
  `pages/BasePage.ts`.
- **There is no consent banner.** Checked, not assumed: the page sets
  analytics cookies and loads Segment, MoEngage, TikTok, Meta, LinkedIn and
  Crazy Egg on first paint with nothing to dismiss and no shadow root
  anywhere. `BasePage.dismissConsentBanner()` returns immediately when the
  profile names no banner, because a speculative `waitFor` against a selector
  that will never match burns its timeout on every one of the six page opens.

## Why the link check is shaped the way it is

**Collect six times, resolve once.** The six pages share a header and footer,
and the mega-menu alone is over 250 anchors rendered into every template.
Checking per page would fetch the same third-party host six times and make a
link check look like a small denial-of-service attempt. The spec unions the
link sets and resolves each unique URL exactly once, carrying the list of
pages each link appeared on into the report.

**Only fail on links that are provably broken.** The site links out to two
dozen hosts it does not control — sibling Sanlam businesses across seven
countries, plus Google, YouTube, X, Facebook, LinkedIn, Instagram and TikTok
— and several answer an automated request with 403 while serving a human
perfectly. So: HEAD and GET are both tried and the best answer wins; only
404/410 is treated as unambiguous for a third party; anything still refusing
is re-checked in a real browser; and whatever is left is reported as
*unverified* rather than failed. Sanlam's own host is held to the strict
standard — they control it, so any error there is a real defect.

**Baseline the link set, per page.** Resolving every link proves nothing is
broken. It cannot prove nothing has gone *missing*: a page that quietly loses
half its navigation still passes, because everything left resolves perfectly.
Each page has its own committed snapshot in `fixtures/*.baseline.json`. A link
present at baseline and absent now fails the run. New links are reported, not
failed — accept them deliberately with `npm run baseline:update`.

## CI and reports

`.github/workflows/playwright.yml` runs on push to `main`, on PRs, every third
day, and on manual dispatch. Reports upload as a GitHub artifact always, and
publish to S3 when the AWS pieces are configured.

**AWS is not bootstrapped for this repo yet.** When it is:

```bash
./scripts/setup-aws-reports.sh sanlam-suite-reports af-south-1 Miss-Kay/sanlam-web-framework
```

Then set `AWS_ROLE_ARN` (secret), `AWS_REGION` and `REPORT_BUCKET` (variables)
as the script prints.

Two things that script gets right and are easy to get wrong by hand:

- **One IAM role per repo.** The role name derives from the repo, and the
  script refuses to repoint a role that another repo already trusts. A shared
  role means bootstrapping the second repo silently breaks the first one's CI.
- **Both OIDC subject forms are trusted.** This GitHub account issues
  immutable subject IDs (`repo:owner@86423962/name@<repoid>:*`), and a policy
  matching only the classic form fails with an opaque
  `sts:AssumeRoleWithWebIdentity` error.

## Known gaps

- The scan covers the six top-of-funnel entry pages, not the whole estate.
  Deeper product and article pages are reached from them but not themselves
  scanned; adding one is a row in `scanTargets` plus a baseline capture.
- The mobile project covers the drawer's top level. The sub-panels behind each
  pillar's chevron are not opened.
