import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../core/api.service';
import { Catalog } from '../core/catalog';
import { BUSINESS_KINDS, LabelPipe, entries } from '../core/labels';
import { BusinessKind, BusinessProfile, ListingSummary } from '../core/models';
import { Icon } from '../shared/icon';
import { ListingCard } from '../shared/listing-card';

const KIND_ICON: Record<BusinessKind, string> = {
  RealEstateAgency: 'house',
  Developer: 'building',
  CarDealer: 'car',
  RentACar: 'carKey',
  Other: 'briefcase',
};

@Component({
  selector: 'app-businesses',
  imports: [RouterLink, LabelPipe, Icon],
  template: `
    <div class="container">
      <h1>Businesses</h1>
      <p class="muted">Agencies, developers, car dealers and rent-a-car companies, each with all their ads in one place.</p>
      <div class="intent-pills static">
        <button type="button" class="intent-pill" [class.on]="!kind()" (click)="kind.set(null)"><app-icon name="grid" [size]="18" /> All</button>
        @for (k of kinds; track k.value) {
          <button type="button" class="intent-pill" [class.on]="kind() === k.value" (click)="kind.set(k.value)">
            <app-icon [name]="icons[k.value]" [size]="18" /> {{ k.label }}
          </button>
        }
      </div>
      <div class="business-grid">
        @for (b of list(); track b.id) {
          <a class="card business-tile" [routerLink]="['/businesses', b.slug]">
            <span class="avatar big">{{ b.name.charAt(0) }}</span>
            <div>
              <strong>{{ b.name }}</strong>
              <div class="muted small">{{ b.kind | label: labels }}{{ b.municipality ? ' · ' + b.municipality : '' }}</div>
              <div class="small">{{ b.activeListings }} live {{ b.activeListings === 1 ? 'ad' : 'ads' }}</div>
            </div>
          </a>
        } @empty {
          <p class="card empty muted">No businesses of this kind yet.</p>
        }
      </div>
    </div>
  `,
})
export class BusinessesPage {
  private readonly api = inject(Api);
  protected readonly kinds = entries(BUSINESS_KINDS);
  protected readonly labels = BUSINESS_KINDS;
  protected readonly icons = KIND_ICON;
  protected readonly kind = signal<BusinessKind | null>(null);
  protected readonly list = signal<BusinessProfile[]>([]);

  constructor() {
    effect(() => {
      const k = this.kind();
      this.api.businesses(k).subscribe((b) => this.list.set(b));
    });
  }
}

@Component({
  selector: 'app-business',
  imports: [ListingCard, DatePipe, LabelPipe, Icon],
  template: `
    @if (error()) {
      <div class="container"><p class="error">{{ error() }}</p></div>
    }
    @if (business(); as b) {
      <section class="business-hero">
        <div class="container business-head">
          <span class="avatar huge">{{ b.name.charAt(0) }}</span>
          <div class="grow">
            <span class="kicker">{{ b.kind | label: labels }}</span>
            <h1>{{ b.name }}</h1>
            <p class="muted">
              @if (b.municipality) {
                <app-icon name="pin" [size]="15" /> {{ b.address ? b.address + ', ' : '' }}{{ b.municipality }} ·
              }
              On Tregu since {{ b.memberSince | date: 'MMM y' }} · {{ b.activeListings }} live {{ b.activeListings === 1 ? 'ad' : 'ads' }}
            </p>
            @if (b.description) {
              <p class="about">{{ b.description }}</p>
            }
          </div>
          <div class="business-contact">
            @if (b.phone) {
              <a class="btn" [href]="'tel:' + b.phone"><app-icon name="phone" [size]="18" /> {{ b.phone }}</a>
            }
            @if (b.website) {
              <a class="btn ghost" [href]="b.website" target="_blank" rel="noopener">Website</a>
            }
          </div>
        </div>
      </section>
      <div class="container">
        @if (categories().length > 1) {
          <div class="intent-pills static">
            <button type="button" class="intent-pill" [class.on]="!category()" (click)="category.set(null)">All ads</button>
            @for (c of categories(); track c.key) {
              <button type="button" class="intent-pill" [class.on]="category() === c.key" (click)="category.set(c.key)">
                <app-icon [name]="c.icon" [size]="18" /> {{ c.name }}
              </button>
            }
          </div>
        }
        <div class="grid">
          @for (l of visible(); track l.id) {
            <app-listing-card [listing]="l" />
          } @empty {
            <p class="card empty muted">No live ads right now.</p>
          }
        </div>
        @if (listings().length < total()) {
          <div class="load-more">
            <button type="button" class="btn ghost" (click)="loadMore()">Show more ads</button>
            <span class="muted small">Showing {{ listings().length }} of {{ total() }}</span>
          </div>
        }
      </div>
    }
  `,
})
export class BusinessPage {
  readonly slug = input.required<string>();
  private readonly api = inject(Api);
  private readonly catalog = inject(Catalog);
  protected readonly labels = BUSINESS_KINDS;
  protected readonly business = signal<BusinessProfile | null>(null);
  protected readonly listings = signal<ListingSummary[]>([]);
  protected readonly category = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly total = signal(0);
  /** Categories this business has ads in, learned from the unfiltered list so the pills don't vanish when one is picked. */
  private readonly seen = signal<Set<string>>(new Set());
  private page = 1;

  protected readonly categories = computed(() => this.catalog.categories().filter((c) => this.seen().has(c.key)));
  protected readonly visible = this.listings;

  constructor() {
    effect(() => {
      const slug = this.slug();
      this.error.set(null);
      this.seen.set(new Set());
      this.api.business(slug).subscribe({
        next: (b) => this.business.set(b),
        error: (e) => this.error.set(e.status === 404 ? 'This business page doesn’t exist.' : errorMessage(e)),
      });
    });
    // A new business or a new category pill starts again from page 1; the server does the filtering.
    effect(() => {
      const slug = this.slug();
      const category = this.category();
      untracked(() => {
        this.page = 1;
        this.loadListings(slug, category);
      });
    });
  }

  protected loadMore() {
    this.page++;
    this.loadListings(this.slug(), this.category());
  }

  private loadListings(slug: string, category: string | null) {
    const page = this.page;
    this.api.businessListings(slug, category ? { category } : {}, page).subscribe({
      next: (r) => {
        if (category !== this.category()) return;
        this.listings.set(page === 1 ? r.items : [...this.listings(), ...r.items]);
        this.total.set(r.total);
        if (!category) this.seen.set(new Set([...this.seen(), ...r.items.map((l) => l.category)]));
      },
      // A missing business is already reported by the profile request above.
      error: () => this.listings.set([]),
    });
  }
}
