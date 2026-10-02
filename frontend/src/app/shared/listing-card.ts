import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Auth } from '../core/auth';
import { Catalog } from '../core/catalog';
import { BUSINESS_KINDS, PricePipe, placeLabel } from '../core/labels';
import { ListingSummary } from '../core/models';
import { Favorites } from '../core/stores';
import { Icon } from './icon';

@Component({
  selector: 'app-listing-card',
  imports: [RouterLink, PricePipe, Icon],
  template: `
    @let l = listing();
    <a class="listing-card" [class.compact]="compact()" [routerLink]="['/listings', l.id]">
      <div class="thumb">
        @if (l.thumbnailUrl) {
          <img [src]="l.thumbnailUrl" [alt]="l.title" loading="lazy" />
        } @else {
          <div class="thumb-placeholder" aria-hidden="true" [attr.data-cat]="placeholderKey()">
            <app-icon [name]="icon()" [size]="40" [stroke]="1.4" />
          </div>
        }
        @if (dealBadge()) {
          <span class="thumb-badge">{{ dealBadge() }}</span>
        }
        @if (l.photoCount > 1) {
          <span class="thumb-count"><app-icon name="camera" [size]="13" /> {{ l.photoCount }}</span>
        }
        @if (auth.isLoggedIn()) {
          <button
            type="button"
            class="fav"
            [class.on]="isFavorite()"
            [attr.aria-label]="isFavorite() ? 'Remove from favorites' : 'Save to favorites'"
            [attr.aria-pressed]="isFavorite()"
            (click)="toggleFavorite($event)"
          >
            <app-icon name="heart" [size]="18" [stroke]="2" />
          </button>
        }
      </div>
      <div class="body">
        <div class="kicker">{{ kicker() }}</div>
        <div class="title">{{ l.title }}</div>
        @if (facts().length) {
          <div class="facts">
            @for (f of facts(); track $index) {
              <span>{{ f }}</span>
            }
          </div>
        }
        <div class="place"><app-icon name="pin" [size]="14" /> {{ place() }}</div>
        <div class="price-row">
          <span class="price">{{ l.priceEur | price: l.dealType }}</span>
          @if (l.negotiable) {
            <span class="muted small">negotiable</span>
          }
        </div>
        @if (trustBadges().length || l.seller.isBusiness) {
          <div class="badges">
            @for (b of trustBadges(); track b.text) {
              <span class="badge" [class]="b.tone">{{ b.text }}</span>
            }
            @if (l.seller.isBusiness) {
              <span class="badge seller" [title]="sellerKind()">{{ l.seller.name }}</span>
            }
          </div>
        }
      </div>
    </a>
  `,
})
export class ListingCard {
  readonly listing = input.required<ListingSummary>();
  readonly compact = input(false);
  protected readonly auth = inject(Auth);
  private readonly favorites = inject(Favorites);
  private readonly catalog = inject(Catalog);

  protected readonly isFavorite = computed(() => this.favorites.has(this.listing().id));
  protected readonly facts = computed(() => this.catalog.cardFacts(this.listing()));
  protected readonly kicker = computed(() => this.catalog.cardKicker(this.listing()));
  protected readonly place = computed(() => placeLabel(this.listing()));
  protected readonly icon = computed(() => this.catalog.category(this.listing().category)?.icon ?? 'sparkles');
  /** Stays and rentals share their category's look except for the colour cue. */
  protected readonly placeholderKey = computed(() => (this.listing().dealType === 'RentNightly' ? 'stays' : this.listing().category));
  protected readonly sellerKind = computed(() => {
    const k = this.listing().seller.kind;
    return k ? BUSINESS_KINDS[k] : '';
  });

  protected readonly dealBadge = computed(() => {
    switch (this.listing().dealType) {
      case 'RentMonthly':
        return 'For rent';
      case 'RentNightly':
        return 'Stay';
      case 'RentDaily':
        return 'Rent per day';
      case 'Job':
        return 'Hiring';
      default:
        return '';
    }
  });

  /** The few facts that build trust at a glance: paperwork for property, customs for cars. */
  protected readonly trustBadges = computed(() => {
    const a = this.listing().attributes;
    const out: { text: string; tone: string }[] = [];
    if (a['legalization'] === 'Legalized' || a['legalization'] === 'NotRequired') out.push({ text: 'Legal ✓', tone: 'ok' });
    else if (a['legalization'] === 'InProcess') out.push({ text: 'Legalization in process', tone: 'warn' });
    else if (a['legalization'] === 'NotLegalized') out.push({ text: 'Not legalized', tone: 'bad' });
    if (a['hasCadastreCertificate'] === true) out.push({ text: 'Cadastre cert.', tone: 'ok' });
    if (this.listing().dealType === 'Job') {
      if (a['experience'] === 'None') out.push({ text: 'No experience needed', tone: 'ok' });
      if (a['accommodation'] === true) out.push({ text: 'Accommodation', tone: '' });
      if (a['training'] === true) out.push({ text: 'Training', tone: '' });
      return out;
    }
    if (this.listing().category !== 'cars' && this.listing().dealType !== 'RentDaily') return out;
    if (a['customsCleared'] === true && this.listing().dealType === 'Sale') out.push({ text: 'Customs cleared', tone: 'ok' });
    if (a['unlimitedKm'] === true) out.push({ text: 'Unlimited km', tone: 'ok' });
    if (a['airportDelivery'] === true) out.push({ text: 'Airport delivery', tone: '' });
    return out;
  });

  protected toggleFavorite(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    this.favorites.toggle(this.listing().id);
  }
}
