import { Params } from '@angular/router';
import { SearchCriteria } from './models';

const NUMBER_KEYS = ['minPrice', 'maxPrice', 'lat', 'lng', 'radiusKm'] as const;
const STRING_KEYS = [
  'vertical',
  'category',
  'dealType',
  'municipality',
  'place',
  'q',
  'seller',
  'bbox',
  'sort',
] as const;

/** Values the API accepts for its enum parameters; anything else in a hand-edited or old URL is dropped. */
const ALLOWED: Partial<Record<(typeof STRING_KEYS)[number], readonly string[]>> = {
  vertical: ['property', 'vehicles', 'goods', 'jobs'],
  dealType: ['Sale', 'RentMonthly', 'RentNightly', 'RentDaily', 'Job'],
  seller: ['Private', 'Business'],
  sort: ['Newest', 'PriceAsc', 'PriceDesc', 'PricePerM2Asc', 'YearDesc', 'MileageAsc'],
};

/** Search criteria live in the URL so results can be shared and survive a reload. Field filters are f.<key>. */
export function criteriaFromParams(p: Params): SearchCriteria {
  const c: Record<string, unknown> = {};
  for (const k of STRING_KEYS) if (p[k] && (!ALLOWED[k] || ALLOWED[k].includes(p[k]))) c[k] = p[k];
  for (const k of NUMBER_KEYS) {
    const n = Number(p[k]);
    if (p[k] !== undefined && p[k] !== '' && !Number.isNaN(n)) c[k] = n;
  }
  const f: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) {
    if (k.startsWith('f.') && v !== undefined && v !== '') f[k.slice(2)] = String(v);
  }
  if (Object.keys(f).length) c['f'] = f;
  return c as SearchCriteria;
}

export function criteriaToParams(c: SearchCriteria): Params {
  const p: Params = {};
  for (const [k, v] of Object.entries(c)) {
    if (v === null || v === undefined || v === '') continue;
    if (k === 'f') {
      for (const [fk, fv] of Object.entries(v as Record<string, string>)) if (fv !== '' && fv != null) p[`f.${fk}`] = fv;
      continue;
    }
    p[k] = v;
  }
  return p;
}

/** Same criteria with one field filter set or cleared. */
export function withFilter(c: SearchCriteria, key: string, value: string | null | undefined): SearchCriteria {
  const f = { ...(c.f ?? {}) };
  if (value === null || value === undefined || value === '') delete f[key];
  else f[key] = value;
  return { ...c, f: Object.keys(f).length ? f : null };
}

/** How many filters are set beyond the basic "what" (category, deal, vertical). */
export function activeFilterCount(c: SearchCriteria): number {
  let n = Object.keys(c.f ?? {}).length;
  for (const k of ['municipality', 'place', 'q', 'minPrice', 'maxPrice', 'seller', 'radiusKm'] as const) if (c[k]) n++;
  return n;
}
