// API sweep against a freshly seeded dev database: every filter of every category, sorting, paging, locations, permissions and lifecycle.
const API = process.env.API_URL ?? 'http://localhost:5102/api';
const results = { pass: 0, fail: [] };
process.on('exit', () => { console.log(`\nPASS ${results.pass}  FAIL ${results.fail.length}`); for (const f of results.fail) console.log('  ✗ ' + f); });
const ok = (cond, name, extra) => {
  if (cond) results.pass++;
  else results.fail.push(extra ? `${name} :: ${typeof extra === 'string' ? extra : JSON.stringify(extra).slice(0, 400)}` : name);
};

async function call(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const r = await fetch(API + path, { method, headers, body: payload });
  const text = await r.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { status: r.status, json, text };
}
const get = (p, o) => call('GET', p, o);
const post = (p, body, o = {}) => call('POST', p, { ...o, body });
const put = (p, body, o = {}) => call('PUT', p, { ...o, body });
const del = (p, o) => call('DELETE', p, o);

async function login(email, password = 'Demo1234!') {
  const r = await post('/auth/login', { email, password });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${r.text}`);
  return r.json.token;
}

const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '')).toString();
async function searchAll(params) {
  const r = await get(`/listings?${qs({ ...params, pageSize: 100 })}`);
  if (r.status !== 200) throw new Error(`search ${qs(params)} -> ${r.status} ${r.text}`);
  return r.json;
}

// ---------- Meta ----------
const cats = (await get('/meta/categories')).json;
const locs = (await get('/meta/locations')).json;
ok(cats.length === 7, 'meta: 7 categories', cats.map((c) => c.key));
ok(locs.length === 38, 'meta: 38 municipalities', locs.length);
const placeCount = locs.reduce((n, m) => n + m.places.length, 0);
ok(placeCount > 500, 'meta: >500 places', placeCount);
for (const m of locs) {
  ok(m.lat > 41.8 && m.lat < 43.3 && m.lng > 20 && m.lng < 21.8, `meta: ${m.name} centre inside Kosovo`, [m.lat, m.lng]);
  const names = m.places.map((p) => p.name);
  ok(new Set(names).size === names.length, `meta: ${m.name} has no duplicate places`, names.filter((n, i) => names.indexOf(n) !== i));
}

// ---------- Everything / totals ----------
const all = await searchAll({});
ok(all.total > 50, 'search: seeded ads present', all.total);
const totalByCat = {};
for (const c of cats) {
  const r = await searchAll({ category: c.key });
  totalByCat[c.key] = r.total;
  ok(r.items.every((l) => l.category === c.key), `search: category=${c.key} only returns that category`);
  const live = c.live.reduce((n, x) => n + x.count, 0);
  ok(live === r.total, `meta live count matches search for ${c.key}`, { live, total: r.total });
  for (const d of c.deals) {
    const rd = await searchAll({ category: c.key, dealType: d });
    ok(rd.items.every((l) => l.dealType === d), `search: ${c.key}/${d} deal filter`);
    ok(rd.total === (c.live.find((x) => x.deal === d)?.count ?? 0), `meta live count per deal ${c.key}/${d}`, { search: rd.total, meta: c.live });
  }
}
ok(Object.values(totalByCat).reduce((a, b) => a + b, 0) === all.total, 'search: categories add up to total');
for (const v of ['property', 'vehicles']) {
  const r = await searchAll({ vertical: v });
  const keys = cats.filter((c) => c.vertical === v).map((c) => c.key);
  ok(r.items.every((l) => keys.includes(l.category)), `search: vertical=${v}`);
}
const stays = await searchAll({ dealType: 'RentNightly' });
ok(stays.total > 0 && stays.items.every((l) => l.dealType === 'RentNightly'), 'search: stays across categories');

// ---------- Paging ----------
{
  const p1 = (await get('/listings?page=1&pageSize=5')).json;
  const p2 = (await get('/listings?page=2&pageSize=5')).json;
  ok(p1.items.length === 5 && p2.items.length === 5, 'paging: page sizes');
  ok(!p1.items.some((a) => p2.items.some((b) => b.id === a.id)), 'paging: no overlap between pages');
  const huge = await get('/listings?pageSize=100000');
  ok(huge.status === 200 && huge.json.items.length <= 100, 'paging: pageSize is capped', huge.json?.items.length);
  const neg = await get('/listings?page=-3&pageSize=-1');
  ok(neg.status === 200 || neg.status === 400, 'paging: negative values handled', neg.status);
}

// ---------- Price + keyword + seller ----------
{
  const r = await searchAll({ minPrice: 100, maxPrice: 500 });
  ok(r.items.every((l) => l.priceEur >= 100 && l.priceEur <= 500), 'price range filter');
  const q = await searchAll({ q: 'golf' });
  ok(q.total > 0, 'keyword: golf finds the Golf', q.total);
  const qi = await searchAll({ q: 'GOLF' });
  ok(qi.total === q.total, 'keyword: case-insensitive');
  const pct = await get('/listings?q=%25');
  ok(pct.status === 200 && pct.json.total === 0, 'keyword: % is literal', pct.json?.total);
  const biz = await searchAll({ seller: 'Business' });
  const priv = await searchAll({ seller: 'Private' });
  ok(biz.items.every((l) => l.seller.isBusiness) && priv.items.every((l) => !l.seller.isBusiness), 'seller filter');
  ok(biz.total + priv.total === all.total, 'seller filters add up');
}

// ---------- Locations: every municipality and every place used by ads ----------
{
  let muniHits = 0;
  for (const m of locs) {
    const r = await searchAll({ municipality: m.name });
    ok(r.items.every((l) => l.municipality === m.name), `location: municipality ${m.name}`);
    if (r.total) muniHits++;
  }
  ok(muniHits >= 10, 'location: ads spread over municipalities', muniHits);
  const places = [...new Set(all.items.filter((l) => l.place).map((l) => `${l.municipality}|${l.place}`))];
  for (const key of places) {
    const [m, p] = key.split('|');
    const r = await searchAll({ municipality: m, place: p });
    ok(r.total > 0 && r.items.every((l) => l.place === p), `location: place ${p}, ${m}`);
  }
  const bogus = await get('/listings?municipality=Atlantis');
  ok(bogus.status === 200 && bogus.json.total === 0, 'location: unknown municipality returns nothing');
}

// ---------- Field filters for every category ----------
for (const c of cats) {
  for (const deal of [null, ...c.deals]) {
    const base = { category: c.key, dealType: deal };
    const pool = (await searchAll(base)).items;
    for (const f of c.fields.filter((x) => x.filter !== 'None')) {
      if (deal && f.onlyFor?.length && !f.onlyFor.includes(deal)) continue;
      const values = pool.map((l) => l.attributes[f.key]).filter((v) => v !== undefined && v !== null);
      const label = `${c.key}/${deal ?? 'any'}/${f.key}`;
      if (['Number', 'Integer', 'Year'].includes(f.type)) {
        if (!values.length) continue;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = sorted[Math.floor(sorted.length / 2)];
        const lo = await searchAll({ ...base, [`f.${f.key}.min`]: mid });
        const expectLo = pool.filter((l) => l.attributes[f.key] >= mid).length;
        ok(lo.total === expectLo && lo.items.every((l) => l.attributes[f.key] >= mid), `filter min ${label}>=${mid}`, { got: lo.total, expectLo });
        const hi = await searchAll({ ...base, [`f.${f.key}.max`]: mid });
        const expectHi = pool.filter((l) => l.attributes[f.key] <= mid).length;
        ok(hi.total === expectHi, `filter max ${label}<=${mid}`, { got: hi.total, expectHi });
        const both = await searchAll({ ...base, [`f.${f.key}.min`]: sorted[0], [`f.${f.key}.max`]: sorted[sorted.length - 1] });
        ok(both.total === values.length, `filter range ${label} covers all with a value`, { got: both.total, n: values.length });
        const junk = await get(`/listings?${qs({ ...base, [`f.${f.key}.min`]: 'abc' })}`);
        ok(junk.status === 200 && junk.json.total === pool.length, `filter junk number ignored ${label}`);
      } else if (f.type === 'Boolean') {
        const t = await searchAll({ ...base, [`f.${f.key}`]: 'true' });
        ok(t.total === pool.filter((l) => l.attributes[f.key] === true).length, `filter bool true ${label}`, t.total);
        const fl = await searchAll({ ...base, [`f.${f.key}`]: 'false' });
        ok(fl.total === pool.filter((l) => l.attributes[f.key] === false).length, `filter bool false ${label}`, fl.total);
      } else if (f.type === 'Select') {
        const opts = (f.options ?? []).map((o) => o.value);
        for (const v of [...new Set(values)]) ok(opts.includes(v), `seed value valid ${label}=${v}`);
        if (!values.length) continue;
        const pick = [...new Set(values)].slice(0, 2);
        const r = await searchAll({ ...base, [`f.${f.key}`]: pick.join(',') });
        ok(r.total === pool.filter((l) => pick.includes(l.attributes[f.key])).length, `filter select ${label} in ${pick}`, r.total);
      } else if (f.type === 'Text') {
        if (!values.length) continue;
        const frag = String(values[0]).slice(1, 4).toLowerCase();
        const r = await searchAll({ ...base, [`f.${f.key}`]: frag });
        ok(r.total === pool.filter((l) => String(l.attributes[f.key] ?? '').toLowerCase().includes(frag)).length, `filter contains ${label}~${frag}`, r.total);
      }
    }
  }
}
// Vertical-wide shared filters (e.g. year across all vehicles)
{
  const pool = (await searchAll({ vertical: 'vehicles' })).items;
  const r = await searchAll({ vertical: 'vehicles', 'f.year.min': 2018 });
  ok(r.total === pool.filter((l) => l.attributes.year >= 2018).length, 'vertical filter: vehicles year>=2018', r.total);
  const s = await searchAll({ dealType: 'RentNightly', 'f.maxGuests.min': 4 });
  const sp = (await searchAll({ dealType: 'RentNightly' })).items;
  ok(s.total === sp.filter((l) => l.attributes.maxGuests >= 4).length, 'stays filter: guests>=4 without category', { got: s.total });
  const unknown = await searchAll({ category: 'cars', 'f.nonsense': 'x' });
  ok(unknown.total === totalByCat.cars, 'unknown filter key ignored');
}

// ---------- Sorting ----------
const sortCheck = async (params, sort, key, dir) => {
  const items = (await searchAll({ ...params, sort })).items;
  const vals = items.map(key).filter((v) => v !== null && v !== undefined);
  const okOrder = vals.every((v, i) => i === 0 || (dir > 0 ? vals[i - 1] <= v : vals[i - 1] >= v));
  ok(okOrder, `sort ${sort} ${JSON.stringify(params)}`, vals.slice(0, 10));
};
await sortCheck({}, 'PriceAsc', (l) => l.priceEur, 1);
await sortCheck({}, 'PriceDesc', (l) => l.priceEur, -1);
await sortCheck({ category: 'apartments', dealType: 'Sale' }, 'PricePerM2Asc', (l) => l.pricePerM2, 1);
await sortCheck({ vertical: 'vehicles' }, 'YearDesc', (l) => l.attributes.year, -1);
await sortCheck({ category: 'cars', dealType: 'Sale' }, 'MileageAsc', (l) => l.attributes.mileageKm, 1);
{
  const items = (await searchAll({ category: 'apartments', dealType: 'Sale', sort: 'PricePerM2Asc' })).items;
  const firstNull = items.findIndex((l) => l.pricePerM2 == null);
  ok(firstNull === -1 || items.slice(firstNull).every((l) => l.pricePerM2 == null), 'sort ppm: nulls last');
}

// ---------- Map ----------
{
  const pins = (await get('/listings/map?category=cars')).json;
  ok(pins.length === totalByCat.cars, 'map pins match search count', pins.length);
  const box = (await get('/listings/map?bbox=21.0,42.6,21.3,42.75')).json;
  ok(box.every((p) => p.lng >= 21 && p.lng <= 21.3 && p.lat >= 42.6 && p.lat <= 42.75), 'map bbox respected', box.length);
  const boxSearch = await searchAll({ bbox: '21.0,42.6,21.3,42.75' });
  ok(boxSearch.total === box.length, 'bbox search equals pins', { s: boxSearch.total, p: box.length });
  const bad = await get('/listings?bbox=1,2,3');
  ok(bad.status === 200 && bad.json.total === all.total, 'bad bbox ignored');
}

// ---------- Detail, similar, phone ----------
{
  const first = all.items[0];
  const d = await get(`/listings/${first.id}`);
  ok(d.status === 200 && d.json.id === first.id, 'detail loads');
  const views0 = d.json.viewCount;
  await get(`/listings/${first.id}`);
  const d2 = await get(`/listings/${first.id}`);
  ok(d2.json.viewCount === views0 + 2, 'detail counts views', [views0, d2.json.viewCount]);
  const sim = await get(`/listings/${first.id}/similar`);
  ok(sim.status === 200 && sim.json.every((s) => s.id !== first.id && s.category === first.category && s.dealType === first.dealType), 'similar ads same category/deal');
  ok((await get('/listings/00000000-0000-0000-0000-000000000000')).status === 404, 'detail 404 for unknown id');
  ok((await get('/listings/not-a-guid')).status === 404, 'detail 404 for bad id');
  const withPhone = all.items.find((l) => l);
  const ph = await get(`/listings/${withPhone.id}/phone`);
  ok(ph.status === 200 || ph.status === 404, 'phone endpoint works logged out', ph.status);
}

// ---------- Businesses ----------
{
  const list = (await get('/businesses')).json;
  ok(list.length >= 4, 'businesses list', list.length);
  for (const kind of ['RealEstateAgency', 'Developer', 'CarDealer', 'RentACar', 'Other']) {
    const r = (await get(`/businesses?kind=${kind}`)).json;
    ok(r.every((b) => b.kind === kind), `businesses kind=${kind}`);
  }
  for (const b of list) {
    const page = await get(`/businesses/${b.slug}`);
    ok(page.status === 200, `business page ${b.slug}`);
    const ads = await get(`/businesses/${b.slug}/listings?pageSize=100`);
    ok(ads.status === 200 && ads.json.total === b.activeListings, `business ${b.slug} ads count`, { total: ads.json?.total, active: b.activeListings });
    ok(ads.json.items.every((l) => l.seller.slug === b.slug || l.seller.isBusiness), `business ${b.slug} ads belong to it`);
  }
  ok((await get('/businesses/no-such-business')).status === 404, 'unknown business 404');
}

// ---------- Auth ----------
const stamp = Date.now();
{
  const weak = await post('/auth/register', { email: `w${stamp}@t.local`, password: 'short', displayName: 'W', accountType: 'Personal' });
  ok(weak.status === 400, 'register: short password rejected', weak.status);
  const badEmail = await post('/auth/register', { email: 'nope', password: 'Demo1234!', displayName: 'Nope', accountType: 'Personal' });
  ok(badEmail.status === 400, 'register: bad email rejected', badEmail.status);
  const dup = await post('/auth/register', { email: 'seeker@demo.local', password: 'Demo1234!', displayName: 'Dup', accountType: 'Personal' });
  ok(dup.status === 409 || dup.status === 400, 'register: duplicate email rejected', dup.status);
  const dupCase = await post('/auth/register', { email: 'SEEKER@demo.local', password: 'Demo1234!', displayName: 'Dup', accountType: 'Personal' });
  ok(dupCase.status === 409 || dupCase.status === 400, 'register: duplicate email (other case) rejected', dupCase.status);
  const bizNoName = await post('/auth/register', { email: `b${stamp}@t.local`, password: 'Demo1234!', displayName: 'Biz', accountType: 'Business', businessKind: 'CarDealer' });
  ok(bizNoName.status === 400, 'register: business needs a name', bizNoName.status);
  const wrong = await post('/auth/login', { email: 'seeker@demo.local', password: 'Wrong1234!' });
  ok(wrong.status === 401 || wrong.status === 400, 'login: wrong password rejected', wrong.status);
  const upper = await post('/auth/login', { email: 'SEEKER@demo.local', password: 'Demo1234!' });
  ok(upper.status === 200, 'login: email is case-insensitive', upper.status);
  ok((await get('/auth/me')).status === 401, 'me: requires login');
  ok((await get('/auth/me', { token: 'garbage' })).status === 401, 'me: bad token rejected');
}

// ---------- Posting lifecycle + permissions ----------
const reg = await post('/auth/register', { email: `poster${stamp}@t.local`, password: 'Demo1234!', displayName: 'Poster Test', phone: '+383 44 111 222', accountType: 'Personal' });
ok(reg.status === 200, 'register personal', reg.text);
const tPoster = reg.json.token;
const tOther = await login('seeker@demo.local');
const tAdmin = await login('admin@demo.local', 'Admin1234!');

const apt = {
  category: 'apartments', dealType: 'Sale', title: 'Test flat in Arbëria', description: 'A long enough description for the test ad.',
  priceEur: 99000, negotiable: true, municipality: 'Prishtinë', place: 'Arbëria (Dragodan)', address: 'Rr. Test',
  attributes: { areaM2: 80, rooms: 3, legalization: 'Legalized', elevator: true },
};
ok((await post('/listings', apt)).status === 401, 'post: requires login');
const created = await post('/listings', apt, { token: tPoster });
ok(created.status === 201, 'post: create draft', created.text);
const id = created.json.id;
ok(created.json.status === 'Draft' && created.json.pricePerM2 > 1200 && created.json.pricePerM2 < 1300, 'post: draft + price per m2', created.json);
ok(Math.abs(created.json.lat - locs.find((m) => m.name === 'Prishtinë').lat) < 1e-6, 'post: pin defaults to municipality centre');

// Validation
const bad = async (patch, name) => {
  const r = await post('/listings', { ...apt, ...patch, attributes: { ...apt.attributes, ...(patch.attributes ?? {}) } }, { token: tPoster });
  ok(r.status === 400, `validation: ${name}`, `${r.status} ${r.text.slice(0, 200)}`);
  return r;
};
await bad({ category: 'boats' }, 'unknown category');
await bad({ category: 'land', dealType: 'RentNightly', attributes: { landType: 'Forest' } }, 'deal not allowed for category');
await bad({ municipality: 'Atlantis' }, 'unknown municipality');
await bad({ place: 'Dragodan', municipality: 'Prizren' }, 'place from another municipality');
await bad({ lat: 42.6 }, 'lat without lng');
await bad({ lat: 48, lng: 21 }, 'pin outside Kosovo');
await bad({ attributes: { areaM2: null } }, 'missing required area');
await bad({ attributes: { areaM2: -5 } }, 'negative area');
await bad({ attributes: { rooms: 2.5 } }, 'fractional rooms');
await bad({ attributes: { heating: 'Nuclear' } }, 'unknown select option');
await bad({ attributes: { elevator: 'yes' } }, 'boolean as string');
{
  const r = await post('/listings', { ...apt, attributes: { ...apt.attributes, maxGuests: 3 } }, { token: tPoster });
  ok(r.status === 201 && r.json.attributes.maxGuests === undefined, 'stay-only field dropped from a sale', r.text.slice(0, 200));
  if (r.json?.id) await del(`/listings/${r.json.id}`, { token: tPoster });
}
await bad({ attributes: { colour: 'red' } }, 'unknown attribute key');
await bad({ title: 'abc' }, 'short title');
await bad({ description: 'too short' }, 'short description');
await bad({ priceEur: 0 }, 'zero price');
await bad({ category: 'apartments', dealType: 'RentNightly', attributes: {} }, 'stay without guests');
{
  const r = await post('/listings', { ...apt, place: 'arbëria (dragodan)' }, { token: tPoster });
  ok(r.status === 201 && r.json.place === 'Arbëria (Dragodan)', 'place matching is case-insensitive and normalised', r.json?.place ?? r.text);
  if (r.json?.id) await del(`/listings/${r.json.id}`, { token: tPoster });
  const r2 = await post('/listings', { ...apt, municipality: 'prishtine' }, { token: tPoster });
  ok(r2.status === 201 && r2.json.municipality === 'Prishtinë', 'municipality without ë accepted and normalised', r2.json?.municipality ?? r2.text);
  if (r2.json?.id) await del(`/listings/${r2.json.id}`, { token: tPoster });
}

// Draft is private
ok((await get(`/listings/${id}`)).status === 404, 'draft hidden from public');
ok((await get(`/listings/${id}`, { token: tOther })).status === 404, 'draft hidden from other users');
ok((await get(`/listings/${id}`, { token: tAdmin })).status === 200, 'draft visible to admin');
ok((await get(`/listings/${id}`, { token: tPoster })).json.isMine === true, 'owner sees own draft');

// Other users can't touch it
ok((await put(`/listings/${id}`, apt, { token: tOther })).status === 404, 'other user cannot edit');
ok((await del(`/listings/${id}`, { token: tOther })).status === 404, 'other user cannot delete');
ok((await post(`/listings/${id}/submit`, undefined, { token: tOther })).status === 404, 'other user cannot submit');
ok((await post(`/listings/${id}/archive`, undefined, { token: tOther })).status === 404, 'other user cannot archive');

// Submit without photos
const noPhoto = await post(`/listings/${id}/submit`, undefined, { token: tPoster });
ok(noPhoto.status === 400 || noPhoto.status === 409, 'submit needs a photo', noPhoto.status);

// Photos
const png = (await import('node:fs')).readFileSync(new URL('./fixtures/photo.png', import.meta.url));
const photoForm = (n = 1, type = 'image/png', data = png) => {
  const f = new FormData();
  for (let i = 0; i < n; i++) f.append('files', new Blob([data], { type }), `p${i}.png`);
  return f;
};
{
  const up = await call('POST', `/listings/${id}/photos`, { token: tPoster, form: photoForm(3) });
  ok(up.status === 200 && up.json.length === 3, 'upload 3 photos', up.text.slice(0, 300));
  const other = await call('POST', `/listings/${id}/photos`, { token: tOther, form: photoForm(1) });
  ok(other.status === 404, 'other user cannot upload photos');
  const txt = await call('POST', `/listings/${id}/photos`, { token: tPoster, form: photoForm(1, 'text/plain', Buffer.from('hi')) });
  ok(txt.status === 400, 'non-image rejected');
  const fake = await call('POST', `/listings/${id}/photos`, { token: tPoster, form: photoForm(1, 'image/png', Buffer.from('not a png')) });
  ok(fake.status === 400, 'corrupt image rejected', fake.status);
  const photos = up.json;
  const img = await fetch(photos[0].url.startsWith('http') ? photos[0].url : new URL(API).origin + photos[0].url);
  ok(img.status === 200, 'photo URL serves', photos[0].url);
  const reordered = await put(`/listings/${id}/photos/order`, { photoIds: [photos[2].id, photos[0].id, photos[1].id] }, { token: tPoster });
  ok(reordered.status === 200 && reordered.json[0].id === photos[2].id, 'reorder photos');
  const badOrder = await put(`/listings/${id}/photos/order`, { photoIds: [photos[0].id] }, { token: tPoster });
  ok(badOrder.status === 400, 'reorder must list all photos');
  ok((await del(`/listings/${id}/photos/${photos[1].id}`, { token: tPoster })).status === 204, 'delete photo');
  ok((await del(`/listings/${id}/photos/${photos[0].id}`, { token: tOther })).status === 404, 'other user cannot delete photo');
  const tooMany = await call('POST', `/listings/${id}/photos`, { token: tPoster, form: photoForm(29) });
  ok(tooMany.status === 400, 'max 30 photos', tooMany.status);
}

// Submit -> review -> approve
{
  const s = await post(`/listings/${id}/submit`, undefined, { token: tPoster });
  ok(s.status === 200 && s.json.status === 'PendingReview', 'submit for review', s.text.slice(0, 200));
  ok((await get(`/listings/${id}`)).status === 404, 'pending ad hidden from public');
  ok((await post(`/listings/${id}/submit`, undefined, { token: tPoster })).status >= 400, 'cannot submit twice');
  ok((await get('/admin/listings', { token: tOther })).status === 403, 'non-admin cannot see queue');
  ok((await post(`/admin/listings/${id}/approve`, undefined, { token: tOther })).status === 403, 'non-admin cannot approve');
  const queue = (await get('/admin/listings', { token: tAdmin })).json;
  const inQueue = (Array.isArray(queue) ? queue : queue.items).some((l) => l.id === id);
  ok(inQueue, 'ad appears in admin queue');
  const stats = (await get('/admin/stats', { token: tAdmin })).json;
  ok(stats.pendingReview >= 1, 'admin stats count pending', stats);
  const ap = await post(`/admin/listings/${id}/approve`, undefined, { token: tAdmin });
  ok(ap.status === 200 || ap.status === 204, 'admin approves', ap.status);
  const live = await get(`/listings/${id}`);
  ok(live.status === 200 && live.json.status === 'Active', 'approved ad is public');
  const found = await searchAll({ category: 'apartments', municipality: 'Prishtinë', place: 'Arbëria (Dragodan)', 'f.elevator': 'true', 'f.legalization': 'Legalized', 'f.rooms.min': 3 });
  ok(found.items.some((l) => l.id === id), 'new ad found via its filters');
  ok((await post(`/admin/listings/${id}/approve`, undefined, { token: tAdmin })).status >= 400, 'cannot approve twice');
}

// Edit live ad -> back to review
{
  const e = await put(`/listings/${id}`, { ...apt, priceEur: 95000 }, { token: tPoster });
  ok(e.status === 200 && e.json.status === 'PendingReview', 'editing a live ad sends it back to review', e.json?.status);
  ok((await get(`/listings/${id}`)).status === 404, 'edited ad hidden until re-approved');
  const rj = await post(`/admin/listings/${id}/reject`, { reason: 'Please add the floor.' }, { token: tAdmin });
  ok(rj.status === 200 || rj.status === 204, 'admin rejects with note', rj.text);
  const mine = (await get(`/listings/${id}`, { token: tPoster })).json;
  ok(mine.status === 'Rejected' && mine.moderationNote === 'Please add the floor.', 'owner sees rejection note', mine);
  const fix = await put(`/listings/${id}`, { ...apt, attributes: { ...apt.attributes, floor: 4 } }, { token: tPoster });
  ok(fix.status === 200, 'owner fixes rejected ad');
  const re = await post(`/listings/${id}/submit`, undefined, { token: tPoster });
  ok(re.status === 200 && re.json.status === 'PendingReview' && !re.json.moderationNote, 'resubmit clears note');
  await post(`/admin/listings/${id}/approve`, undefined, { token: tAdmin });
  const renew = await post(`/listings/${id}/renew`, undefined, { token: tPoster });
  ok(renew.status === 400 || renew.status === 409, 'cannot renew a fresh ad', renew.status);
}

// Favourites
{
  ok((await put(`/me/favorites/${id}`, undefined, { token: tOther })).status < 300, 'favorite');
  ok((await put(`/me/favorites/${id}`, undefined, { token: tOther })).status < 300, 'favorite twice is idempotent');
  const ids = (await get('/me/favorites/ids', { token: tOther })).json;
  ok(ids.includes(id), 'favorite ids');
  const favs = (await get('/me/favorites', { token: tOther })).json;
  ok(favs.some((l) => l.id === id), 'favorites list');
  ok((await get(`/listings/${id}`, { token: tOther })).json.isFavorite, 'detail isFavorite');
  ok((await del(`/me/favorites/${id}`, { token: tOther })).status < 300, 'unfavorite');
  ok(!(await get('/me/favorites/ids', { token: tOther })).json.includes(id), 'unfavorite removed');
  ok((await put('/me/favorites/00000000-0000-0000-0000-000000000000', undefined, { token: tOther })).status === 404, 'favorite unknown ad 404');
  ok((await get('/me/favorites')).status === 401, 'favorites need login');
}

// Messaging
{
  ok((await post(`/listings/${id}/messages`, { body: 'Hi' })).status === 401, 'message needs login');
  const own = await post(`/listings/${id}/messages`, { body: 'Hi me' }, { token: tPoster });
  ok(own.status === 400 || own.status === 409, 'cannot message own ad', own.status);
  const m1 = await post(`/listings/${id}/messages`, { body: 'Is it available?' }, { token: tOther });
  ok(m1.status === 200 || m1.status === 201, 'first message', m1.text.slice(0, 200));
  const conv = m1.json.id;
  const m2 = await post(`/listings/${id}/messages`, { body: 'Second note' }, { token: tOther });
  ok(m2.json?.id === conv, 'second message reuses conversation', m2.json?.id);
  const unread = (await get('/me/conversations/unread', { token: tPoster })).json;
  ok((unread.count ?? unread) >= 1, 'owner has unread', unread);
  const list = (await get('/me/conversations', { token: tPoster })).json;
  const c = list.find((x) => x.id === conv);
  ok(c && c.iAmOwner && c.unreadCount === 2, 'owner conversation list', c);
  const msgs = await get(`/conversations/${conv}/messages`, { token: tPoster });
  ok(msgs.status === 200 && msgs.json.length === 2, 'owner reads messages');
  const unread2 = (await get('/me/conversations/unread', { token: tPoster })).json;
  ok((unread2.count ?? unread2) === 0, 'reading marks read', unread2);
  ok((await get(`/conversations/${conv}/messages`, { token: tAdmin })).status === 404 || (await get(`/conversations/${conv}/messages`, { token: tAdmin })).status === 403, 'outsider cannot read conversation');
  const tThird = await login('dealer@demo.local');
  ok([403, 404].includes((await post(`/conversations/${conv}/messages`, { body: 'butting in' }, { token: tThird })).status), 'outsider cannot reply');
  const reply = await post(`/conversations/${conv}/messages`, { body: 'Yes it is' }, { token: tPoster });
  ok(reply.status === 200 || reply.status === 201, 'owner replies');
  const empty = await post(`/conversations/${conv}/messages`, { body: '   ' }, { token: tPoster });
  ok(empty.status === 400, 'empty message rejected', empty.status);
}

// Booking requests
{
  const clockNow = new Date();
  const day = (n) => new Date(clockNow.getTime() + n * 86400000).toISOString().slice(0, 10);
  const stay = stays.items.find((l) => l.attributes.maxGuests);
  const stayDetail = (await get(`/listings/${stay.id}`)).json;
  const minN = stayDetail.attributes.minNights ?? 1;
  const okReq = await post(`/listings/${stay.id}/booking-requests`, { checkIn: day(10), checkOut: day(10 + Math.max(minN, 2)), guests: 1, message: 'Hi' }, { token: tPoster });
  ok(okReq.status === 200 || okReq.status === 201, 'booking request for a stay', okReq.text.slice(0, 300));
  const msgs = (await get(`/conversations/${okReq.json?.id}/messages`, { token: tPoster })).json ?? [];
  const b = msgs.find((m) => m.booking)?.booking;
  ok(b && b.units === Math.max(minN, 2) && b.totalEur === stay.priceEur * Math.max(minN, 2) && b.guests === 1, 'booking card has nights, guests and total', b);
  const past = await post(`/listings/${stay.id}/booking-requests`, { checkIn: day(-3), checkOut: day(2), guests: 1 }, { token: tPoster });
  ok(past.status === 400, 'booking in the past rejected', past.status);
  const backwards = await post(`/listings/${stay.id}/booking-requests`, { checkIn: day(12), checkOut: day(10), guests: 1 }, { token: tPoster });
  ok(backwards.status === 400, 'check-out before check-in rejected');
  const tooMany = await post(`/listings/${stay.id}/booking-requests`, { checkIn: day(10), checkOut: day(15), guests: stayDetail.attributes.maxGuests + 1 }, { token: tPoster });
  ok(tooMany.status === 400, 'too many guests rejected');
  const noGuests = await post(`/listings/${stay.id}/booking-requests`, { checkIn: day(10), checkOut: day(15) }, { token: tPoster });
  ok(noGuests.status === 400, 'nightly booking needs guests');
  const sale = await post(`/listings/${id}/booking-requests`, { checkIn: day(10), checkOut: day(12) }, { token: tOther });
  ok(sale.status === 400, 'cannot book a sale ad', sale.status);
  const long = await post(`/listings/${stay.id}/booking-requests`, { checkIn: day(10), checkOut: day(200), guests: 1 }, { token: tPoster });
  ok(long.status === 400, 'over 90 nights rejected');
  const cars = await searchAll({ category: 'cars', dealType: 'RentDaily' });
  const car = cars.items[0];
  const cr = await post(`/listings/${car.id}/booking-requests`, { checkIn: day(5), checkOut: day(8) }, { token: tPoster });
  ok(cr.status === 200 || cr.status === 201, 'rent-a-car request without guests', cr.text.slice(0, 200));
}

// Reports
{
  ok((await post(`/listings/${id}/reports`, { reason: 'Spam' })).status === 401, 'report needs login');
  const r = await post(`/listings/${id}/reports`, { reason: 'WrongInformation', comment: 'Price is wrong' }, { token: tOther });
  ok(r.status < 300, 'report ad', r.text);
  const own = await post(`/listings/${id}/reports`, { reason: 'Spam' }, { token: tPoster });
  ok(own.status >= 400, 'cannot report own ad', own.status);
  const dup = await post(`/listings/${id}/reports`, { reason: 'Spam' }, { token: tOther });
  ok(dup.status < 500, 'duplicate report handled', dup.status);
  const reports = (await get('/admin/reports', { token: tAdmin })).json;
  const rep = (Array.isArray(reports) ? reports : reports.items).find((x) => x.listingId === id);
  ok(rep, 'report in admin list');
  ok((await get('/admin/reports', { token: tOther })).status === 403, 'non-admin cannot see reports');
  const dismiss = await post(`/admin/reports/${rep.id}/resolve`, { takeDown: false }, { token: tAdmin });
  ok(dismiss.status < 300, 'dismiss report', dismiss.text);
  ok((await get(`/listings/${id}`)).status === 200, 'dismissed report leaves ad live');
}

// Saved searches
{
  const s = await post('/me/saved-searches', { name: 'Flats', criteria: { category: 'apartments', municipality: 'Prishtinë', f: { 'rooms.min': '2' } } }, { token: tOther });
  ok(s.status === 200 || s.status === 201, 'save search', s.text);
  const list = (await get('/me/saved-searches', { token: tOther })).json;
  const mine = list.find((x) => x.id === s.json.id);
  ok(mine && mine.criteria.f?.['rooms.min'] === '2' && mine.emailAlerts === true, 'saved search keeps field filters', mine);
  const off = await call('PATCH', `/me/saved-searches/${s.json.id}?emailAlerts=false`, { token: tOther });
  ok(off.status === 200 && off.json.emailAlerts === false, 'turn alerts off');
  ok((await call('PATCH', `/me/saved-searches/${s.json.id}?emailAlerts=true`, { token: tPoster })).status === 404, 'other user cannot change saved search');
  await del(`/me/saved-searches/${s.json.id}`, { token: tPoster });
  ok((await get('/me/saved-searches', { token: tOther })).json.some((x) => x.id === s.json.id), 'other user cannot delete saved search');
  ok((await del(`/me/saved-searches/${s.json.id}`, { token: tOther })).status === 204, 'delete saved search');
  const blank = await post('/me/saved-searches', { name: '', criteria: {} }, { token: tOther });
  ok(blank.status === 400, 'saved search needs a name', blank.status);
}

// Profile + business
{
  const me = await put('/auth/me', { displayName: 'Poster Renamed', phone: '+383 49 000 000' }, { token: tPoster });
  ok(me.status === 200 && me.json.displayName === 'Poster Renamed', 'update profile', me.text);
  const notBiz = await put('/me/business', { name: 'X', kind: 'Other' }, { token: tPoster });
  ok(notBiz.status === 403 || notBiz.status === 400 || notBiz.status === 404, 'personal account has no business page', notBiz.status);
  const breg = await post('/auth/register', { email: `biz${stamp}@t.local`, password: 'Demo1234!', displayName: 'Biz Owner', accountType: 'Business', businessName: `Test Motors ${stamp}`, businessKind: 'CarDealer', municipality: 'Ferizaj' });
  ok(breg.status === 200 && breg.json.user.business?.slug, 'register business', breg.text.slice(0, 300));
  const tBiz = breg.json.token;
  const slug = breg.json.user.business.slug;
  const upd = await put('/me/business', { name: `Test Motors ${stamp}`, kind: 'CarDealer', municipality: 'Ferizaj', address: 'Main road', website: 'https://example.com', description: 'Used cars' }, { token: tBiz });
  ok(upd.status === 200, 'update business page', upd.text);
  const badSite = await put('/me/business', { name: 'Test', kind: 'CarDealer', website: 'javascript:alert(1)' }, { token: tBiz });
  ok(badSite.status === 400, 'business website must be http(s)', badSite.status);
  const page = (await get(`/businesses/${slug}`)).json;
  ok(page.address === 'Main road' && page.website === 'https://example.com', 'business page shows details', page);
  const sameName = await post('/auth/register', { email: `biz2${stamp}@t.local`, password: 'Demo1234!', displayName: 'Biz Two', accountType: 'Business', businessName: `Test Motors ${stamp}`, businessKind: 'CarDealer' });
  ok(sameName.status === 200 && sameName.json.user.business.slug !== slug, 'same business name gets a unique slug', sameName.json?.user?.business?.slug);
  const car = await post('/listings', {
    category: 'cars', dealType: 'Sale', title: 'Golf 7 test car', description: 'Test car with a long enough description.', priceEur: 9000,
    municipality: 'Ferizaj', attributes: { make: 'Volkswagen', model: 'Golf', year: 2016, fuel: 'Diesel', mileageKm: 150000 },
  }, { token: tBiz });
  ok(car.status === 201, 'business posts a car', car.text.slice(0, 300));
}

// Archive + delete
{
  const a = await post(`/listings/${id}/archive`, undefined, { token: tPoster });
  ok(a.status === 200 && a.json.status === 'Archived', 'archive');
  ok((await get(`/listings/${id}`)).status === 404, 'archived ad hidden');
  const e = await put(`/listings/${id}`, apt, { token: tPoster });
  ok(e.status === 400 || e.status === 409, 'archived ad not editable', e.status);
  ok((await del(`/listings/${id}`, { token: tPoster })).status === 204, 'delete');
  ok((await get(`/listings/${id}`, { token: tPoster })).status === 404, 'deleted ad gone');
}

