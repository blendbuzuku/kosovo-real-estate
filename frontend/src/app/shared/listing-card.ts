import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Auth } from '../core/auth';
import { LabelPipe, PROPERTY_TYPES, PricePipe } from '../core/labels';
import { ListingSummary } from '../core/models';
import { Favorites } from '../core/stores';

@Component({
  selector: 'app-listing-card',
  imports: [RouterLink, PricePipe, LabelPipe],
  template: `
    @let l = listing();
    <a class="card listing-card" [routerLink]="['/listings', l.id]">
      <div class="thumb">
        @if (l.thumbnailUrl) {
          <img [src]="l.thumbnailUrl" [alt]="l.title" loading="lazy" />
        } @else {
          <div class="thumb-placeholder" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="40" height="40"><path fill="currentColor" d="M12 3 2 12h3v8h6v-6h2v6h6v-8h3z" /></svg>
          </div>
        }
        <span class="chip deal">{{ l.dealType === 'Sale' ? 'Sale' : 'Rent' }}</span>
        @if (auth.isLoggedIn()) {
          <button
            type="button"
            class="fav"
            [class.on]="isFavorite()"
            [attr.aria-label]="isFavorite() ? 'Remove from favorites' : 'Save to favorites'"
            (click)="toggleFavorite($event)"
          >
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path d="M12 21s-7.5-4.6-10-9.3C.4 8.4 2.3 4 6.4 4c2.2 0 3.6 1.2 4.6 2.6C12 5.2 13.4 4 15.6 4 19.7 4 21.6 8.4 22 11.7 19.5 16.4 12 21 12 21z" />
            </svg>
          </button>
        }
      </div>
      <div class="body">
        <div class="price">{{ l.priceEur | price: l.dealType }}</div>
        <div class="title">{{ l.title }}</div>
        <div class="facts">
          <span>{{ l.propertyType | label: types }}</span>
          <span>{{ l.areaM2 }} m²</span>
          @if (l.rooms) {
            <span>{{ l.rooms }} {{ l.rooms === 1 ? 'room' : 'rooms' }}</span>
          }
          @if (l.floor !== null && l.floor !== undefined) {
            <span>Floor {{ l.floor }}</span>
          }
        </div>
        <div class="place">{{ l.neighborhood ? l.neighborhood + ', ' : '' }}{{ l.city }}</div>
        <div class="badges">
          @if (l.legalization === 'Legalized' || l.legalization === 'NotRequired') {
            <span class="badge ok">Legal ✓</span>
          } @else if (l.legalization === 'InProcess') {
            <span class="badge warn">Legalization in process</span>
          } @else if (l.legalization === 'NotLegalized') {
            <span class="badge bad">Not legalized</span>
          }
          @if (l.hasCadastreCertificate) {
            <span class="badge ok">Cadastre cert.</span>
          }
          @if (l.agencyName) {
            <span class="badge">{{ l.agencyName }}</span>
          }
        </div>
      </div>
    </a>
  `,
})
export class ListingCard {
  readonly listing = input.required<ListingSummary>();
  protected readonly auth = inject(Auth);
  private readonly favorites = inject(Favorites);
  protected readonly types = PROPERTY_TYPES;
  protected readonly isFavorite = computed(() => this.favorites.has(this.listing().id));

  protected toggleFavorite(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    this.favorites.toggle(this.listing().id);
  }
}
