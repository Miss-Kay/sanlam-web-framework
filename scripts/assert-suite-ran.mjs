#!/usr/bin/env node
/**
 * Fail the job when the suite tested NOTHING.
 *
 * The suites skip rather than fail when the target serves a bot-protection
 * response, and that is the right call: a WAF refusing a CI runner is not a
 * defect in the site and must not be reported as one. See BasePage.isBotBlocked().
 *
 * But a skip is a pass as far as Playwright's exit code is concerned, so a run
 * in which every single test skipped reports SUCCESS — a green tick against a
 * suite that checked nothing at all. That is worse than a red pipeline. A red
 * one gets fixed; a green one that proves nothing quietly becomes the thing
 * everybody trusts, and the next real regression sails through it.
 *
 * So: if tests ran and every one of them skipped, fail, and say why.
 *
 * This is the same failure shape the group already knows from the other
 * direction. "Never believe a zero you did not wait for" is about a count that
 * races a fetch; this is about a pass that never measured anything. Both look
 * healthy from the outside.
 */
import { readFileSync, existsSync } from 'node:fs';

const JUNIT = 'test-results/junit.xml';

if (!existsSync(JUNIT)) {
  console.error(`[GUARD] ${JUNIT} was not produced — the run did not get as far as reporting.`);
  process.exit(1);
}

const xml = readFileSync(JUNIT, 'utf8');
const root = xml.match(/<testsuites\b[^>]*>/)?.[0] ?? '';
const attr = name => Number(root.match(new RegExp(`${name}="(\\d+)"`))?.[1] ?? 0);

const tests = attr('tests');
const skipped = attr('skipped');
const failures = attr('failures');
const errors = attr('errors');
const ran = tests - skipped;

console.log(`[GUARD] tests=${tests} ran=${ran} skipped=${skipped} failures=${failures} errors=${errors}`);

if (tests === 0) {
  console.error('[GUARD] no tests were collected at all — check testMatch/testIgnore in playwright.config.ts.');
  process.exit(1);
}

if (ran === 0) {
  // Pull a skip reason out of the report so the log says WHY without anyone
  // having to download an artifact.
  const reason = xml.match(/<skipped\b[^>]*message="([^"]{0,300})"/)?.[1];
  console.error('');
  console.error(`[GUARD] every one of the ${tests} tests skipped. The suite verified NOTHING.`);
  if (reason) console.error(`[GUARD] first skip reason: ${reason.replace(/&quot;/g, '"')}`);
  console.error('');
  console.error('The usual cause is the target refusing this runner. sanlamonline.co.za sits');
  console.error('behind a CloudFront WAF that answers 403 "Request blocked" to GitHub-hosted');
  console.error('runners (they egress from Azure IP space in the US), while serving a South');
  console.error('African address the real page. Confirm with:');
  console.error('');
  console.error('  curl -sI https://www.sanlamonline.co.za/ | head -3');
  console.error('');
  console.error('Options, in order of preference:');
  console.error('  1. Run the suite from a self-hosted runner with South African egress.');
  console.error('  2. Point BASE_URL at an environment that does not block automation.');
  console.error('  3. Run it locally: npm test — it passes from an unblocked address.');
  console.error('');
  console.error('This job fails on purpose. A green tick on a suite that checked nothing is');
  console.error('worse than a red one, because people believe it.');
  process.exit(1);
}

console.log('[GUARD] the suite executed real tests.');
