import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of, shareReplay } from 'rxjs';
import { Api } from './api.service';
import { formatNumber } from './labels';
import {
  AttributeValue,
  Attributes,
  Category,
  DealType,
  FieldDef,
  Municipality,
  SearchCriteria,
  Vertical,
} from './models';

/** The shortcuts people start from: "I want to rent a car", "I need a place for the weekend". */
export interface Intent {
  key: string;
  label: string;
  short: string;
  icon: string;
  criteria: SearchCriteria;
  /** Placeholder for the keyword box. */
  hint: string;
}

export const INTENTS: Intent[] = [
  {
    key: 'buy-home',
    label: 'Buy a home',
    short: 'Buy',
    icon: 'house',
    criteria: { vertical: 'property', dealType: 'Sale' },
    hint: 'Apartment with balcony, new build…',
  },
  {
    key: 'rent-home',
    label: 'Rent a home',
    short: 'Rent',
    icon: 'key',
    criteria: { vertical: 'property', dealType: 'RentMonthly' },
    hint: 'Furnished flat near the centre…',
  },
  {
    key: 'stays',
    label: 'Stays per night',
    short: 'Stays',
    icon: 'bed',
    criteria: { vertical: 'property', dealType: 'RentNightly' },
    hint: 'Old town, mountain chalet, pool…',
  },
  {
    key: 'cars',
    label: 'Buy a car',
    short: 'Cars',
    icon: 'car',
    criteria: { vertical: 'vehicles', category: 'cars', dealType: 'Sale' },
    hint: 'Golf, Audi A4, automatic…',
  },
  {
    key: 'rent-car',
    label: 'Rent a car',
    short: 'Rent a car',
    icon: 'carKey',
    criteria: { vertical: 'vehicles', dealType: 'RentDaily' },
    hint: 'SUV, 9-seater, airport delivery…',
  },
  {
    key: 'land',
    label: 'Land & plots',
    short: 'Land',
    icon: 'land',
    criteria: { vertical: 'property', category: 'land' },
    hint: 'Building plot, agricultural…',
  },
  {
    key: 'commercial',
    label: 'Shops & offices',
    short: 'Commercial',
    icon: 'store',
    criteria: { vertical: 'property', category: 'commercial' },
    hint: 'Shop, office, warehouse…',
  },
  {
    key: 'goods',
    label: 'Clothes, phones, furniture and more',
    short: 'Goods',
    icon: 'bag',
    criteria: { vertical: 'goods' },
    hint: 'iPhone, winter coat, sofa, washing machine…',
  },
];

/** Finds the intent that best describes a search, so the right tab lights up. */
export function intentFor(c: SearchCriteria): Intent | undefined {
  const exact = INTENTS.find(
    (i) =>
      (i.criteria.category ?? null) === (c.category ?? null) &&
      (i.criteria.dealType ?? null) === (c.dealType ?? null) &&
      (i.criteria.vertical ?? null) === (c.vertical ?? i.criteria.vertical ?? null),
  );
  if (exact) return exact;
  if (c.vertical === 'goods') return INTENTS[7];
  if (c.dealType === 'RentNightly') return INTENTS[2];
  if (c.dealType === 'RentDaily') return INTENTS[4];
  if (c.category === 'land') return INTENTS[5];
  if (c.category === 'commercial') return INTENTS[6];
  if (c.category === 'cars' || c.vertical === 'vehicles') return INTENTS[3];
  if (c.dealType === 'RentMonthly') return INTENTS[1];
  if (c.dealType === 'Sale' && (c.vertical === 'property' || ['apartments', 'houses'].includes(c.category ?? '')))
    return INTENTS[0];
  return undefined;
}

export interface LocationHit {
  municipality: string;
  place?: string;
  kind: 'municipality' | 'neighbourhood' | 'village';
  label: string;
}

/** Lowercase without diacritics, so "prishtine" finds "Prishtinë" and "cagllavice" finds "Çagllavicë". */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Field values as people read them: "72 m²", "3 rooms", "Diesel", "Floor 2". */
export function formatField(field: FieldDef, value: AttributeValue | undefined | null, compact = false): string {
  if (value === undefined || value === null || value === '') return '';
  switch (field.type) {
    case 'Boolean':
      return compact ? (value ? field.label : '') : value ? 'Yes' : 'No';
    case 'Select':
      return field.options?.find((o) => o.value === value)?.label ?? String(value);
    case 'Year':
      return String(value);
    case 'Text':
      return String(value);
    default: {
      const n = Number(value);
      if (field.key === 'floor' && n === 0) return 'Ground floor';
      if (!compact) return field.unit ? `${formatNumber(n)} ${field.unit}` : formatNumber(n);
      if (field.key === 'floor') return n === 0 ? 'Ground floor' : `Floor ${n}`;
      if (field.unit) return `${formatNumber(n)} ${field.unit}`;
      const noun = field.label.toLowerCase();
      return `${formatNumber(n)} ${n === 1 ? noun.replace(/s$/, '') : noun}`;
    }
  }
}

export function appliesTo(field: FieldDef, deal: DealType | null | undefined): boolean {
  return !field.onlyFor?.length || !deal || field.onlyFor.includes(deal);
}

/** Categories, their fields and Kosovo's locations, fetched once per visit. */
@Injectable({ providedIn: 'root' })
export class Catalog {
  private readonly api = inject(Api);

  readonly categories = toSignal(
    this.api.categories().pipe(
      catchError(() => of([] as Category[])),
      shareReplay(1),
    ),
    { initialValue: [] as Category[] },
  );

  readonly locations = toSignal(
    this.api.locations().pipe(
      catchError(() => of([] as Municipality[])),
      shareReplay(1),
    ),
    { initialValue: [] as Municipality[] },
  );

  readonly ready = computed(() => this.categories().length > 0);

  private readonly index = computed(() => {
    const hits: (LocationHit & { folded: string })[] = [];
    for (const m of this.locations()) {
      hits.push({ municipality: m.name, kind: 'municipality', label: m.name, folded: fold(m.name) });
      for (const p of m.places) {
        hits.push({
          municipality: m.name,
          place: p.name,
          kind: p.kind,
          label: `${p.name}, ${m.name}`,
          folded: fold(p.name),
        });
      }
    }
    return hits;
  });

  category(key: string | null | undefined): Category | undefined {
    return this.categories().find((c) => c.key === key);
  }

  inVertical(vertical: Vertical | null | undefined): Category[] {
    return vertical ? this.categories().filter((c) => c.vertical === vertical) : this.categories();
  }

  municipality(name: string | null | undefined): Municipality | undefined {
    return this.locations().find((m) => m.name === name);
  }

  /** Live ads for a category, optionally for one deal type. */
  liveCount(category: Category, deal?: DealType | null): number {
    return category.live.filter((l) => !deal || l.deal === deal).reduce((sum, l) => sum + l.count, 0);
  }

  /** Municipalities first, then neighbourhoods, then villages; prefix matches before substring ones. */
  searchLocations(query: string, limit = 12): LocationHit[] {
    const q = fold(query.trim());
    if (!q) return this.locations().slice(0, limit).map((m) => ({ municipality: m.name, kind: 'municipality', label: m.name }));
    const rank = { municipality: 0, neighbourhood: 1, village: 2 } as const;
    return this.index()
      .filter((h) => h.folded.includes(q) || fold(h.municipality).startsWith(q))
      .map((h) => ({ h, score: (h.folded.startsWith(q) ? 0 : 10) + rank[h.kind] }))
      .sort((a, b) => a.score - b.score || a.h.label.localeCompare(b.h.label))
      .slice(0, limit)
      .map(({ h }) => ({ municipality: h.municipality, place: h.place, kind: h.kind, label: h.label }));
  }

  /** Fields to ask for or show for a category and deal. */
  fields(category: Category | undefined, deal: DealType | null | undefined): FieldDef[] {
    return category ? category.fields.filter((f) => appliesTo(f, deal)) : [];
  }

  /**
   * Fields offered as filters. With one category: its filterable fields. With a whole vertical:
   * only the fields every category in it shares, so a filter never silently empties a category.
   */
  filterFields(c: SearchCriteria): FieldDef[] {
    const one = this.category(c.category);
    if (one) return one.fields.filter((f) => f.filter !== 'None' && appliesTo(f, c.dealType));
    const cats = this.inVertical(c.vertical ?? null).filter((cat) => !c.dealType || cat.deals.includes(c.dealType));
    if (!cats.length) return [];
    return cats[0].fields.filter(
      (f) =>
        f.filter !== 'None' &&
        appliesTo(f, c.dealType) &&
        cats.every((cat) => cat.fields.some((g) => g.key === f.key && g.filter === f.filter)),
    );
  }

  /** Key facts for a result card, from the category's on-card fields. */
  cardFacts(l: { category: string; dealType: DealType; attributes: Attributes }): string[] {
    const cat = this.category(l.category);
    if (!cat) return [];
    // For goods the item type is already the card's kicker.
    const kicker = cat.vertical === 'goods' ? this.goodsTypeField(cat)?.key : undefined;
    return cat.fields
      .filter((f) => f.onCard && f.key !== kicker && appliesTo(f, l.dealType))
      .map((f) => formatField(f, l.attributes[f.key], true))
      .filter(Boolean)
      .slice(0, 4);
  }

  /** Vehicle cards lead with the kind of vehicle, goods with the kind of item, property with the category name. */
  cardKicker(l: { category: string; attributes: Attributes }): string {
    const cat = this.category(l.category);
    if (!cat) return '';
    if (cat.vertical === 'goods') {
      const typeField = this.goodsTypeField(cat);
      const kind = typeField ? formatField(typeField, l.attributes[typeField.key]) : '';
      return kind && kind !== 'Other' ? kind : cat.name;
    }
    if (cat.vertical === 'vehicles') {
      // The title already names make and model; the kicker says what kind of vehicle it is.
      const typeField = cat.fields.find((f) => ['bodyType', 'motoType', 'vanType'].includes(f.key));
      const kind = typeField ? formatField(typeField, l.attributes[typeField.key]) : '';
      const noun = cat.key === 'vans-trucks' ? 'Van / truck' : cat.name.replace(/s$/, '');
      return kind && kind !== noun ? `${noun} · ${kind}` : noun;
    }
    const typeField = cat.fields.find((f) => f.key === 'landType' || f.key === 'commercialType');
    return typeField ? formatField(typeField, l.attributes[typeField.key]) || cat.name : cat.name.replace(' & villas', '').replace(/s$/, '');
  }

  /** The "Type" select of a goods category (clothingType, electronicsType…), if it has one. */
  goodsTypeField(cat: Category): FieldDef | undefined {
    return cat.fields.find((f) => f.type === 'Select' && f.key.endsWith('Type'));
  }
}
