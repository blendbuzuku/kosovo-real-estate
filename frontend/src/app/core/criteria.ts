import { Params } from '@angular/router';
import { SearchCriteria } from './models';

const NUMBER_KEYS = [
  'minPrice',
  'maxPrice',
  'minArea',
  'maxArea',
  'minRooms',
  'maxRooms',
  'minFloor',
  'maxFloor',
  'minYearBuilt',
  'lat',
  'lng',
  'radiusKm',
] as const;
const BOOL_KEYS = [
  'hasParking',
  'isFurnished',
  'hasElevator',
  'legalizedOnly',
  'hasCadastreCertificate',
  'hasConstructionPermit',
] as const;
const STRING_KEYS = ['dealType', 'propertyType', 'city', 'neighborhood', 'q', 'heating', 'bbox', 'sort'] as const;

/** Search criteria live in the URL so results can be shared and survive a reload. */
export function criteriaFromParams(p: Params): SearchCriteria {
  const c: Record<string, unknown> = {};
  for (const k of STRING_KEYS) if (p[k]) c[k] = p[k];
  for (const k of NUMBER_KEYS) {
    const n = Number(p[k]);
    if (p[k] !== undefined && p[k] !== '' && !Number.isNaN(n)) c[k] = n;
  }
  for (const k of BOOL_KEYS) if (p[k] === 'true') c[k] = true;
  return c as SearchCriteria;
}

export function criteriaToParams(c: SearchCriteria): Params {
  const p: Params = {};
  for (const [k, v] of Object.entries(c)) {
    if (v === null || v === undefined || v === '' || v === false) continue;
    p[k] = v;
  }
  return p;
}

/** Short human summary, used as the default name for a saved search. */
export function describeCriteria(c: SearchCriteria): string {
  const parts: string[] = [];
  parts.push(c.propertyType ? `${c.propertyType}s` : 'Properties');
  parts.push(c.dealType === 'Sale' ? 'for sale' : c.dealType ? 'for rent' : '');
  if (c.neighborhood) parts.push(`in ${c.neighborhood},`);
  if (c.city) parts.push(`in ${c.city}`);
  if (c.maxPrice) parts.push(`under ${c.maxPrice.toLocaleString('de-DE')} €`);
  if (c.minRooms) parts.push(`${c.minRooms}+ rooms`);
  return parts.filter(Boolean).join(' ').replace(', in', ',');
}
