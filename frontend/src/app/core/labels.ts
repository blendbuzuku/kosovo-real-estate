import { Pipe, PipeTransform } from '@angular/core';
import { BusinessKind, DealType, ListingSort, ListingStatus, ReportReason } from './models';

export const DEAL_TYPES: Record<DealType, string> = {
  Sale: 'For sale',
  RentMonthly: 'Monthly rent',
  RentNightly: 'Per night',
  RentDaily: 'Per day',
};

/** What the person wants to do, used on buttons and tabs. */
export const DEAL_ACTIONS: Record<DealType, string> = {
  Sale: 'Buy',
  RentMonthly: 'Rent monthly',
  RentNightly: 'Stay per night',
  RentDaily: 'Rent per day',
};

/** What the poster is doing, used in the post wizard. */
export const DEAL_POST: Record<DealType, { title: string; text: string }> = {
  Sale: { title: 'Sell', text: 'One price, to a buyer.' },
  RentMonthly: { title: 'Rent out monthly', text: 'Long-term tenants, price per month.' },
  RentNightly: { title: 'Rent per night', text: 'Guests and tourists, price per night.' },
  RentDaily: { title: 'Rent per day', text: 'Rent-a-car style, price per day.' },
};

export const DEAL_UNIT: Record<DealType, string> = {
  Sale: '',
  RentMonthly: 'month',
  RentNightly: 'night',
  RentDaily: 'day',
};

export const BUSINESS_KINDS: Record<BusinessKind, string> = {
  RealEstateAgency: 'Real estate agency',
  Developer: 'Developer / builder',
  CarDealer: 'Car dealer',
  RentACar: 'Rent a car',
  Other: 'Other business',
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
  Newest: 'Newest first',
  PriceAsc: 'Price: low to high',
  PriceDesc: 'Price: high to low',
  PricePerM2Asc: 'Price per m²: lowest',
  YearDesc: 'Year: newest',
  MileageAsc: 'Mileage: lowest',
};

export const REPORT_REASONS: Record<ReportReason, string> = {
  Spam: 'Spam or advertising',
  Fraud: 'Looks like a scam',
  WrongInformation: 'Wrong price, photos or details',
  NoLongerAvailable: 'Already sold or rented',
  Duplicate: 'Duplicate ad',
  Offensive: 'Offensive content',
  Other: 'Something else',
};

export function entries<K extends string>(map: Record<K, string>): { value: K; label: string }[] {
  return (Object.keys(map) as K[]).map((value) => ({ value, label: map[value] }));
}

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

export function formatNumber(n: number): string {
  return num.format(n);
}

export function formatEur(n: number): string {
  return eur.format(n);
}

export function formatPrice(price: number, deal: DealType): string {
  const amount = eur.format(price);
  const unit = DEAL_UNIT[deal];
  return unit ? `${amount} / ${unit}` : amount;
}

/** Compact price for map markers: 85k €, 1.2M €, 450 €. */
export function shortPrice(price: number): string {
  if (price >= 1_000_000) return `${(price / 1_000_000).toFixed(1).replace('.0', '')}M €`;
  if (price >= 10_000) return `${Math.round(price / 1000)}k €`;
  return `${Math.round(price)} €`;
}

/** "Prizren" or "Marash, Prizren". */
export function placeLabel(l: { municipality: string; place?: string | null }): string {
  return l.place ? `${l.place}, ${l.municipality}` : l.municipality;
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
