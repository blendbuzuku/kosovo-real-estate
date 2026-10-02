// Browser test of every page and action, as visitor, member, business and admin, on desktop and phone.
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.APP_URL ?? 'http://localhost:4200';
const API = process.env.API_URL ?? 'http://localhost:5102/api';
const OUT = new URL('./screenshots/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const PHOTO = new URL('./fixtures/photo.png', import.meta.url).pathname;
const CV = new URL('./fixtures/cv.pdf', import.meta.url).pathname;
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const res = { pass: 0, fail: [], consoleErrors: [], badResponses: [] };
let current = '';
process.on('exit', () => {
  console.log(`\nPASS ${res.pass}  FAIL ${res.fail.length}`);
  for (const f of res.fail) console.log('  ✗ ' + f);
  const ce = [...new Set(res.consoleErrors)];
  if (ce.length) console.log('\nConsole errors:\n  ' + ce.slice(0, 30).join('\n  '));
  const br = [...new Set(res.badResponses)];
  if (br.length) console.log('\nUnexpected API responses:\n  ' + br.slice(0, 40).join('\n  '));
});
const ok = (cond, name, extra) => {
  if (cond) res.pass++;
  else res.fail.push(`[${current}] ${name}${extra !== undefined ? ' :: ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 300) : ''}`);
};
const expected4xx = new Set(['GET /api/listings/:id/applications 404']);
async function section(name, fn) {
  if (ONLY && !ONLY.some((o) => name.startsWith(o))) return;
  current = name;
  console.log('▶ ' + name);
  try {
    await fn();
  } catch (e) {
    res.fail.push(`[${name}] CRASH ${e.message.split('\n')[0]}`);
    for (const p of pages) await p.screenshot({ path: `${OUT}/crash-${name.replace(/\W+/g, '_')}-${pages.indexOf(p)}.png` }).catch(() => {});
  }
}

const pages = [];
async function newPage({ mobile = false } = {}) {
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
      : { viewport: { width: 1366, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] },
  );
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) res.consoleErrors.push(`[${current}] ${m.text().slice(0, 200)}`);
  });
  page.on('pageerror', (e) => res.consoleErrors.push(`[${current}] pageerror ${e.message.slice(0, 200)}`));
  page.on('response', (r) => {
    const u = r.url();
    if (!u.includes('/api/')) return;
    const s = r.status();
    const key = `${r.request().method()} ${new URL(u).pathname.replace(/[0-9a-f-]{36}/g, ':id')} ${s}`;
    if (s >= 500 || (s >= 400 && !expected4xx.has(key))) res.badResponses.push(`[${current}] ${key}`);
  });
  page.on('dialog', (d) => d.accept());
  // Zoneless Angular renders a frame after the event; give it that frame before the next read.
  for (const m of ['click', 'fill', 'selectOption', 'press']) {
    const orig = page[m].bind(page);
    page[m] = async (...a) => {
      const r = await orig(...a);
      await page.waitForTimeout(60);
      return r;
    };
  }
  pages.push(page);
  return page;
}
const shot = (p, name, full = false) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
const settle = (p) => p.waitForLoadState('networkidle').catch(() => {});

async function apiJson(path, token) {
  const r = await fetch(API + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return r.json();
}
async function apiLogin(email, password = 'Demo1234!') {
  const r = await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return (await r.json()).token;
}
async function apiPost(path, token, body) {
  const r = await fetch(API + path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}

async function login(page, email, password = 'Demo1234!') {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await page.click('form button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await settle(page);
}
async function logout(page) {
  await page.click('.avatar-btn');
  await page.click('.menu button:has-text("Log out")');
  await page.waitForSelector('.login-link');
}
/** The results count shown on the search page must equal the API's total for the same URL. */
async function countMatchesApi(page, label) {
  // Poll: the page updates a moment after the URL changes.
  let shown, api, url;
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(200);
    const text = await page.textContent('.results-head p').catch(() => '');
    if (!text || text.includes('Searching')) continue;
    url = new URL(page.url());
    shown = Number(text.replace(/[^\d]/g, ''));
    api = (await apiJson(`/listings?${url.searchParams.toString()}&pageSize=1`)).total;
    if (shown === api) break;
  }
  ok(shown === api, `${label}: shown count equals API (${url?.search})`, { shown, api });
  return shown;
}
async function noHorizontalScroll(page, label) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(over <= 1, `${label}: no sideways scroll`, over);
}

async function galleryCheck(p) {
  // Gallery viewer on an ad with several photos
  const many = (await apiJson('/listings?pageSize=100')).items.find((l) => l.photoCount >= 3) ?? (posted.length ? await apiJson(`/listings/${posted[1].id}`).then((d) => ({ id: d.id, photoCount: d.photos.length })) : null);
  if (many) {
    await p.goto(`${BASE}/listings/${many.id}`);
    await p.click('.g-main');
    await p.waitForSelector('.viewer');
    ok((await p.textContent('.viewer-count')).startsWith('1 /'), 'viewer opens on photo 1');
    await p.click('.viewer-next');
    ok((await p.textContent('.viewer-count')).startsWith('2 /'), 'viewer next');
    await p.keyboard.press('ArrowLeft');
    await p.waitForTimeout(100);
    ok((await p.textContent('.viewer-count')).startsWith('1 /'), 'viewer arrow key');
    await p.keyboard.press('ArrowLeft');
    await p.waitForTimeout(100);
    ok((await p.textContent('.viewer-count')).startsWith(`${many.photoCount} /`), 'viewer wraps around');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(100);
    ok(!(await p.locator('.viewer').count()), 'escape closes viewer');
    await p.click('.g-all');
    ok(await p.locator('.viewer').count(), '"All photos" opens viewer');
    await p.click('.viewer-close');
  } else console.log('   (no ad with 3+ photos yet; gallery checked later)');
}

const cats = await apiJson('/meta/categories');
const locs = await apiJson('/meta/locations');
const stamp = Date.now().toString().slice(-6);
const posted = [];

// =====================================================================================
await section('V1 home', async () => {
  const p = await newPage();
  await p.goto(BASE);
  await p.waitForSelector('.category-tile');
  await p.waitForSelector('.rail app-listing-card');
  const tiles = await p.locator('.category-tile').count();
  ok(tiles === cats.length + 2, 'one tile per category plus Stays and Rent a car', tiles);
  ok((await p.locator('.business-chip').count()) > 0, 'business strip shows');
  ok((await p.locator('.rail').count()) >= 5, 'rails show', await p.locator('.rail').count());
  await shot(p, 'v1-home');

  // Every tile: its count equals the results page count.
  for (let i = 0; i < tiles; i++) {
    await p.goto(BASE);
    await p.waitForSelector('.category-tile');
    const tile = p.locator('.category-tile').nth(i);
    const label = await tile.locator('strong').textContent();
    const n = Number((await tile.locator('.muted').textContent()).replace(/[^\d]/g, ''));
    await tile.click();
    await p.waitForURL(/\/search/);
    const shown = await countMatchesApi(p, `tile ${label}`);
    ok(shown === n, `tile ${label} count ${n} matches results`, shown);
  }

  // Every "See all" link on rails.
  await p.goto(BASE);
  await p.waitForSelector('.rail app-listing-card');
  const seeAll = await p.locator('.see-all').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  for (const href of seeAll.filter((h) => h.startsWith('/search'))) {
    await p.goto(BASE + href);
    await p.waitForSelector('.results-title');
    const n = await countMatchesApi(p, `see all ${href}`);
    ok(n > 0, `see all ${href} has ads`);
  }

  // Quick search with every intent, a location and a budget.
  await p.goto(BASE);
  await p.waitForSelector('.qs-tab');
  const intents = await p.locator('.qs-tab').count();
  ok(intents >= 6, 'quick-search tabs', intents);
  for (let i = 0; i < intents; i++) {
    await p.goto(BASE);
    await p.waitForSelector('.qs-tab');
    const tab = p.locator('.qs-tab').nth(i);
    const name = (await tab.textContent()).trim();
    await tab.click();
    await p.waitForFunction((i) => document.querySelectorAll('.qs-tab')[i].getAttribute('aria-selected') === 'true', i, { timeout: 3000 }).catch(() => {});
    ok((await tab.getAttribute('aria-selected')) === 'true', `intent ${name} selected`);
    await p.click('.qs-field.where input');
    await p.keyboard.type('prishtin');
    await p.waitForSelector('.loc-list li');
    await p.keyboard.press('Enter');
    await p.fill('.qs-field.budget input', '200000');
    await p.click('.qs-go');
    await p.waitForURL(/\/search/);
    const u = new URL(p.url());
    ok(u.searchParams.get('municipality') === 'Prishtinë', `intent ${name}: municipality passed`, u.search);
    ok(u.searchParams.get('maxPrice') === '200000', `intent ${name}: budget passed`, u.search);
    await countMatchesApi(p, `quick search ${name}`);
    const title = await p.textContent('.results-title');
    ok(title.includes('Prishtinë'), `intent ${name}: title says where`, title);
  }

  // Keyword from the home box.
  await p.goto(BASE);
  await p.click('.qs-tab:has-text("Cars")');
  await p.fill('.qs-field.what input', 'golf');
  await p.click('.qs-go');
  await p.waitForURL(/q=golf/);
  ok((await countMatchesApi(p, 'home keyword golf')) > 0, 'home keyword finds a Golf');
});

// =====================================================================================
await section('V2 header and footer links', async () => {
  const p = await newPage();
  await p.goto(BASE);
  const links = await p.locator('.main-nav a, .site-footer a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  for (const href of [...new Set(links)]) {
    await p.goto(BASE + href);
    await settle(p);
    if (href.startsWith('/search')) {
      const n = await countMatchesApi(p, `link ${href}`);
      ok(n > 0, `link ${href} shows ads`, n);
    } else {
      ok(!(await p.locator('.error').count()), `link ${href} has no error`);
    }
  }
  // Logo returns home
  await p.click('.site-header .brand');
  await p.waitForURL(BASE + '/');
  ok((await p.title()).startsWith('Tregu'), 'home title names the app', await p.title());

  // Theme toggle flips the theme and survives a reload
  const theme = () => p.evaluate(() => document.documentElement.dataset.theme);
  const before = await theme();
  await p.click('.theme-toggle');
  const after = await theme();
  ok(after && after !== before, 'theme toggle switches theme', `${before} -> ${after}`);
  const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await p.reload();
  await settle(p);
  ok((await theme()) === after, 'theme choice survives a reload', await theme());
  ok((await p.evaluate(() => getComputedStyle(document.body).backgroundColor)) === bg, 'page colours follow the theme', bg);
  await p.click('.theme-toggle');
  ok((await theme()) === before, 'theme toggle switches back', await theme());
});

// =====================================================================================
await section('V3 filters for every category', async () => {
  const p = await newPage();
  for (const c of cats) {
    for (const deal of c.deals) {
      const base = `${BASE}/search?category=${c.key}&dealType=${deal}`;
      await p.goto(base);
      await p.waitForSelector('.filters-side app-filter-panel');
      await countMatchesApi(p, `${c.key}/${deal}`);
      const panel = p.locator('.filters-side');
      const sections = panel.locator('.fsec');
      // Walk every control of every filter section.
      const fields = c.fields.filter((f) => f.filter !== 'None' && (!f.onlyFor?.length || f.onlyFor.includes(deal)));
      for (const f of fields) {
        await p.goto(base);
        await p.waitForSelector('.filters-side .fsec');
        const tag = `${c.key}/${deal}/${f.key}`;
        current = 'V3 ' + tag;
        let expectParam;
        if (f.type === 'Boolean') {
          const short = f.label.replace(/\s*\(.*\)$/, '');
          const chip = panel.locator('.chip-toggle', { hasText: new RegExp(`^\\s*${short.replace(/[()]/g, '\\$&')}\\s*$`) }).last();
          if (!(await chip.count())) {
            ok(false, `${tag}: boolean chip present`, short);
            continue;
          }
          await chip.click();
          expectParam = [`f.${f.key}`, 'true'];
        } else if (f.filter === 'Range') {
          const from = panel.locator(`input[aria-label="${f.label} from"]`);
          if (!(await from.count())) {
            // Year ranges render as a select ("from").
            const sel = panel.locator('label.stack', { hasText: `${f.label} from` }).locator('select');
            if (await sel.count()) {
              const opts = await sel.locator('option').evaluateAll((o) => o.map((x) => x.value).filter(Boolean));
              await sel.selectOption(opts[Math.floor(opts.length / 2)]);
              expectParam = [`f.${f.key}.min`, opts[Math.floor(opts.length / 2)]];
            } else {
              ok(false, `${tag}: range inputs present`);
              continue;
            }
          } else {
            const v = f.type === 'Year' ? '2015' : String(Math.max(1, Math.round((f.min ?? 0) + 1)) * (f.key === 'mileageKm' ? 50000 : f.key.endsWith('M2') ? 50 : 1));
            await from.fill(v);
            await from.press('Enter');
            await from.blur();
            expectParam = [`f.${f.key}.min`, v];
          }
        } else if (f.filter === 'Min' && f.type === 'Year') {
          const sel = panel.locator('label.stack', { hasText: `${f.label} from` }).locator('select');
          await sel.selectOption('2000');
          expectParam = [`f.${f.key}.min`, '2000'];
        } else if (f.filter === 'Min') {
          const seg = panel.locator('.field-label', { hasText: new RegExp(`^${f.label}`) }).locator('xpath=following-sibling::div[1]');
          await seg.locator('button', { hasText: '2+' }).click();
          expectParam = [`f.${f.key}.min`, '2'];
        } else if (f.filter === 'Multi' || (f.filter === 'Exact' && f.type === 'Select' && f.options.length <= 3)) {
          const chips = panel.locator('.field-label', { hasText: new RegExp(`^${f.label}`) }).locator('xpath=following-sibling::div[1]');
          await chips.locator('.chip-toggle').first().click();
          await p.waitForURL(new RegExp(`f\\.${f.key}=`));
          await chips.locator('.chip-toggle').nth(1).click();
          expectParam = [`f.${f.key}`, `${f.options[0].value},${f.options[1].value}`];
        } else if (f.filter === 'Exact' && f.type === 'Select') {
          const sel = panel.locator('label.stack', { hasText: f.label }).locator('select');
          await sel.selectOption(f.options[0].value);
          expectParam = [`f.${f.key}`, f.options[0].value];
        } else if (f.filter === 'Contains') {
          const inp = panel.locator('label.stack', { hasText: f.label }).locator('input');
          await inp.fill('a');
          await inp.press('Enter');
          await inp.blur();
          expectParam = [`f.${f.key}`, 'a'];
        } else {
          ok(false, `${tag}: unknown control`, f);
          continue;
        }
        await p.waitForFunction(([k]) => new URL(location.href).searchParams.has(k), expectParam).catch(() => {});
        const u = new URL(p.url());
        ok(u.searchParams.get(expectParam[0]) === expectParam[1], `${tag}: control sets ${expectParam[0]}`, u.search);
        await countMatchesApi(p, tag);
        // An active chip appears and removing it clears the filter.
        const chipCount = await p.locator('.active-chip').count();
        ok(chipCount >= 1, `${tag}: active filter chip shown`);
        if (chipCount) {
          await p.locator('.active-chip').last().click();
          await p.waitForFunction(([k]) => !new URL(location.href).searchParams.has(k), expectParam).catch(() => {});
          ok(!new URL(p.url()).searchParams.has(expectParam[0]), `${tag}: chip removes filter`, p.url());
        }
      }
      // Price range
      await p.goto(base);
      await p.waitForSelector('.filters-side .fsec');
      await panel.locator('input[aria-label="Minimum price"]').fill('10');
      await panel.locator('input[aria-label="Minimum price"]').press('Tab');
      await panel.locator('input[aria-label="Maximum price"]').fill('100000');
      await panel.locator('input[aria-label="Maximum price"]').press('Tab');
      await p.waitForURL(/maxPrice=100000/);
      await countMatchesApi(p, `${c.key}/${deal} price`);
      ok((await p.locator('.active-chip', { hasText: '€' }).count()) === 1, `${c.key}/${deal}: price chip`);
      // Sorts offered
      const sorts = await p.locator('.results-tools select option').evaluateAll((o) => o.map((x) => x.value));
      for (const s of sorts) {
        await p.selectOption('.results-tools select', s);
        await settle(p);
        const u = new URL(p.url());
        ok(s === 'Newest' ? !u.searchParams.has('sort') : u.searchParams.get('sort') === s, `${c.key}/${deal}: sort ${s} in URL`);
        await countMatchesApi(p, `${c.key}/${deal} sort ${s}`);
      }
      // Seller filter
      await p.click('.filters-side .fsec:has(h3:text("Posted by")) button:has-text("Businesses")');
      await p.waitForURL(/seller=Business/);
      await countMatchesApi(p, `${c.key}/${deal} sellers`);
      // Clear all keeps category and deal
      await p.click('.active-chips .link:has-text("Clear all")');
      await p.waitForFunction(() => !new URL(location.href).searchParams.has('seller'));
      const u = new URL(p.url());
      ok(u.searchParams.get('category') === c.key && u.searchParams.get('dealType') === deal && !u.searchParams.has('minPrice'), `${c.key}/${deal}: clear all keeps category and deal`, u.search);
    }
  }
  // Category and deal pickers inside the panel
  await p.goto(`${BASE}/search?vertical=property`);
  await p.waitForSelector('.filters-side .fsec');
  for (const name of ['Apartments', 'Houses', 'Land', 'Commercial']) {
    await p.click(`.filters-side .chip-toggle:has-text("${name}")`);
    await p.waitForURL(/category=/);
    await countMatchesApi(p, `panel category ${name}`);
  }
  await p.click('.filters-side .chip-toggle:has-text("All")');
  await p.waitForFunction(() => !new URL(location.href).searchParams.has('category'));
  for (const d of ['For sale', 'Monthly rent', 'Per night']) {
    const b = p.locator('.filters-side .segmented button', { hasText: d }).first();
    if (await b.count()) {
      await b.click();
      await settle(p);
      await countMatchesApi(p, `panel deal ${d}`);
    } else ok(false, `deal button ${d} present`);
  }
});

// =====================================================================================
await section('V4 location box', async () => {
  const p = await newPage();
  await p.goto(`${BASE}/search`);
  const box = p.locator('.search-bar .loc-field input');
  // Accent-free typing, then a neighbourhood, then a village.
  const cases = [
    ['prishtine', 'Prishtinë', null],
    ['dragodan', 'Prishtinë', 'Arbëria (Dragodan)'],
    ['cagllavic', 'Graçanicë', 'Çagllavicë'],
    ['ferizaj', 'Ferizaj', null],
    ['brezovica', 'Shtërpcë', 'Brezovica'],
  ];
  for (const [typed, m, place] of cases) {
    await box.click();
    await p.keyboard.type(typed);
    await p.waitForSelector('.loc-list li');
    const hits = await p.locator('.loc-list li').allInnerTexts();
    const idx = hits.findIndex((h) => h.includes(place ? `${place}, ${m}` : m));
    ok(idx >= 0, `location "${typed}" finds ${place ?? m}`, hits.slice(0, 5));
    if (idx < 0) {
      await p.keyboard.press('Escape');
      continue;
    }
    await p.locator('.loc-list li').nth(idx).click();
    await p.waitForFunction((v) => document.querySelector('.search-bar .loc-field input').value.includes(v), place ?? m, { timeout: 3000 }).catch(() => {});
    const u = new URL(p.url());
    ok(u.searchParams.get('municipality') === m && (u.searchParams.get('place') ?? null) === place, `location "${typed}" sets URL`, u.search);
    ok((await box.inputValue()).includes(place ?? m), `location box shows ${place ?? m}`, await box.inputValue());
    await countMatchesApi(p, `location ${typed}`);
  }
  // Keyboard: arrow + enter
  await box.click();
  await p.keyboard.type('gjilan');
  await p.waitForSelector('.loc-list li');
  await p.keyboard.press('Enter');
  await p.waitForURL(/municipality=Gjilan/, { timeout: 3000 }).catch(() => {});
  ok(new URL(p.url()).searchParams.get('municipality') === 'Gjilan', 'enter picks the first hit');
  await p.waitForFunction(() => document.querySelector('.search-bar .loc-field input').value === 'Gjilan');
  // Escape drops typed text
  await box.click();
  await p.keyboard.type('zzz');
  await p.waitForSelector('.loc-list .none');
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => document.querySelector('.search-bar .loc-field input').value === 'Gjilan', null, { timeout: 3000 }).catch(() => {});
  ok((await box.inputValue()) === 'Gjilan', 'escape restores the chosen place', await box.inputValue());
  // Clicking outside also restores
  await box.click();
  await p.keyboard.type('xyz');
  await p.mouse.click(8, 700);
  await p.waitForFunction(() => document.querySelector('.search-bar .loc-field input').value === 'Gjilan', null, { timeout: 3000 }).catch(() => {});
  ok((await box.inputValue()) === 'Gjilan', 'clicking away restores the chosen place', await box.inputValue());
  ok(!(await p.locator('.loc-list').count()), 'clicking away closes the list');
  // Clear button
  await p.click('.search-bar .loc-field .clear');
  await p.waitForFunction(() => !new URL(location.href).searchParams.has('municipality'), null, { timeout: 3000 }).catch(() => {});
  ok(!new URL(p.url()).searchParams.has('municipality'), 'clear removes location');
  // "Anywhere in Kosovo" option
  await box.click();
  ok((await p.locator('.loc-list li').first().innerText()).includes('Anywhere'), 'list opens with Anywhere first');
  ok((await p.locator('.loc-list li').count()) === 39, 'empty box lists all 38 municipalities', await p.locator('.loc-list li').count());
  await p.keyboard.press('Escape');
  // Every municipality can be chosen and filtered.
  for (const m of locs) {
    await p.goto(`${BASE}/search?municipality=${encodeURIComponent(m.name)}`);
    await p.waitForSelector('.results-title');
    const t = await p.textContent('.results-title');
    ok(t.includes(m.name), `title for ${m.name}`, t);
  }
  // Breadcrumb-style place chip removal
  await p.goto(`${BASE}/search?municipality=Prizren&q=house`);
  await p.locator('.active-chip', { hasText: 'Prizren' }).click();
  await p.waitForFunction(() => !new URL(location.href).searchParams.has('municipality'), null, { timeout: 3000 }).catch(() => {});
  ok(!new URL(p.url()).searchParams.has('municipality') && new URL(p.url()).searchParams.get('q') === 'house', 'location chip clears only location');
});

// =====================================================================================
await section('V5 keyword, paging, map, intents', async () => {
  const p = await newPage();
  await p.goto(`${BASE}/search`);
  await p.waitForSelector('app-listing-card');
  const total = await countMatchesApi(p, 'everything');
  ok((await p.locator('.grid app-listing-card').count()) === Math.min(24, total), 'first page shows 24');
  if (total > 24) {
    await p.click('.load-more button');
    await p.waitForFunction((n) => document.querySelectorAll('.grid app-listing-card').length > n, 24);
    const n = await p.locator('.grid app-listing-card').count();
    ok(n === Math.min(48, total), 'show more appends the next page', n);
    const ids = await p.locator('.grid app-listing-card a.listing-card').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    ok(new Set(ids).size === ids.length, 'no duplicate cards after show more');
  }
  // Keyword
  await p.fill('.search-bar .kw input', 'villa');
  await p.press('.search-bar .kw input', 'Enter');
  await p.waitForURL(/q=villa/);
  await countMatchesApi(p, 'keyword villa');
  await p.fill('.search-bar .kw input', '');
  await p.press('.search-bar .kw input', 'Enter');
  await p.waitForFunction(() => !new URL(location.href).searchParams.has('q'));
  // Nothing matches
  await p.goto(`${BASE}/search?q=zzzzqqq`);
  await p.waitForSelector('.card.empty');
  ok((await p.textContent('.card.empty h2')).includes('No ads'), 'empty state');
  await p.click('.card.empty button:has-text("Clear filters")');
  await p.waitForFunction(() => !new URL(location.href).searchParams.has('q'));
  // Intent pills
  const pills = await p.locator('.intent-pill').count();
  for (let i = 0; i < pills; i++) {
    await p.locator('.intent-pill').nth(i).click();
    await settle(p);
    ok((await p.locator('.intent-pill.on').count()) === 1, `intent pill ${i} highlighted`);
    await countMatchesApi(p, `intent pill ${i}`);
  }
  // Intent pills keep the location
  await p.goto(`${BASE}/search?municipality=Prizren`);
  await p.click('.intent-pill:has-text("Stays")');
  await settle(p);
  ok(new URL(p.url()).searchParams.get('municipality') === 'Prizren', 'intent pill keeps location');
  // Map view
  await p.goto(`${BASE}/search?vertical=property`);
  await p.waitForSelector('app-listing-card');
  await p.click('.view-toggle button[aria-label="Map view"]');
  await p.waitForSelector('.map-panel .leaflet-marker-icon, .map-panel .price-pin, .map-panel .leaflet-interactive', { timeout: 10000 });
  const markers = await p.locator('.map-panel .leaflet-marker-icon').count();
  const pinsApi = await apiJson('/listings/map?vertical=property');
  ok(markers > 0 && markers <= pinsApi.length, 'map shows pins', { markers, api: pinsApi.length });
  await shot(p, 'v5-map');
  // Drag the map, then "Search this area"
  const box = await p.locator('.map-panel').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 80, { steps: 8 });
  await p.mouse.up();
  await p.waitForSelector('.map-search-here', { timeout: 5000 }).catch(() => {});
  ok(await p.locator('.map-search-here').count(), '"Search this area" appears after moving the map');
  if (await p.locator('.map-search-here').count()) {
    await p.click('.map-search-here');
    await p.waitForURL(/bbox=/);
    await countMatchesApi(p, 'map area');
    ok((await p.locator('.active-chip', { hasText: 'Map area' }).count()) === 1, 'map area chip');
  }
  // Clicking a pin highlights its card
  const marker = p.locator('.map-panel .leaflet-marker-icon').first();
  if (await marker.count()) {
    await marker.click({ force: true });
    await p.waitForTimeout(500);
    ok((await p.locator('.map-list app-listing-card.highlight').count()) === 1 || p.url().includes('/listings/'), 'pin click highlights card or opens ad');
  }
  await p.click('.view-toggle button[aria-label="List view"]').catch(() => {});
  // Save search logged out
  await p.goto(`${BASE}/search?category=cars`);
  await p.waitForSelector('app-listing-card');
  await p.click('button:has-text("Save search")');
  await p.waitForSelector('.save-box', { timeout: 3000 }).catch(() => {});
  ok((await p.locator('.save-box a:has-text("Log in")').count()) === 1, 'save search asks visitors to log in');
  const href = await p.locator('.save-box a:has-text("Log in")').getAttribute('href');
  ok(decodeURIComponent(href).includes('returnUrl=/search?category=cars'), 'save search login keeps return URL', href);
  // Bad URL params don't break the page
  await p.goto(`${BASE}/search?minPrice=abc&sort=Nope&category=boats&f.rooms.min=zz`);
  await p.waitForSelector('.results-title');
  ok(!(await p.locator('.results .error').count()), 'junk URL params handled', await p.locator('.results .error').textContent().catch(() => ''));
});

// =====================================================================================
await section('V6 ad pages', async () => {
  const p = await newPage();
  for (const c of cats) {
    for (const deal of c.deals) {
      const r = await apiJson(`/listings?category=${c.key}&dealType=${deal}&pageSize=1`);
      if (!r.items.length) continue;
      const ad = r.items[0];
      const tag = `${c.key}/${deal}`;
      await p.goto(`${BASE}/listings/${ad.id}`);
      await p.waitForSelector('.detail-title h1');
      ok((await p.textContent('.detail-title h1')).trim() === ad.title, `${tag}: title`);
      ok((await p.locator('.key-fact').count()) > 0, `${tag}: key facts`);
      ok((await p.locator('.dsec').count()) >= 2, `${tag}: spec sections`);
      const hasLegal = await p.locator('.legal-panel').count();
      const expectLegal = c.vertical === 'property' && deal !== 'RentNightly';
      ok(!!hasLegal === expectLegal, `${tag}: legal panel ${expectLegal ? 'shown' : 'hidden'}`);
      ok((await p.locator('.detail-map .leaflet-container').count()) === 1, `${tag}: map`);
      const bookable = deal === 'RentNightly' || deal === 'RentDaily';
      ok(!!(await p.locator('form.booking').count()) === bookable, `${tag}: booking form ${bookable ? 'shown' : 'hidden'}`);
      ok((await p.locator('.price-block .price').textContent()).match(/€|Salary on request/), `${tag}: price`);
      const crumbs = await p.locator('.crumbs a').count();
      ok(crumbs >= 3, `${tag}: breadcrumbs`);
      await shot(p, `v6-${c.key}-${deal}`, true);
    }
  }
  await galleryCheck(p);
  // Breadcrumbs go to filtered searches
  const anyAd = (await apiJson('/listings?category=apartments&pageSize=1')).items[0];
  await p.goto(`${BASE}/listings/${anyAd.id}`);
  await p.locator('.crumbs a').nth(2).click();
  await p.waitForURL(/municipality=/);
  await countMatchesApi(p, 'breadcrumb municipality');
  // Similar ads: open one, page state resets
  await p.goto(`${BASE}/listings/${anyAd.id}`);
  await p.waitForSelector('.detail-title h1');
  if (await p.locator('.section .rail app-listing-card').count()) {
    const first = await p.textContent('.detail-title h1');
    await p.locator('.section .rail app-listing-card a').first().click();
    await p.waitForFunction((t) => document.querySelector('.detail-title h1')?.textContent !== t, first);
    ok(true, 'similar ad opens');
    await p.waitForTimeout(300);
    ok((await p.evaluate(() => window.scrollY)) < 300, 'similar ad opens at the top', await p.evaluate(() => window.scrollY));
  } else ok(false, 'similar ads shown');
  // Phone (logged out)
  const withPhone = (await apiJson('/listings?pageSize=50')).items;
  for (const l of withPhone.slice(0, 15)) {
    const d = await apiJson(`/listings/${l.id}`);
    if (!d.owner.hasPhone) continue;
    await p.goto(`${BASE}/listings/${l.id}`);
    await p.click('button:has-text("Show phone number")');
    await p.waitForSelector('.contact-card a[href^="tel:"]');
    ok(true, 'phone reveal works logged out');
    break;
  }
  // Share copies the link
  await p.click('.title-actions button:has-text("Share")');
  await p.waitForTimeout(300);
  const shareText = await p.textContent('.title-actions button');
  ok(shareText.includes('Link copied') || shareText.includes('Share'), 'share button responds', shareText);
  // Messaging logged out goes to login and back
  const sale = (await apiJson('/listings?category=houses&dealType=Sale&pageSize=1')).items[0];
  await p.goto(`${BASE}/listings/${sale.id}`);
  ok((await p.inputValue('.contact-card textarea')).length > 10, 'message box prefilled');
  await p.click('.contact-card button:has-text("Send message")');
  await p.waitForURL(/\/login\?returnUrl=/);
  await p.fill('input[type=email]', 'seeker@demo.local');
  await p.fill('input[type=password]', 'Demo1234!');
  await p.click('form button[type=submit]');
  await p.waitForURL(new RegExp(`/listings/${sale.id}`));
  ok(true, 'login returns to the ad');
  // Unknown ad
  await p.goto(`${BASE}/listings/00000000-0000-0000-0000-000000000000`);
  expected4xx.add('GET /api/listings/:id 404');
  expected4xx.add('GET /api/listings/:id/similar 404');
  await p.waitForSelector('.card.empty h2');
  ok((await p.textContent('.card.empty h2')).includes('no longer available'), 'missing ad message');
});

// =====================================================================================
await section('V7 businesses', async () => {
  const p = await newPage();
  await p.goto(`${BASE}/businesses`);
  await p.waitForSelector('.business-tile');
  const all = await p.locator('.business-tile').count();
  const api = await apiJson('/businesses');
  ok(all === api.length, 'all businesses listed', { all, api: api.length });
  for (const kind of ['Real estate agency', 'Developer', 'Car dealer', 'Rent a car']) {
    const pill = p.locator('.intent-pill', { hasText: kind });
    if (!(await pill.count())) {
      ok(false, `kind pill ${kind}`);
      continue;
    }
    await pill.click();
    await settle(p);
    const tiles = await p.locator('.business-tile').count();
    ok(tiles >= 1, `kind ${kind} has businesses`, tiles);
  }
  await p.click('.intent-pill:has-text("All")');
  for (const b of api) {
    await p.goto(`${BASE}/businesses/${b.slug}`);
    await p.waitForSelector('.business-hero h1');
    ok((await p.textContent('.business-hero h1')).trim() === b.name, `business page ${b.slug}`);
    const cards = await p.locator('.grid app-listing-card').count();
    ok(cards === b.activeListings, `business ${b.slug} shows all ${b.activeListings} ads`, cards);
    const pills = await p.locator('.intent-pills .intent-pill').count();
    if (pills > 1) {
      await p.locator('.intent-pills .intent-pill').nth(1).click();
      ok((await p.locator('.grid app-listing-card').count()) <= cards, `business ${b.slug} category pill filters`);
    }
  }
  // Card links to business page from an ad
  const dealerAd = (await apiJson('/listings?seller=Business&pageSize=1')).items[0];
  await p.goto(`${BASE}/listings/${dealerAd.id}`);
  await p.click('.poster a');
  await p.waitForURL(/\/businesses\//);
  expected4xx.add('GET /api/businesses/nope-nope 404');
  expected4xx.add('GET /api/businesses/nope-nope/listings 404');
  await p.goto(`${BASE}/businesses/nope-nope`);
  await p.waitForSelector('.error');
  ok((await p.textContent('.error')).includes('doesn’t exist'), 'unknown business page message');
});

// =====================================================================================
await section('V8 routes and guards', async () => {
  const p = await newPage();
  for (const [from, to] of [
    ['/agencies', '/businesses'],
    ['/my-listings', '/login'],
    ['/whatever/nope', '/'],
  ]) {
    await p.goto(BASE + from);
    await settle(p);
    ok(new URL(p.url()).pathname === to, `${from} goes to ${to}`, p.url());
  }
  for (const guarded of ['/post', '/my-ads', '/favorites', '/saved-searches', '/messages', '/profile', '/admin']) {
    await p.goto(BASE + guarded);
    await settle(p);
    const u = new URL(p.url());
    ok(u.pathname === '/login' && u.searchParams.get('returnUrl') === guarded, `${guarded} needs login`, p.url());
  }
  // Admin page for a non-admin goes home
  await login(p, 'seeker@demo.local');
  await p.goto(`${BASE}/admin`);
  await settle(p);
  ok(new URL(p.url()).pathname === '/', 'non-admin cannot open moderation');
  await p.click('.avatar-btn');
  ok(!(await p.locator('.menu a:has-text("Moderation")').count()), 'no Moderation link for members');

  // A session that ended while the page was open: saving an ad sends you to log in, then back.
  for (const k of ['POST /api/listings 401', 'GET /api/auth/me 401', 'GET /api/me/conversations/unread 401']) expected4xx.add(k);
  await p.goto(`${BASE}/post`);
  await p.click('.pick:has-text("Land")');
  await p.route('**/api/listings', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 401, body: '' }) : r.continue()));
  await p.click('.wizard-foot .btn:has-text("Continue")').catch(() => {});
  if (await p.locator('.pick.wide').count()) {
    await p.locator('.pick.wide').first().click();
    await p.click('.wizard-foot .btn:has-text("Continue")');
  }
  await p.selectOption('.form-grid label.stack:has-text("Municipality") select', { label: 'Pejë' });
  await p.click('.wizard-foot .btn:has-text("Continue")');
  await fillDetails(p, cats.find((c) => c.key === 'land'), 'Sale');
  await p.fill('.fgroup:has(legend:text-is("Price and description")) .with-unit input', '30000');
  await p.click('button:has-text("Use suggestion")');
  await p.fill('textarea[maxlength="5000"]', 'A plot posted after the session ended, to test logging in again.');
  await p.click('.steps li:nth-child(5) button');
  await p.waitForURL((u) => u.pathname === '/login');
  await p.unroute('**/api/listings');
  ok(await p.locator('.notice:has-text("session ended")').isVisible(), 'ended session asks to log in again');
  ok(await p.locator('.login-link').count(), 'ended session shows logged out');
  await p.fill('input[type=email]', 'seeker@demo.local');
  await p.fill('input[type=password]', 'Demo1234!');
  await p.click('form button[type=submit]');
  await p.waitForURL((u) => u.pathname === '/post');
  ok(true, 'logging in again returns to the wizard');

  // A saved login whose account no longer exists is dropped on load.
  await p.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('prona.auth'));
    const [h, b] = s.token.split('.');
    s.token = `${h}.${b}.invalidsignature`;
    localStorage.setItem('prona.auth', JSON.stringify(s));
  });
  await p.goto(BASE);
  await p.waitForSelector('.login-link');
  ok(true, 'stale saved login is signed out on load');
});

// =====================================================================================
const posterEmail = `poster${stamp}@test.local`;
await section('A1 register and log in', async () => {
  const p = await newPage();
  await p.goto(`${BASE}/register`);
  const submit = p.locator('form button[type=submit]');
  await submit.waitFor();
  await p.waitForTimeout(200);
  ok(await submit.isDisabled(), 'register disabled when empty');
  await p.fill('input[formcontrolname=displayName]', 'Arta Poster');
  await p.fill('input[formcontrolname=email]', 'seeker@demo.local');
  await p.fill('input[formcontrolname=phone]', '+383 44 555 666');
  await p.fill('input[formcontrolname=password]', 'short');
  ok(await submit.isDisabled(), 'short password keeps register disabled');
  await p.fill('input[formcontrolname=password]', 'Demo1234!');
  expected4xx.add('POST /api/auth/register 409');
  expected4xx.add('POST /api/auth/register 400');
  await submit.click();
  await p.waitForSelector('form .error');
  ok((await p.textContent('form .error')).length > 5, 'duplicate email error shown', await p.textContent('form .error'));
  await p.fill('input[formcontrolname=email]', posterEmail);
  await submit.click();
  await p.waitForURL(BASE + '/');
  await p.waitForSelector('.avatar-btn');
  ok((await p.textContent('.avatar-btn')).trim() === 'A', 'logged in after register');
  await logout(p);
  // Wrong password
  await p.goto(`${BASE}/login`);
  await p.fill('input[type=email]', posterEmail);
  await p.fill('input[type=password]', 'Wrong1234!');
  expected4xx.add('POST /api/auth/login 401');
  expected4xx.add('POST /api/auth/login 400');
  await p.click('form button[type=submit]');
  await p.waitForSelector('form .error');
  ok(true, 'wrong password error shown');
  await p.fill('input[type=password]', 'Demo1234!');
  await p.click('form button[type=submit]');
  await p.waitForSelector('.avatar-btn');
  // Session survives a reload
  await p.reload();
  await p.waitForSelector('.avatar-btn');
  ok(true, 'still logged in after reload');
  // Account menu links
  await p.click('.avatar-btn');
  await p.waitForSelector('.menu [role=menuitem]');
  const items = await p.locator('.menu [role=menuitem]').allInnerTexts();
  ok(items.some((t) => t.includes('My ads')) && items.some((t) => t.includes('Saved searches')) && !items.some((t) => t.includes('business page')), 'member menu items', items);
  await p.click('.menu a:has-text("Saved searches")');
  await p.waitForURL(/saved-searches/);
  ok(!(await p.locator('.menu').count()), 'menu closes after navigating');
});

// =====================================================================================
/** Fill the wizard's details step from the category definition. */
async function fillDetails(p, c, deal) {
  const fields = c.fields.filter((f) => !f.onlyFor?.length || f.onlyFor.includes(deal));
  for (const f of fields) {
    const box = p.locator('.fgroup .stack').filter({ has: p.locator('.flabel', { hasText: new RegExp(`^${f.label.replace(/[()]/g, '\\$&')}( \\*)?$`) }) }).first();
    const toggle = p.locator('.fgroup .toggles .chip-toggle', { hasText: f.label }).first();
    if (f.type === 'Boolean') {
      if (f.group === 'Legal status') {
        if (await box.count()) await box.locator('.segmented button', { hasText: 'Yes' }).click();
      } else if (await toggle.count()) await toggle.click();
      continue;
    }
    if (!(await box.count())) {
      ok(false, `wizard field ${c.key}/${f.key} shown`);
      continue;
    }
    if (f.type === 'Select') {
      if (await box.locator('.chips').count()) await box.locator('.chip-toggle').first().click();
      else await box.locator('select').selectOption(f.options[1]?.value ?? f.options[0].value);
    } else if (f.type === 'Text') {
      const input = box.locator('input, textarea').first();
      await input.fill(f.key === 'model' ? 'Test model' : f.key === 'make' ? 'Yamaha' : 'Paperwork with the notary');
    } else {
      const val =
        f.type === 'Year' ? 2018
        : f.key === 'areaM2' ? 85
        : f.key === 'plotAreaM2' ? 400
        : f.key === 'maxGuests' ? 4
        : f.key === 'minNights' ? 2
        : f.key === 'mileageKm' ? 90000
        : f.key === 'floor' ? 3
        : f.key === 'engineCc' ? 1600
        : f.key === 'powerHp' ? 110
        : f.key === 'minDriverAge' ? 21
        : f.key === 'depositEur' ? 300
        : Math.max(f.min ?? 1, 2);
      await box.locator('input').fill(String(val));
    }
  }
}

await section('M1 post every kind of ad', async () => {
  const p = await newPage();
  await login(p, posterEmail);
  let first = true;
  for (const c of cats) {
    for (const deal of c.deals) {
      const tag = `${c.key}/${deal}`;
      await p.goto(`${BASE}/post`);
      await p.waitForSelector('.pick');
      if (first) {
        await p.click('.wizard-foot .btn:has-text("Continue")');
        ok((await p.textContent('.wizard-body .error')).includes('Pick a category'), 'wizard asks for a category');
      }
      await p.click(`.pick:has-text("${c.name}")`);
      await p.waitForSelector('.pick.wide');
      const dealButtons = p.locator('.pick.wide');
      const nDeals = await dealButtons.count();
      ok(nDeals === c.deals.length, `${tag}: deal options`, nDeals);
      if (c.deals.length > 1) await dealButtons.nth(c.deals.indexOf(deal)).click();
      await p.click('.wizard-foot .btn:has-text("Continue")');
      // Where
      await p.waitForSelector('h2:has-text("Where is it?")');
      if (first) {
        await p.click('.wizard-foot .btn:has-text("Continue")');
        ok((await p.textContent('.wizard-body .error')).includes('municipality'), 'wizard asks for a municipality');
      }
      const muni = c.vertical === 'vehicles' ? 'Ferizaj' : 'Prizren';
      await p.selectOption('.form-grid label.stack:has-text("Municipality") select', { label: muni });
      const placeOpts = await p.locator('.form-grid label.stack:has-text("Neighbourhood") select option').allTextContents();
      ok(placeOpts.length > 3, `${tag}: places listed for ${muni}`, placeOpts.length);
      await p.selectOption('.form-grid label.stack:has-text("Neighbourhood") select', { index: 2 });
      const place = (await p.locator('.form-grid label.stack:has-text("Neighbourhood") select option:checked').textContent()).trim();
      await p.fill('.form-grid input[maxlength="200"]', 'Near the square');
      const pinOn = await p.locator('.pin-toggle input').isChecked();
      ok(pinOn === (c.vertical === 'property'), `${tag}: exact pin default`, pinOn);
      if (pinOn) {
        await p.waitForSelector('.picker-map .leaflet-container');
        const mb = await p.locator('.picker-map').boundingBox();
        await p.mouse.click(mb.x + mb.width / 2 + 40, mb.y + mb.height / 2 + 20);
      }
      await p.click('.wizard-foot .btn:has-text("Continue")');
      // Details
      await p.waitForSelector('h2:has-text("Tell people about it")');
      if (first) {
        await p.click('.wizard-foot .btn:has-text("Save and add")');
        ok((await p.textContent('.wizard-body .error')).includes('Please fill in'), 'wizard lists missing fields');
      }
      await fillDetails(p, c, deal);
      const priceGroup = `.fgroup:has(legend:text-is("${deal === 'Job' ? 'Salary' : 'Price'} and description"))`;
      await p.fill(`${priceGroup} .with-unit input`, deal === 'Sale' ? '45000' : deal === 'RentMonthly' || deal === 'Job' ? '350' : '40');
      const unitText = await p.textContent(`${priceGroup} .with-unit .unit`);
      ok(deal === 'Sale' ? unitText.trim() === '€' : unitText.includes('/'), `${tag}: price unit`, unitText);
      if (await p.locator('button:has-text("Use suggestion")').count()) await p.click('button:has-text("Use suggestion")');
      else await p.fill('.title-input input', `Test ${c.name} ${deal}`);
      const title = await p.inputValue('.title-input input');
      ok(title.length >= 5, `${tag}: title suggested`, title);
      await p.fill('textarea[maxlength="5000"]', `Automated test ad for ${c.name}, ${deal}. Everything works and is in good condition.`);
      await p.click('.wizard-foot .btn:has-text("Save and add")');
      await p.waitForSelector('h2:has-text("Add photos")');
      ok(/\/my-ads\/[0-9a-f-]+\/edit$/.test(p.url()), `${tag}: URL becomes the edit URL after saving`, p.url());
      const id = p.url().split('/').at(-2);
      // Photos
      await p.setInputFiles('.upload-tile input[type=file]', [PHOTO, PHOTO, PHOTO]);
      await p.waitForFunction(() => document.querySelectorAll('.photo-tile').length === 3, null, { timeout: 20000 });
      ok(true, `${tag}: 3 photos uploaded`);
      if (first) {
        const before = await p.locator('.photo-tile img').evaluateAll((i) => i.map((x) => x.getAttribute('src')));
        await p.locator('.photo-tile').nth(0).locator('button[aria-label="Move right"]').click();
        await p.waitForFunction((b) => document.querySelectorAll('.photo-tile img')[0].getAttribute('src') === b, before[1]);
        ok(true, 'photo reorder');
        await p.locator('.photo-tile').nth(2).locator('button[aria-label="Delete photo"]').click();
        await p.waitForFunction(() => document.querySelectorAll('.photo-tile').length === 2);
        ok(true, 'photo delete');
        const d = await apiJson(`/listings/${id}`, await apiLogin(posterEmail));
        ok(d.photos.length === 2 && d.photos[0].thumbnailUrl === before[1], 'photo order saved on server', d.photos.map((x) => x.thumbnailUrl));
      }
      await p.click('.wizard-foot .btn:has-text("Continue")');
      // Review
      await p.waitForSelector('.checklist');
      const notOk = await p.locator('.checklist li:not(.ok)').allInnerTexts();
      ok(!notOk.length, `${tag}: review checklist all ticked`, notOk);
      ok((await p.locator('.review-card app-listing-card').count()) === 1, `${tag}: preview card`);
      await p.click('.wizard-foot .btn:has-text("Send for review")');
      await p.waitForSelector('.done h2');
      ok(true, `${tag}: sent for review`);
      // Server has what we typed
      const d = await apiJson(`/listings/${id}`, await apiLogin(posterEmail));
      ok(d.status === 'PendingReview' && d.municipality === muni && d.place === place && d.address === 'Near the square', `${tag}: saved location`, { m: d.municipality, p: d.place, place });
      const required = c.fields.filter((f) => f.required && (!f.onlyFor?.length || f.onlyFor.includes(deal)));
      ok(required.every((f) => d.attributes[f.key] !== undefined), `${tag}: required fields saved`, d.attributes);
      if (c.vertical === 'property') ok(Math.abs(d.lat - locs.find((m) => m.name === muni).lat) > 1e-6, `${tag}: exact pin saved`);
      posted.push({ id, key: c.key, deal, title: d.title });
      first = false;
    }
  }
  // "Post another" resets the wizard
  await p.click('.done a:has-text("Post another")');
  await p.waitForSelector('.pick');
  ok(!(await p.locator('.pick.on').count()), 'post another starts fresh');
  // A draft you leave keeps its place
  await p.click('.pick:has-text("Land")');
  await p.click('.wizard-foot .btn:has-text("Continue")').catch(() => {});
  if (await p.locator('.pick.wide').count()) {
    await p.locator('.pick.wide').first().click();
    await p.click('.wizard-foot .btn:has-text("Continue")');
  }
  await p.selectOption('.form-grid label.stack:has-text("Municipality") select', { label: 'Pejë' });
  await p.click('.wizard-foot .btn:has-text("Continue")');
  await fillDetails(p, cats.find((c) => c.key === 'land'), 'Sale');
  await p.fill('.fgroup:has(legend:text-is("Price and description")) .with-unit input', '30000');
  await p.click('button:has-text("Use suggestion")');
  await p.fill('textarea[maxlength="5000"]', 'A draft that is left without photos to test drafts.');
  // Jump straight to "Publish" from the step bar: it must save first.
  await p.click('.steps li:nth-child(5) button');
  await p.waitForSelector('.checklist');
  ok(/\/my-ads\/[0-9a-f-]+\/edit$/.test(p.url()), 'jumping ahead saves the draft', p.url());
  ok((await p.locator('.checklist li:not(.ok)').allInnerTexts()).some((t) => t.includes('photo')), 'review flags missing photo');
  ok(await p.locator('.wizard-foot .btn:has-text("Send for review")').isDisabled(), 'cannot send without a photo');
  posted.push({ id: p.url().split('/').at(-2), key: 'land', deal: 'Sale', draft: true });
});

// =====================================================================================
await section('M2 my ads', async () => {
  const p = await newPage();
  await login(p, posterEmail);
  await p.goto(`${BASE}/my-ads`);
  await p.waitForSelector('.row-item');
  const rows = await p.locator('.row-item').count();
  ok(rows === posted.length, 'my ads lists everything', { rows, posted: posted.length });
  await p.click('.tabs button:has-text("In review")');
  ok((await p.locator('.row-item').count()) === posted.filter((x) => !x.draft).length, 'in review tab');
  await p.click('.tabs button:has-text("Drafts")');
  ok((await p.locator('.row-item').count()) === 1, 'drafts tab');
  // A pending ad's page shows the owner banner and edit link
  await p.goto(`${BASE}/listings/${posted[0].id}`);
  await p.waitForSelector('.owner-banner');
  ok((await p.textContent('.owner-banner')).includes('review'), 'owner banner shows review status', await p.textContent('.owner-banner'));
  ok((await p.locator('.contact-card a:has-text("Edit your ad")').count()) === 1, 'owner sees edit instead of contact');
  ok(!(await p.locator('.title-actions button:has-text("Save")').count()), 'no favourite button on own ad');
});

// =====================================================================================
await section('AD1 moderation', async () => {
  const p = await newPage();
  await login(p, 'admin@demo.local', 'Admin1234!');
  await p.click('.avatar-btn');
  await p.click('.menu a:has-text("Moderation")');
  await p.waitForURL(/\/admin/);
  await p.waitForSelector('.stats');
  const pending = Number(await p.locator('.stat strong').first().textContent());
  ok(pending >= posted.filter((x) => !x.draft).length, 'stats count pending', pending);
  const queue = await p.locator('.row-item').count();
  ok(queue === pending, 'queue length matches stats', { queue, pending });
  // Reject the first, approve the rest of ours
  const toReject = posted[0];
  const row = p.locator('.row-item', { has: p.locator(`a[href="/listings/${toReject.id}"]`) }).first();
  await row.locator('button:has-text("Reject")').click();
  await row.locator('input.inline-input').fill('Please add a photo of the kitchen.');
  await row.locator('button:has-text("Send rejection")').click();
  await p.waitForFunction((id) => !document.querySelector(`.row-item a[href="/listings/${id}"]`), toReject.id);
  ok(true, 'reject removes from queue');
  for (const ad of posted.slice(1).filter((x) => !x.draft)) {
    const r = p.locator('.row-item', { has: p.locator(`a[href="/listings/${ad.id}"]`) }).first();
    await r.locator('button:has-text("Approve")').click();
    await p.waitForFunction((id) => !document.querySelector(`.row-item a[href="/listings/${id}"]`), ad.id);
  }
  ok(true, 'approved the rest');
  const after = Number(await p.locator('.stat strong').first().textContent());
  ok(after === pending - posted.filter((x) => !x.draft).length, 'stats update after moderation', { after, pending });
});

// =====================================================================================
await section('M3 owner after review', async () => {
  const p = await newPage();
  await login(p, posterEmail);
  await p.goto(`${BASE}/my-ads`);
  await p.click('.tabs button:has-text("Needs changes")');
  ok((await p.locator('.row-item').count()) === 1, 'rejected ad in Needs changes');
  await p.goto(`${BASE}/listings/${posted[0].id}`);
  await p.waitForSelector('.owner-banner');
  ok((await p.textContent('.owner-banner')).includes('kitchen'), 'moderator note shown to owner');
  await p.click('.owner-banner a:has-text("Edit ad")');
  await p.waitForSelector('h2:has-text("Tell people about it")');
  await p.fill('textarea[maxlength="5000"]', 'Updated after review: now with a better description of the kitchen and everything.');
  await p.click('.wizard-foot .btn:has-text("Save and add photos")');
  await p.waitForSelector('h2:has-text("Add photos")');
  await p.click('.wizard-foot .btn:has-text("Continue")');
  await p.click('.wizard-foot .btn:has-text("Send for review")');
  await p.waitForSelector('.done');
  ok(true, 'rejected ad resent');
  // Live ads are searchable with their own filters
  for (const ad of posted.slice(1).filter((x) => !x.draft)) {
    const d = await apiJson(`/listings/${ad.id}`);
    ok(d.status === 'Active', `${ad.key}/${ad.deal} live`, d.status);
    const s = await apiJson(`/listings?category=${ad.key}&dealType=${ad.deal}&municipality=${encodeURIComponent(d.municipality)}&place=${encodeURIComponent(d.place)}&pageSize=100`);
    ok(s.items.some((x) => x.id === ad.id), `${ad.key}/${ad.deal} found by location search`);
  }
  // Edit a live ad: notice, then it goes back to review
  const live = posted[1];
  await p.goto(`${BASE}/my-ads/${live.id}/edit`);
  await p.waitForSelector('h2:has-text("Tell people about it")');
  ok((await p.locator('.notice:has-text("This ad is live")').count()) === 1, 'live-edit notice shown');
  await p.fill('.fgroup:has(legend:text-is("Price and description")) .with-unit input', '41000');
  await p.click('.wizard-foot .btn:has-text("Save and add photos")');
  await p.waitForSelector('h2:has-text("Add photos")');
  await p.click('.wizard-foot .btn:has-text("Continue")');
  await p.waitForSelector('.checklist');
  ok((await p.locator('.notice:has-text("waiting for review")').count()) === 1, 'edited live ad says it is waiting for review');
  ok((await apiJson(`/listings/${live.id}`, await apiLogin(posterEmail))).status === 'PendingReview', 'edited live ad back in review');
  await apiPost(`/admin/listings/${live.id}/approve`, await apiLogin('admin@demo.local', 'Admin1234!'));
  // Mark sold
  const sold = posted.find((x) => x.key === 'commercial' && x.deal === 'Sale');
  await p.goto(`${BASE}/my-ads`);
  await p.click('.tabs button:has-text("Live")');
  const row = p.locator('.row-item', { has: p.locator(`a[href="/listings/${sold.id}"]`) }).first();
  await row.locator('button:has-text("Mark sold")').click();
  await p.click('.tabs button:has-text("Sold / rented")');
  await p.waitForSelector(`.row-item a[href="/listings/${sold.id}"]`);
  ok(true, 'mark sold moves to Sold / rented');
  // Delete the draft
  const draft = posted.find((x) => x.draft);
  await p.click('.tabs button:has-text("Drafts")');
  await p.locator('.row-item', { has: p.locator(`a[href="/listings/${draft.id}"]`) }).locator('button:has-text("Delete")').click();
  await p.waitForFunction((id) => !document.querySelector(`.row-item a[href="/listings/${id}"]`), draft.id);
  ok(true, 'delete removes draft');
  // Renew is offered only near expiry
  await p.click('.tabs button:has-text("Live")');
  ok(!(await p.locator('button:has-text("Renew")').count()), 'no renew on fresh ads');
});

// =====================================================================================
await section('S1 seeker: favourites, contact, booking, report, saved search', async () => {
  const p = await newPage();
  await login(p, 'seeker@demo.local');
  const car = posted.find((x) => x.key === 'cars' && x.deal === 'Sale');
  await galleryCheck(p);
  // Find the poster's car through the UI filters.
  await p.goto(`${BASE}/search?category=cars&dealType=Sale&municipality=Ferizaj`);
  await p.waitForSelector('app-listing-card');
  const card = p.locator('app-listing-card', { has: p.locator(`a[href="/listings/${car.id}"]`) }).first();
  ok(await card.count(), 'new car found in Ferizaj search');
  // Favourite from the card
  await Promise.all([p.waitForResponse((r) => r.url().includes('/api/me/favorites/') && r.request().method() === 'PUT'), card.locator('button.fav').click()]);
  ok((await card.locator('button.fav').getAttribute('aria-pressed')) === 'true', 'card heart turns on');
  ok(true, 'favourite from card');
  await p.goto(`${BASE}/favorites`);
  await p.waitForSelector('app-listing-card');
  ok((await p.locator(`app-listing-card a[href="/listings/${car.id}"]`).count()) === 1, 'favorites page lists it');
  // Detail favourite button reflects it and can undo
  await p.goto(`${BASE}/listings/${car.id}`);
  await p.waitForSelector('.title-actions');
  ok((await p.textContent('.title-actions')).includes('Saved'), 'detail shows Saved');
  await Promise.all([p.waitForResponse((r) => r.url().includes('/api/me/favorites/') && r.request().method() === 'DELETE'), p.click('.title-actions button:has-text("Saved")')]);
  await p.goto(`${BASE}/favorites`);
  await settle(p);
  ok(!(await p.locator(`app-listing-card a[href="/listings/${car.id}"]`).count()), 'unfavourite removes it');
  // Message the seller
  await p.goto(`${BASE}/listings/${car.id}`);
  await p.fill('.contact-card textarea', 'Hello, can I see it on Saturday?');
  await p.click('.contact-card button:has-text("Send message")');
  await p.waitForSelector('.contact-card .notice');
  await p.click('.contact-card .notice a');
  await p.waitForURL(/\/messages\//);
  await p.waitForSelector('.bubble.mine');
  ok((await p.textContent('.bubble.mine')).includes('Saturday'), 'conversation opens with my message');
  // Booking a stay
  const stay = posted.find((x) => x.deal === 'RentNightly' && x.key === 'apartments');
  await p.goto(`${BASE}/listings/${stay.id}`);
  await p.waitForSelector('form.booking');
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  await p.fill('form.booking input[name=from]', day(20));
  await p.fill('form.booking input[name=to]', day(21));
  ok((await p.locator('form.booking .error:has-text("Minimum stay")').count()) === 1, 'minimum nights warning');
  await p.fill('form.booking input[name=to]', day(23));
  ok((await p.textContent('.booking-total')).includes('× 3'), 'booking total for 3 nights', await p.textContent('.booking-total'));
  const guestOpts = await p.locator('form.booking select option').count();
  ok(guestOpts === 4, 'guest options follow max guests', guestOpts);
  await p.selectOption('form.booking select', { index: 1 });
  await p.fill('form.booking textarea', 'Arriving late');
  await p.click('form.booking button[type=submit]');
  await p.waitForSelector('form.booking .notice');
  await p.click('form.booking .notice a');
  await p.waitForSelector('.booking-card');
  const bc = await p.textContent('.booking-card');
  ok(bc.includes('3 nights') && bc.includes('2 guests') && bc.includes('120'), 'booking card in conversation', bc);
  // Rent-a-car request
  const rentCar = posted.find((x) => x.key === 'cars' && x.deal === 'RentDaily');
  await p.goto(`${BASE}/listings/${rentCar.id}`);
  await p.fill('form.booking input[name=from]', day(5));
  await p.fill('form.booking input[name=to]', day(9));
  ok((await p.textContent('.booking-total')).includes('× 4 days'), 'rent-a-car total', await p.textContent('.booking-total'));
  ok(!(await p.locator('form.booking select').count()), 'no guests for cars');
  await p.click('form.booking button[type=submit]');
  await p.waitForSelector('form.booking .notice');
  ok(true, 'rent-a-car request sent');
  // Report an ad
  const land = posted.find((x) => x.key === 'land');
  await p.goto(`${BASE}/listings/${land.id}`);
  await p.click('.report-link');
  await p.selectOption('.contact-col .card:has(h3:text-is("Report this ad")) select', 'Fraud');
  await p.fill('.contact-col .card:has(h3:text-is("Report this ad")) textarea', 'Asks for a deposit before viewing');
  await p.click('button:has-text("Send report")');
  await p.waitForSelector('.contact-col .notice:has-text("Thanks")');
  ok(true, 'report sent');
  // Save a search with filters, then use it
  await p.goto(`${BASE}/search?category=apartments&dealType=Sale&municipality=Prizren&f.rooms.min=2`);
  await p.click('button:has-text("Save search")');
  await p.fill('.save-box input', 'Prizren flats');
  await p.click('.save-box button[type=submit]');
  await p.waitForSelector('.save-box .notice');
  ok((await p.textContent('.save-box .notice')).startsWith('Saved'), 'search saved');
  await p.click('.avatar-btn');
  await p.click('.menu a:has-text("Saved searches")');
  await p.waitForSelector('.row-item');
  const saved = p.locator('.row-item', { hasText: 'Prizren flats' }).first();
  ok(await saved.count(), 'saved search listed');
  await saved.locator('input[type=checkbox]').click();
  await settle(p);
  const ss = await apiJson('/me/saved-searches', await apiLogin('seeker@demo.local'));
  ok(ss.find((x) => x.name === 'Prizren flats')?.emailAlerts === false, 'alerts toggled off');
  await saved.locator('a').click();
  await p.waitForURL(/\/search/);
  const u = new URL(p.url());
  ok(u.searchParams.get('municipality') === 'Prizren' && u.searchParams.get('f.rooms.min') === '2', 'saved search link restores filters', u.search);
  await p.goBack();
  await p.locator('.row-item', { hasText: 'Prizren flats' }).locator('button:has-text("Delete")').click();
  await p.waitForFunction(() => ![...document.querySelectorAll('.row-item')].some((r) => r.textContent.includes('Prizren flats')));
  ok(true, 'saved search deleted');
});

// =====================================================================================
await section('M4 poster inbox', async () => {
  const p = await newPage();
  await login(p, posterEmail);
  await p.waitForSelector('.header-actions .badge-count');
  ok(Number(await p.textContent('.header-actions .badge-count')) >= 3, 'unread badge', await p.textContent('.header-actions .badge-count'));
  await p.click('.header-actions a[aria-label="Messages"]');
  await p.waitForSelector('.conversation-list li a');
  const convs = await p.locator('.conversation-list li a').count();
  ok(convs >= 3, 'conversations listed', convs);
  ok((await p.locator('.conversation-list .unread').count()) >= 3, 'unread counts per conversation');
  const booking = p.locator('.conversation-list li a', { hasText: 'for 4 guests' }).first();
  await (await booking.count() ? booking : p.locator('.conversation-list li a').first()).click();
  await p.waitForSelector('.bubble');
  await p.fill('.composer textarea', 'Yes, those dates are free!');
  await p.press('.composer textarea', 'Enter');
  await p.waitForSelector('.bubble.mine:has-text("those dates are free")');
  ok(true, 'reply with Enter');
  await p.fill('.composer textarea', 'line one');
  await p.press('.composer textarea', 'Shift+Enter');
  await p.type('.composer textarea', 'line two');
  ok((await p.inputValue('.composer textarea')).includes('\n'), 'shift+enter adds a line');
  await p.click('.composer button[type=submit]');
  await p.waitForSelector('.bubble.mine:has-text("line two")');
  await p.goto(BASE);
  await settle(p);
  const badge = await p.locator('.header-actions .badge-count').count();
  ok(badge === 0 || Number(await p.textContent('.header-actions .badge-count')) < 3, 'badge drops after reading');
  // Seeker sees the reply
  const s = await newPage();
  await login(s, 'seeker@demo.local');
  await s.goto(`${BASE}/messages`);
  await s.waitForSelector('.conversation-list li a');
  await s.locator('.conversation-list li a', { hasText: 'line two' }).first().click();
  await s.waitForSelector('.bubble:not(.mine):has-text("those dates are free")', { timeout: 5000 }).catch(() => {});
  ok(await s.locator('.bubble:not(.mine):has-text("those dates are free")').count(), 'seeker sees the reply');
  // A new reply shows up while the conversation is open.
  const convId = s.url().split('/').at(-1);
  const tp = await apiLogin(posterEmail);
  await apiPost(`/conversations/${convId}/messages`, tp, { body: 'Live update check' });
  await s.waitForSelector('.bubble:not(.mine):has-text("Live update check")', { timeout: 25000 }).catch(() => {});
  ok(await s.locator('.bubble:not(.mine):has-text("Live update check")').count(), 'new replies appear without reloading');
});

// =====================================================================================
await section('AD2 reports', async () => {
  const p = await newPage();
  await login(p, 'admin@demo.local', 'Admin1234!');
  await p.goto(`${BASE}/admin`);
  await p.click('.tabs button:has-text("Reports")');
  const land = posted.find((x) => x.key === 'land');
  const row = p.locator('.row-item', { has: p.locator(`a[href="/listings/${land.id}"]`) }).first();
  await row.waitFor();
  ok((await row.textContent()).includes('deposit'), 'report comment shown');
  await row.locator('button:has-text("Take listing down")').click();
  await p.waitForFunction((id) => !document.querySelector(`.row-item a[href="/listings/${id}"]`), land.id);
  const d = await fetch(`${API}/listings/${land.id}`);
  ok(d.status === 404, 'taken-down ad is hidden', d.status);
  const mine = await apiJson(`/listings/${land.id}`, await apiLogin(posterEmail));
  ok(mine.status === 'Rejected' && !!mine.moderationNote, 'owner sees why it was taken down', mine);
});

// =====================================================================================
await section('B1 business account', async () => {
  const p = await newPage();
  await p.goto(`${BASE}/register`);
  await p.click('label.role:has-text("Business")');
  await p.fill('input[formcontrolname=businessName]', `Auto Rent ${stamp}`);
  await p.selectOption('select[formcontrolname=businessKind]', { label: 'Rent a car' });
  await p.selectOption('select[formcontrolname=municipality]', 'Gjakovë');
  await p.fill('input[formcontrolname=displayName]', 'Besa Rent');
  await p.fill('input[formcontrolname=email]', `rent${stamp}@test.local`);
  await p.fill('input[formcontrolname=phone]', '+383 45 222 333');
  await p.fill('input[formcontrolname=password]', 'Demo1234!');
  await p.click('form button[type=submit]');
  await p.waitForURL(/\/post$/);
  ok(true, 'business lands on post');
  await p.click('.avatar-btn');
  await p.click('.menu a:has-text("My business page")');
  await p.waitForSelector('.business-hero h1');
  ok((await p.textContent('.business-hero h1')).includes('Auto Rent'), 'business page');
  ok((await p.textContent('.business-hero .kicker')).includes('Rent a car'), 'business kind');
  // Edit business profile
  await p.goto(`${BASE}/profile`);
  await p.waitForSelector('form:has(h2:has-text("Business page"))');
  const f = p.locator('form:has(h2:has-text("Business page"))');
  await f.locator('input[formcontrolname=address]').fill('Rr. Nëna Terezë 5');
  await f.locator('input[formcontrolname=website]').fill('https://example.com');
  await f.locator('textarea').fill('Airport delivery 24/7.');
  await f.locator('button[type=submit]').click();
  await f.locator('.notice').waitFor();
  ok((await f.locator('.notice').textContent()).includes('Saved'), 'business page saved');
  await f.locator('a').first().click();
  await p.waitForSelector('.business-hero .about');
  ok((await p.textContent('.business-hero .about')).includes('Airport'), 'business page shows description');
  ok((await p.locator('.business-contact a:has-text("Website")').count()) === 1, 'website link');
  ok((await p.locator('.business-contact a[href^="tel:"]').count()) === 1, 'phone shown on business page');
  // Listed under its kind
  await p.goto(`${BASE}/businesses`);
  await p.click('.intent-pill:has-text("Rent a car")');
  await p.waitForSelector(`.business-tile:has-text("Auto Rent ${stamp}")`);
  ok(true, 'listed under Rent a car');
  // Bad website shows an error
  await p.goto(`${BASE}/profile`);
  const f2 = p.locator('form:has(h2:has-text("Business page"))');
  await f2.locator('input[formcontrolname=website]').fill('javascript:alert(1)');
  expected4xx.add('PUT /api/me/business 400');
  await f2.locator('button[type=submit]').click();
  await f2.locator('.notice').waitFor();
  ok(!(await f2.locator('.notice').textContent()).startsWith('Saved'), 'bad website rejected', await f2.locator('.notice').textContent());
});

// =====================================================================================
await section('P1 profile', async () => {
  const p = await newPage();
  await login(p, posterEmail);
  await p.goto(`${BASE}/profile`);
  await p.fill('input[formcontrolname=displayName]', 'Arta P.');
  await p.fill('input[formcontrolname=phone]', '+383 44 999 000');
  await p.click('form:first-of-type button[type=submit]');
  await p.waitForSelector('.notice');
  await p.reload();
  await p.waitForSelector('input[formcontrolname=displayName]');
  ok((await p.inputValue('input[formcontrolname=displayName]')) === 'Arta P.', 'name saved');
  ok((await p.inputValue('input[formcontrolname=phone]')) === '+383 44 999 000', 'phone saved');
  await p.click('.avatar-btn');
  ok((await p.textContent('.menu-head')).includes('Arta P.'), 'menu shows new name');
  await p.click('.menu button:has-text("Log out")');
  await p.waitForSelector('.login-link');
  await p.goto(`${BASE}/my-ads`);
  await p.waitForURL(/\/login/);
  ok(true, 'logged out');
});

// =====================================================================================
await section('MOB phone', async () => {
  const p = await newPage({ mobile: true });
  const check = async (path, label) => {
    await p.goto(BASE + path);
    await settle(p);
    await p.waitForTimeout(300);
    await noHorizontalScroll(p, label);
    await shot(p, `mob-${label}`);
  };
  await check('/', 'home');
  ok(await p.locator('.tabbar').isVisible(), 'tab bar visible on phone');
  ok(!(await p.locator('.main-nav').isVisible()), 'desktop nav hidden on phone');
  await check('/search?vertical=vehicles', 'search');
  ok(!(await p.locator('.filters-side').isVisible()), 'sidebar hidden on phone');
  await p.click('.filters-btn');
  await p.waitForSelector('.drawer');
  await noHorizontalScroll(p, 'drawer');
  await p.locator('.drawer .chip-toggle', { hasText: 'Cars' }).click();
  await p.waitForURL(/category=cars/);
  await p.waitForTimeout(800);
  const showBtn = await p.textContent('.drawer-foot .btn');
  await p.click('.drawer-foot .btn');
  ok(!(await p.locator('.drawer').count()), 'drawer closes');
  const n = await countMatchesApi(p, 'mobile drawer');
  ok(showBtn.includes(String(n)), 'drawer button shows result count', showBtn);
  await p.click('.filters-btn');
  await p.locator('.drawer .fsec:has(h3:text("Posted by")) button', { hasText: 'Private' }).click();
  await p.waitForURL(/seller=Private/);
  await p.click('.drawer-foot .btn');
  ok(/\d/.test(await p.textContent('.filters-btn')), 'filters button shows how many filters are on', await p.textContent('.filters-btn'));
  // Ad page with sticky contact bar
  const ad = (await apiJson('/listings?dealType=RentNightly&pageSize=1')).items[0];
  await check(`/listings/${ad.id}`, 'ad');
  ok(await p.locator('.mobile-cta').isVisible(), 'mobile contact bar');
  await p.click('.mobile-cta .btn');
  await p.waitForTimeout(800);
  const top = await p.evaluate(() => document.getElementById('contact').getBoundingClientRect().top);
  ok(top < 400, 'check dates scrolls to booking box', top);
  const ctaBox = await p.locator('.mobile-cta').boundingBox();
  const tabBox = await p.locator('.tabbar').boundingBox();
  ok(!tabBox || !ctaBox || ctaBox.y + ctaBox.height <= tabBox.y + 1 || !(await p.locator('.tabbar').isVisible()), 'contact bar not under tab bar', { ctaBox, tabBox });
  await check('/businesses', 'businesses');
  // Logged-in pages
  await login(p, posterEmail);
  for (const [path, label] of [
    ['/my-ads', 'my-ads'],
    ['/messages', 'messages'],
    ['/favorites', 'favorites'],
    ['/saved-searches', 'saved'],
    ['/profile', 'profile'],
    ['/post', 'post'],
  ])
    await check(path, label);
  // Messages: list then thread
  await p.goto(`${BASE}/messages`);
  await p.waitForSelector('.conversation-list li a');
  await p.locator('.conversation-list li a').first().click();
  await p.waitForSelector('.composer');
  ok(!(await p.locator('.conversation-list').isVisible()), 'thread replaces list on phone');
  await noHorizontalScroll(p, 'thread');
  await p.click('.thread-head .back');
  await p.waitForSelector('.conversation-list');
  ok(await p.locator('.conversation-list').isVisible(), 'back to list');
  // Wizard on phone: all steps fit
  await p.goto(`${BASE}/post`);
  await p.click('.pick:has-text("Cars")');
  await p.locator('.pick.wide').first().click();
  await p.click('.wizard-foot .btn:has-text("Continue")');
  await noHorizontalScroll(p, 'wizard where');
  await p.selectOption('.form-grid label.stack:has-text("Municipality") select', { label: 'Pejë' });
  await p.click('.wizard-foot .btn:has-text("Continue")');
  await p.waitForSelector('h2:has-text("Tell people about it")');
  await noHorizontalScroll(p, 'wizard details');
  await shot(p, 'mob-wizard-details', true);
  // Tab bar navigation
  for (const [label, path] of [
    ['Home', '/'],
    ['Search', '/search'],
    ['Post', '/post'],
    ['Messages', '/messages'],
    ['My ads', '/my-ads'],
  ]) {
    await p.click(`.tabbar a:has-text("${label}")`);
    await p.waitForURL((u) => u.pathname === path);
    ok((await p.locator('.tabbar a.active').count()) === 1, `tab ${label} active`);
  }
});

// =====================================================================================
await section('J1 jobs: apply with a CV, employer reviews', async () => {
  const jobs = await apiJson('/listings?vertical=jobs&pageSize=50');
  const job = jobs.items.find((j) => j.title === 'Junior .NET developer');
  ok(!!job, 'seeded job found');
  const p = await newPage();
  await p.goto(`${BASE}/search?vertical=jobs`);
  const n = await countMatchesApi(p, 'jobs search');
  ok(n >= 10, 'jobs listed', n);
  await p.goto(`${BASE}/search?vertical=jobs&category=jobs&f.workplace=Remote`);
  const remote = await countMatchesApi(p, 'remote jobs');
  ok(remote >= 1, 'remote filter', remote);
  // A visitor is asked to log in.
  await p.goto(`${BASE}/listings/${job.id}`);
  await p.waitForSelector('.contact-card');
  ok(await p.locator('.contact-card a:has-text("Log in to apply")').count(), 'visitor asked to log in to apply');
  ok((await p.textContent('.contact-card .price')).includes('month'), 'salary per month shown');
  // The seeker applies; this job asks for a CV.
  await login(p, 'seeker@demo.local');
  await p.goto(`${BASE}/listings/${job.id}`);
  await p.waitForSelector('.apply-form');
  const send = p.locator('.apply-form button[type=submit]');
  await p.fill('.apply-form textarea', 'Hello! I studied computer science in Prishtina and built two ASP.NET Core APIs for my thesis.');
  ok(await send.isDisabled(), 'CV required before sending');
  await p.setInputFiles('.apply-form input[type=file]', CV);
  ok(!(await send.isDisabled()), 'can send once a CV is attached');
  await send.click();
  await p.waitForSelector('.applied-box');
  ok((await p.textContent('.applied-box')).includes('Sent'), 'applied box shows the status');
  await p.reload();
  await p.waitForSelector('.applied-box');
  ok(true, 'applied state survives a reload');
  await p.click('.applied-box a:has-text("All my applications")');
  await p.waitForSelector('.application');
  ok((await p.textContent('.application')).includes('Junior .NET developer'), 'my applications lists the job');
  const [own] = await Promise.all([p.waitForEvent('download'), p.click('.application button:has-text("cv.pdf")')]);
  ok(own.suggestedFilename() === 'cv.pdf', 'applicant can download their CV', own.suggestedFilename());
  await logout(p);
  // The employer reviews applicants.
  await login(p, 'company@demo.local');
  await p.goto(`${BASE}/my-ads`);
  await p.click('.row-item:has-text("Junior .NET developer") a:has-text("Applicants")');
  await p.waitForSelector('.applicant');
  ok((await p.textContent('.applicant')).includes('Drita Berisha'), 'employer sees the applicant');
  const [cv] = await Promise.all([p.waitForEvent('download'), p.click('.applicant button:has-text("cv.pdf")')]);
  ok(fs.readFileSync(await cv.path()).subarray(0, 4).toString() === '%PDF', 'employer downloads the CV');
  await p.click('.applicant button:has-text("Shortlist")');
  await p.waitForSelector('.applicant .app-status[data-status="Shortlisted"]');
  ok(true, 'employer shortlists');
  await p.click('.tabs button:has-text("Shortlisted")');
  ok((await p.locator('.applicant').count()) === 1, 'shortlisted filter');
  await p.click('.applicant a:has-text("Message")');
  await p.waitForSelector('.message-application');
  ok((await p.textContent('.message-application')).includes('cv.pdf'), 'application shows in the inbox with the CV');
  await logout(p);
  // Someone else can't see the applicants or the CV.
  await login(p, 'seller@demo.local');
  await p.goto(`${BASE}/my-ads/${job.id}/applicants`);
  await p.waitForSelector('.error');
  ok((await p.textContent('.error')).includes('isn’t yours'), 'other users cannot see applicants');
  await logout(p);
  // The applicant sees the update.
  await login(p, 'seeker@demo.local');
  await p.goto(`${BASE}/my-applications`);
  await p.waitForSelector('.application .app-status');
  ok((await p.textContent('.application .app-status')).includes('Shortlisted'), 'applicant sees they were shortlisted');
});

await browser.close();
