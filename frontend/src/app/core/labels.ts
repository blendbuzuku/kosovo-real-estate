import { Pipe, PipeTransform } from '@angular/core';
import {
  DealType,
  HeatingType,
  LegalizationStatus,
  ListingSort,
  ListingStatus,
  PropertyType,
  ReportReason,
} from './models';

export const PROPERTY_TYPES: Record<PropertyType, string> = {
  Apartment: 'Apartment',
  House: 'House',
  Land: 'Land',
  Commercial: 'Commercial',
};

export const DEAL_TYPES: Record<DealType, string> = {
  Sale: 'For sale',
  RentMonthly: 'For rent (monthly)',
  RentShortTerm: 'Short-term rent',
};

export const HEATING: Record<HeatingType, string> = {
  None: 'None',
  District: 'District heating (Termokos)',
  Central: 'Central heating',
  Electric: 'Electric',
  HeatPump: 'Heat pump',
  AirConditioning: 'Air conditioning',
  Wood: 'Wood / pellet stove',
  Other: 'Other',
};

export const LEGALIZATION: Record<LegalizationStatus, string> = {
  Unknown: 'Not specified',
  Legalized: 'Legalized',
  InProcess: 'Legalization in process',
  NotLegalized: 'Not legalized',
  NotRequired: 'Built with permit (no legalization needed)',
};

export const STATUS: Record<ListingStatus, string> = {
  Draft: 'Draft',
  PendingReview: 'Waiting for review',
  Active: 'Live',
  Rejected: 'Needs changes',
  Expired: 'Expired',
  Archived: 'Sold / rented',
};

export const SORTS: Record<ListingSort, string> = {
  Newest: 'Newest',
  PriceAsc: 'Price: low to high',
  PriceDesc: 'Price: high to low',
  PricePerM2Asc: '€/m²: low to high',
  PricePerM2Desc: '€/m²: high to low',
};

export const REPORT_REASONS: Record<ReportReason, string> = {
  Spam: 'Spam or advertising',
  Fraud: 'Looks like a scam',
  WrongInformation: 'Wrong price, photos or details',
  NoLongerAvailable: 'Already sold or rented',
  Duplicate: 'Duplicate listing',
  Offensive: 'Offensive content',
  Other: 'Something else',
};

export function entries<K extends string>(map: Record<K, string>): { value: K; label: string }[] {
  return (Object.keys(map) as K[]).map((value) => ({ value, label: map[value] }));
}

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

export function formatPrice(price: number, deal: DealType): string {
  const amount = eur.format(price);
  if (deal === 'RentMonthly') return `${amount} / month`;
  if (deal === 'RentShortTerm') return `${amount} / night`;
  return amount;
}

/** Compact price for map markers: 85k €, 1.2M €, 450 €. */
export function shortPrice(price: number): string {
  if (price >= 1_000_000) return `${(price / 1_000_000).toFixed(1).replace('.0', '')}M €`;
  if (price >= 10_000) return `${Math.round(price / 1000)}k €`;
  return `${Math.round(price)} €`;
}

@Pipe({ name: 'price' })
export class PricePipe implements PipeTransform {
  transform(price: number, deal: DealType): string {
    return formatPrice(price, deal);
  }
}

@Pipe({ name: 'label' })
export class LabelPipe implements PipeTransform {
  transform<K extends string>(value: K | null | undefined, map: Record<K, string>): string {
    return value ? map[value] : '';
  }
}
