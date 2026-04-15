#!/usr/bin/env node

/**
 * scan.mjs — Zero-token portal scanner
 *
 * Fetches Greenhouse, Ashby, and Lever APIs directly when possible,
 * falls back to Playwright for generic careers pages, applies title
 * filters from portals.yml, deduplicates against existing history,
 * and appends new offers to pipeline.md + scan-history.tsv.
 *
 * Zero Claude API tokens — pure HTTP + JSON.
 *
 * Usage:
 *   node scan.mjs                  # scan all enabled companies
 *   node scan.mjs --dry-run        # preview without writing files
 *   node scan.mjs --company Cohere # scan a single company
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { chromium } from 'playwright';
import yaml from 'js-yaml';
const parseYaml = yaml.load;

// ── Config ──────────────────────────────────────────────────────────

const PORTALS_PATH = 'portals.yml';
const SCAN_HISTORY_PATH = 'data/scan-history.tsv';
const PIPELINE_PATH = 'data/pipeline.md';
const APPLICATIONS_PATH = 'data/applications.md';

// Ensure required directories exist (fresh setup)
mkdirSync('data', { recursive: true });

const CONCURRENCY = 10;
const PLAYWRIGHT_CONCURRENCY = 6;
const FETCH_TIMEOUT_MS = 10_000;
const PLAYWRIGHT_NAV_TIMEOUT_MS = 20_000;
const PLAYWRIGHT_HYDRATE_MS = 2_500;

// ── API detection ───────────────────────────────────────────────────

function detectApi(company) {
  if (company.api) {
    if (company.api.includes('boards-api.greenhouse.io')) {
      return { type: 'greenhouse', url: company.api };
    }
    if (company.api.includes('api.ashbyhq.com')) {
      return { type: 'ashby', url: company.api };
    }
    if (company.api.includes('api.lever.co')) {
      return { type: 'lever', url: company.api };
    }
  }

  const url = company.careers_url || '';

  // Ashby
  const ashbyMatch = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
  if (ashbyMatch) {
    return {
      type: 'ashby',
      url: `https://api.ashbyhq.com/posting-api/job-board/${ashbyMatch[1]}?includeCompensation=true`,
    };
  }

  // Lever
  const leverMatch = url.match(/jobs\.lever\.co\/([^/?#]+)/);
  if (leverMatch) {
    return {
      type: 'lever',
      url: `https://api.lever.co/v0/postings/${leverMatch[1]}`,
    };
  }

  // Greenhouse EU boards
  const ghEuMatch = url.match(/job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/);
  if (ghEuMatch && !company.api) {
    return {
      type: 'greenhouse',
      url: `https://boards-api.greenhouse.io/v1/boards/${ghEuMatch[1]}/jobs`,
    };
  }

  return null;
}

// ── API parsers ─────────────────────────────────────────────────────

function parseGreenhouse(json, companyName) {
  const jobs = json.jobs || [];
  return jobs.map(j => ({
    title: j.title || '',
    url: j.absolute_url || '',
    company: companyName,
    location: j.location?.name || '',
  }));
}

function parseAshby(json, companyName) {
  const jobs = json.jobs || [];
  return jobs.map(j => ({
    title: j.title || '',
    url: j.jobUrl || '',
    company: companyName,
    location: j.location || '',
  }));
}

function parseLever(json, companyName) {
  if (!Array.isArray(json)) return [];
  return json.map(j => ({
    title: j.text || '',
    url: j.hostedUrl || '',
    company: companyName,
    location: j.categories?.location || '',
  }));
}

const PARSERS = { greenhouse: parseGreenhouse, ashby: parseAshby, lever: parseLever };

// ── Playwright careers page scan ────────────────────────────────────

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    const distance = Math.max(600, Math.floor(window.innerHeight * 0.8));
    let unchanged = 0;
    let lastHeight = 0;

    for (let i = 0; i < 10; i++) {
      window.scrollBy(0, distance);
      await new Promise((resolve) => setTimeout(resolve, 250));

      const currentHeight = document.body?.scrollHeight || 0;
      if (currentHeight === lastHeight) unchanged += 1;
      else unchanged = 0;
      lastHeight = currentHeight;

      if (unchanged >= 2) break;
    }

    window.scrollTo(0, 0);
  });
}

async function extractCareersPageJobs(page, companyName) {
  const rawJobs = await page.evaluate(({ companyName }) => {
    const ATS_PATTERNS = [
      'jobs.ashbyhq.com',
      'job-boards.greenhouse.io',
      'job-boards.eu.greenhouse.io',
      'boards.greenhouse.io',
      'jobs.lever.co',
      'api.lever.co',
      'myworkdayjobs.com',
      'workday.com',
      'workable.com',
      'smartrecruiters.com',
      'jobvite.com',
      'icims.com',
      'bamboohr.com',
      'teamtailor.com',
      '/careers/',
      '/career/',
      '/jobs/',
      '/job/',
      '/positions/',
      '/openings/',
      '/vacancies/',
      '/vacancy/',
      '/role/',
      '/roles/',
    ];
    const NOISE_PATTERNS = [
      'privacy',
      'cookie',
      'terms',
      'linkedin',
      'instagram',
      'facebook',
      'twitter',
      'x.com',
      'youtube',
      'benefits',
      'mission',
      'about us',
      'our values',
      'blog',
      'press',
      'newsroom',
      'investor',
      'sign in',
      'log in',
      'login',
      'join our talent community',
      'talent community',
      'meet the team',
      'learn more',
      'contact us',
      'read more',
    ];

    function normalizeText(value) {
      return (value || '').replace(/\s+/g, ' ').trim();
    }

    function firstMeaningfulLine(value) {
      const lines = (value || '')
        .split('\n')
        .map((line) => normalizeText(line))
        .filter(Boolean);
      return lines[0] || '';
    }

    function isVisible(element) {
      if (!element || element.closest('nav, header, footer')) return false;
      if (element.closest('[aria-hidden="true"], [hidden]')) return false;
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      return Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
    }

    function parseJobPostingLocation(jobLocation) {
      const locations = Array.isArray(jobLocation) ? jobLocation : [jobLocation];
      return locations
        .map((entry) => {
          const address = entry?.address || entry?.addressLocality || entry;
          if (typeof address === 'string') return normalizeText(address);
          if (!address || typeof address !== 'object') return '';
          return normalizeText([
            address.addressLocality,
            address.addressRegion,
            address.addressCountry,
          ].filter(Boolean).join(', '));
        })
        .filter(Boolean)
        .join(' | ');
    }

    function collectStructuredData() {
      const results = [];
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));

      function walk(node) {
        if (!node) return;
        if (Array.isArray(node)) {
          node.forEach(walk);
          return;
        }
        if (typeof node !== 'object') return;
        if (node['@type'] === 'JobPosting') {
          results.push({
            title: normalizeText(node.title),
            url: normalizeText(node.url),
            location: parseJobPostingLocation(node.jobLocation),
            source: 'structured-data',
            score: 10,
          });
        }
        if (node['@graph']) walk(node['@graph']);
      }

      for (const script of scripts) {
        try {
          walk(JSON.parse(script.textContent || 'null'));
        } catch {}
      }

      return results;
    }

    function collectLinkCandidates() {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      return anchors
        .filter(isVisible)
        .map((anchor) => {
          const href = anchor.getAttribute('href') || '';
          if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
            return null;
          }

          const url = new URL(href, window.location.href).href;
          const label = normalizeText([
            anchor.innerText,
            anchor.getAttribute('aria-label'),
            anchor.getAttribute('title'),
          ].filter(Boolean).join(' '));

          const container = anchor.closest('article, li, tr, [role="listitem"], .opening, .job, .position, .role, section, div');
          const context = normalizeText(container?.innerText || '');
          const text = firstMeaningfulLine(label || context);
          const lowerText = `${text} ${context} ${url}`.toLowerCase();

          if (!text) return null;
          if (NOISE_PATTERNS.some((pattern) => lowerText.includes(pattern))) return null;

          let score = 0;
          if (ATS_PATTERNS.some((pattern) => lowerText.includes(pattern))) score += 3;
          if (/(job|jobs|career|careers|position|positions|opening|openings|vacanc|role|opportunit)/i.test(lowerText)) score += 2;
          if (text.length >= 8 && text.length <= 120) score += 1;
          if (/remote|dublin|ireland|cork|galway|limerick|hybrid|onsite/i.test(context)) score += 1;

          if (score < 3) return null;

          const locationMatch = context.match(
            /\b(remote|dublin|ireland|cork|galway|limerick|hybrid|onsite|emea|eu|europe)\b/i
          );

          return {
            title: text,
            url,
            location: normalizeText(locationMatch?.[0] || ''),
            source: 'page-links',
            score,
          };
        })
        .filter(Boolean);
    }

    const company = normalizeText(companyName);
    return [...collectStructuredData(), ...collectLinkCandidates()].map((job) => ({
      ...job,
      company,
    }));
  }, { companyName });

  return uniqueBy(
    rawJobs
      .map((job) => ({
        title: (job.title || '').trim(),
        url: (job.url || '').trim(),
        company: companyName,
        location: (job.location || '').trim(),
        source: job.source || 'playwright',
        score: Number(job.score) || 0,
      }))
      .filter((job) => job.title && job.url),
    (job) => `${job.url}::${job.title.toLowerCase()}`
  ).sort((a, b) => b.score - a.score);
}

async function scanCompanyViaBrowser(browser, company) {
  const page = await browser.newPage();

  try {
    await page.goto(company.careers_url, {
      waitUntil: 'domcontentloaded',
      timeout: PLAYWRIGHT_NAV_TIMEOUT_MS,
    });
    await page.waitForTimeout(PLAYWRIGHT_HYDRATE_MS);
    await autoScroll(page);
    return await extractCareersPageJobs(page, company.name);
  } finally {
    await page.close();
  }
}

// ── Fetch with timeout ──────────────────────────────────────────────

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── Title filter ────────────────────────────────────────────────────

function buildTitleFilter(titleFilter) {
  const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const compileKeyword = (keyword) => {
    const trimmed = keyword.trim();
    if (!trimmed) return null;
    return new RegExp(`(^|[^a-z0-9])${escapeRegex(trimmed.toLowerCase())}([^a-z0-9]|$)`, 'i');
  };
  const positive = (titleFilter?.positive || []).map(compileKeyword).filter(Boolean);
  const negative = (titleFilter?.negative || []).map(compileKeyword).filter(Boolean);

  return (title) => {
    const lower = title.toLowerCase();
    const hasPositive = positive.length === 0 || positive.some((pattern) => pattern.test(lower));
    const hasNegative = negative.some((pattern) => pattern.test(lower));
    return hasPositive && !hasNegative;
  };
}

// ── Dedup ───────────────────────────────────────────────────────────

function loadSeenUrls() {
  const seen = new Set();

  // scan-history.tsv
  if (existsSync(SCAN_HISTORY_PATH)) {
    const lines = readFileSync(SCAN_HISTORY_PATH, 'utf-8').split('\n');
    for (const line of lines.slice(1)) { // skip header
      const url = line.split('\t')[0];
      if (url) seen.add(url);
    }
  }

  // pipeline.md — extract URLs from checkbox lines
  if (existsSync(PIPELINE_PATH)) {
    const text = readFileSync(PIPELINE_PATH, 'utf-8');
    for (const match of text.matchAll(/- \[[ x]\] (https?:\/\/\S+)/g)) {
      seen.add(match[1]);
    }
  }

  // applications.md — extract URLs from report links and any inline URLs
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    for (const match of text.matchAll(/https?:\/\/[^\s|)]+/g)) {
      seen.add(match[0]);
    }
  }

  return seen;
}

function loadSeenCompanyRoles() {
  const seen = new Set();
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    // Parse markdown table rows: | # | Date | Company | Role | ...
    for (const match of text.matchAll(/\|[^|]+\|[^|]+\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g)) {
      const company = match[1].trim().toLowerCase();
      const role = match[2].trim().toLowerCase();
      if (company && role && company !== 'company') {
        seen.add(`${company}::${role}`);
      }
    }
  }
  return seen;
}

// ── Pipeline writer ─────────────────────────────────────────────────

function appendToPipeline(offers) {
  if (offers.length === 0) return;

  let text = readFileSync(PIPELINE_PATH, 'utf-8');

  // Find "## Pendientes" section and append after it
  const marker = '## Pendientes';
  const idx = text.indexOf(marker);
  if (idx === -1) {
    // No Pendientes section — append at end before Procesadas
    const procIdx = text.indexOf('## Procesadas');
    const insertAt = procIdx === -1 ? text.length : procIdx;
    const block = `\n${marker}\n\n` + offers.map(o =>
      `- [ ] ${o.url} | ${o.company} | ${o.title}`
    ).join('\n') + '\n\n';
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  } else {
    // Find the end of existing Pendientes content (next ## or end)
    const afterMarker = idx + marker.length;
    const nextSection = text.indexOf('\n## ', afterMarker);
    const insertAt = nextSection === -1 ? text.length : nextSection;

    const block = '\n' + offers.map(o =>
      `- [ ] ${o.url} | ${o.company} | ${o.title}`
    ).join('\n') + '\n';
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  }

  writeFileSync(PIPELINE_PATH, text, 'utf-8');
}

function appendToScanHistory(offers, date) {
  // Ensure file + header exist
  if (!existsSync(SCAN_HISTORY_PATH)) {
    writeFileSync(SCAN_HISTORY_PATH, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n', 'utf-8');
  }

  const lines = offers.map(o =>
    `${o.url}\t${date}\t${o.source}\t${o.title}\t${o.company}\tadded`
  ).join('\n') + '\n';

  appendFileSync(SCAN_HISTORY_PATH, lines, 'utf-8');
}

// ── Parallel fetch with concurrency limit ───────────────────────────

async function parallelFetch(tasks, limit) {
  const results = [];
  let i = 0;

  async function next() {
    while (i < tasks.length) {
      const task = tasks[i++];
      results.push(await task());
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => next());
  await Promise.all(workers);
  return results;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const companyFlag = args.indexOf('--company');
  const filterCompany = companyFlag !== -1 ? args[companyFlag + 1]?.toLowerCase() : null;

  // 1. Read portals.yml
  if (!existsSync(PORTALS_PATH)) {
    console.error('Error: portals.yml not found. Run onboarding first.');
    process.exit(1);
  }

  const config = parseYaml(readFileSync(PORTALS_PATH, 'utf-8'));
  const companies = config.tracked_companies || [];
  const titleFilter = buildTitleFilter(config.title_filter);
  const companyKey = (company) => `${company.name}::${company.careers_url || ''}::${company.api || ''}`;

  // 2. Filter enabled companies and split into API/browser scan paths
  const enabledCompanies = companies
    .filter(c => c.enabled !== false)
    .filter(c => !filterCompany || c.name.toLowerCase().includes(filterCompany));
  const apiTargets = enabledCompanies
    .map(c => ({ ...c, _api: detectApi(c) }))
    .filter(c => c._api !== null);
  const apiTargetKeys = new Set(apiTargets.map(companyKey));
  const browserTargets = enabledCompanies.filter(c => !apiTargetKeys.has(companyKey(c)));
  const queuedBrowserKeys = new Set(browserTargets.map(companyKey));

  console.log(
    `Scanning ${apiTargets.length} companies via API, ${browserTargets.length} via Playwright`
  );
  if (dryRun) console.log('(dry run — no files will be written)\n');

  // 3. Load dedup sets
  const seenUrls = loadSeenUrls();
  const seenCompanyRoles = loadSeenCompanyRoles();

  // 4. Fetch all APIs
  const date = new Date().toISOString().slice(0, 10);
  let totalFound = 0;
  let totalFiltered = 0;
  let totalDupes = 0;
  const newOffers = [];
  const errors = [];
  let apiScanned = 0;
  let browserScanned = 0;

  function processJobs(jobs, source) {
    totalFound += jobs.length;

    for (const job of jobs) {
      if (!titleFilter(job.title)) {
        totalFiltered++;
        continue;
      }
      if (seenUrls.has(job.url)) {
        totalDupes++;
        continue;
      }
      const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
      if (seenCompanyRoles.has(key)) {
        totalDupes++;
        continue;
      }
      seenUrls.add(job.url);
      seenCompanyRoles.add(key);
      newOffers.push({ ...job, source });
    }
  }

  const tasks = apiTargets.map(company => async () => {
    const { type, url } = company._api;
    try {
      const json = await fetchJson(url);
      const jobs = PARSERS[type](json, company.name);
      apiScanned++;
      processJobs(jobs, `${type}-api`);
    } catch (err) {
      if (!company.careers_url) {
        errors.push({ company: company.name, error: err.message });
        return;
      }
      const key = companyKey(company);
      if (!queuedBrowserKeys.has(key)) {
        browserTargets.push(company);
        queuedBrowserKeys.add(key);
      }
    }
  });

  await parallelFetch(tasks, CONCURRENCY);

  if (browserTargets.length > 0) {
    const browser = await chromium.launch({ headless: true });
    try {
      const browserTasks = browserTargets.map(company => async () => {
        try {
          const jobs = await scanCompanyViaBrowser(browser, company);
          browserScanned++;
          processJobs(jobs, 'playwright-careers');
        } catch (err) {
          errors.push({ company: company.name, error: err.message });
        }
      });

      // Run multiple pages in parallel within one browser so slow portals
      // do not force the entire Playwright pass into a serial crawl.
      await parallelFetch(browserTasks, PLAYWRIGHT_CONCURRENCY);
    } finally {
      await browser.close();
    }
  }

  // 5. Write results
  if (!dryRun && newOffers.length > 0) {
    appendToPipeline(newOffers);
    appendToScanHistory(newOffers, date);
  }

  // 6. Print summary
  console.log(`\n${'━'.repeat(45)}`);
  console.log(`Portal Scan — ${date}`);
  console.log(`${'━'.repeat(45)}`);
  console.log(`Companies scanned:     ${apiScanned + browserScanned}`);
  console.log(`  API:                 ${apiScanned}`);
  console.log(`  Playwright:          ${browserScanned}`);
  console.log(`Total jobs found:      ${totalFound}`);
  console.log(`Filtered by title:     ${totalFiltered} removed`);
  console.log(`Duplicates:            ${totalDupes} skipped`);
  console.log(`New offers added:      ${newOffers.length}`);

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    for (const e of errors) {
      console.log(`  ✗ ${e.company}: ${e.error}`);
    }
  }

  if (newOffers.length > 0) {
    console.log('\nNew offers:');
    for (const o of newOffers) {
      console.log(`  + ${o.company} | ${o.title} | ${o.location || 'N/A'}`);
    }
    if (dryRun) {
      console.log('\n(dry run — run without --dry-run to save results)');
    } else {
      console.log(`\nResults saved to ${PIPELINE_PATH} and ${SCAN_HISTORY_PATH}`);
    }
  }

  console.log(`\n→ Run /career-ops pipeline to evaluate new offers.`);
  console.log('→ Share results and get help: https://discord.gg/8pRpHETxa4');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
