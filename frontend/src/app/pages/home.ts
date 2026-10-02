import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth';
import { Catalog, INTENTS, Intent } from '../core/catalog';
import { criteriaToParams } from '../core/criteria';
import { BUSINESS_KINDS, formatNumber } from '../core/labels';
import { BusinessProfile, ListingSummary, SearchCriteria } from '../core/models';
import { Icon } from '../shared/icon';
import { ListingCard } from '../shared/listing-card';
import { LocationInput, LocationValue } from '../shared/location-input';

interface Tile {
  key: string;
  label: string;
  icon: string;
  count: string | number;
  params: object;
}

interface Rail {
  title: string;
  subtitle: string;
  criteria: SearchCriteria;
  items: ListingSummary[];
}

const RAILS: Omit<Rail, 'items'>[] = [
  { title: 'Property for sale', subtitle: 'Apartments, houses, land and commercial, newest first', criteria: { vertical: 'property', dealType: 'Sale' } },
  { title: 'Fresh finds', subtitle: 'Clothes, phones, furniture and more, new and used', criteria: { vertical: 'goods' } },
  { title: 'Stays for your next visit', subtitle: 'Book by the night: city flats, old-town houses, mountain chalets', criteria: { dealType: 'RentNightly' } },
  { title: 'Cars for sale', subtitle: 'From private sellers and dealers, customs status shown', criteria: { category: 'cars', dealType: 'Sale' } },
  { title: 'Rent a car', subtitle: 'Pick-up in town or delivered to the airport', criteria: { vertical: 'vehicles', dealType: 'RentDaily' } },
  { title: 'Homes to rent', subtitle: 'Monthly rentals, furnished and unfurnished', criteria: { vertical: 'property', dealType: 'RentMonthly' } },
  { title: 'Land and plots', subtitle: 'Building plots, farmland and forest', criteria: { category: 'land' } },
];

@Component({
  selector: 'app-home',
  imports: [NgTemplateOutlet, RouterLink, Icon, ListingCard, LocationInput],
  template: `
    <section class="hero">
      <div class="container">
        <span class="eyebrow"><span class="dot"></span> {{ liveTotal() }} live ads across Kosovo</span>
        <h1>Buy, sell and rent anything <span class="accent">in Kosovo.</span></h1>
        <p class="lead">Homes, cars, stays, clothes, phones, furniture and everything in between, from people and businesses in all 38 municipalities.</p>

        <div class="quick-search card">
          <div class="qs-tabs" role="tablist" aria-label="What are you looking for?">
            @for (i of intents; track i.key) {
              <button type="button" role="tab" class="qs-tab" [class.on]="intent().key === i.key" [attr.aria-selected]="intent().key === i.key"
                (click)="intent.set(i)">
                <app-icon [name]="i.icon" [size]="22" />
                <span>{{ i.short }}</span>
              </button>
            }
          </div>
          <form class="qs-row" (submit)="$event.preventDefault(); go(q.value, max.value)">
            <label class="qs-field where">
              <span>Where</span>
              <app-location-input [municipality]="where().municipality" [place]="where().place" (changed)="where.set($event)"
                placeholder="Anywhere in Kosovo" />
            </label>
            <label class="qs-field what">
              <span>What</span>
              <input #q type="search" [placeholder]="intent().hint" />
            </label>
            <label class="qs-field budget">
              <span>Max budget{{ unit() }}</span>
              <input #max type="number" inputmode="numeric" min="0" placeholder="Any €" />
            </label>
            <button class="btn qs-go" type="submit"><app-icon name="search" [size]="20" /> <span>Search</span></button>
          </form>
        </div>
        <div class="hero-stats">
          <span><strong>38</strong> municipalities</span>
          <span><strong>590+</strong> neighbourhoods and villages</span>
          <span><strong>{{ businessCount() }}</strong> businesses</span>
          <span><strong>Free</strong> to post</span>
        </div>
      </div>
    </section>

    <div class="container">
      <section class="section">
        <div class="section-head">
          <h2>Homes, vehicles and stays</h2>
        </div>
        <ng-container *ngTemplateOutlet="tileGrid; context: { $implicit: tiles() }" />
      </section>

      <section class="section">
        <div class="section-head">
          <div>
            <h2>Everything from home</h2>
            <p class="muted small">Clothes, phones, furniture, appliances and the rest, new or used</p>
          </div>
          <a class="see-all" routerLink="/search" [queryParams]="{ vertical: 'goods' }">See all <app-icon name="arrowRight" [size]="16" /></a>
        </div>
        <ng-container *ngTemplateOutlet="tileGrid; context: { $implicit: goodsTiles() }" />
      </section>

      <ng-template #tileGrid let-list>
        <div class="category-tiles">
          @for (t of list; track t.label) {
            <a class="category-tile" routerLink="/search" [queryParams]="t.params" [attr.data-cat]="t.key">
              <span class="tile-icon"><app-icon [name]="t.icon" [size]="28" [stroke]="1.6" /></span>
              <strong>{{ t.label }}</strong>
              <span class="muted small">{{ t.count }} {{ t.count === 1 ? 'ad' : 'ads' }}</span>
            </a>
          }
        </div>
      </ng-template>

      @for (r of rails(); track r.title) {
        @if (r.items.length) {
          <section class="section">
            <div class="section-head">
              <div>
                <h2>{{ r.title }}</h2>
                <p class="muted small">{{ r.subtitle }}</p>
              </div>
              <a class="see-all" routerLink="/search" [queryParams]="params(r.criteria)">See all <app-icon name="arrowRight" [size]="16" /></a>
            </div>
            <div class="rail">
              @for (l of r.items; track l.id) {
                <app-listing-card [listing]="l" />
              }
            </div>
          </section>
        }
      }

      <section class="section how">
        <div class="how-card">
          <app-icon name="shield" [size]="28" />
          <h3>Paperwork up front</h3>
          <p class="muted">Every property shows its legalization status, cadastre certificate and permit before you call. Cars show whether they’re customs cleared.</p>
        </div>
        <div class="how-card">
          <app-icon name="calendar" [size]="28" />
          <h3>Ask for dates in one tap</h3>
          <p class="muted">Stays and rentals take booking requests with the total worked out, so hosts reply with a yes or no instead of twenty questions.</p>
        </div>
        <div class="how-card">
          <app-icon name="bell" [size]="28" />
          <h3>Hear about new ads first</h3>
          <p class="muted">Save any search, down to the neighbourhood or village, and get an email as soon as something new matches.</p>
        </div>
      </section>

      @if (businesses().length) {
        <section class="section">
          <div class="section-head">
            <div>
              <h2>Businesses on Tregu</h2>
              <p class="muted small">Agencies, developers, car dealers, rent-a-car companies and shops with their own pages</p>
            </div>
            <a class="see-all" routerLink="/businesses">All businesses <app-icon name="arrowRight" [size]="16" /></a>
          </div>
          <div class="business-strip">
            @for (b of businesses(); track b.id) {
              <a class="business-chip card" [routerLink]="['/businesses', b.slug]">
                <span class="avatar">{{ b.name.charAt(0) }}</span>
                <span>
                  <strong>{{ b.name }}</strong>
                  <span class="muted small">{{ kinds[b.kind] }} · {{ b.activeListings }} ads</span>
                </span>
              </a>
            }
          </div>
        </section>
      }

      <section class="section post-cta card">
        <div>
          <h2>Have something to sell or rent?</h2>
          <p class="muted">Post a home, a room for the night, a car, or the things you no longer need. It’s free, and takes about three minutes.</p>
        </div>
        <a class="btn big" [routerLink]="auth.isLoggedIn() ? '/post' : '/register'"><app-icon name="plus" /> Post an ad, free</a>
      </section>
    </div>
  `,
})
export class HomePage {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly catalog = inject(Catalog);
  protected readonly auth = inject(Auth);

  protected readonly intents = INTENTS;
  protected readonly kinds = BUSINESS_KINDS;
  protected readonly intent = signal<Intent>(INTENTS[0]);
  protected readonly where = signal<LocationValue>({ municipality: null, place: null });
  protected readonly rails = signal<Rail[]>(RAILS.map((r) => ({ ...r, items: [] })));
  protected readonly businesses = signal<BusinessProfile[]>([]);
  protected readonly businessCount = signal(0);
  protected readonly liveTotal = computed(() =>
    formatNumber(this.catalog.categories().reduce((n, cat) => n + this.catalog.liveCount(cat), 0)),
  );

  protected readonly unit = computed(() => {
    const d = this.intent().criteria.dealType;
    return d === 'RentMonthly' ? ' / month' : d === 'RentNightly' ? ' / night' : d === 'RentDaily' ? ' / day' : '';
  });

  /** One tile per category, plus "Stays" and "Rent a car" since those are their own worlds (they overlap the category tiles). */
  protected readonly tiles = computed(() => {
    const tiles: Tile[] = [];
    for (const cat of this.catalog.categories().filter((c) => c.vertical !== 'goods')) {
      tiles.push({
        key: cat.key,
        label: cat.name,
        icon: cat.icon,
        count: formatNumber(this.catalog.liveCount(cat)),
        params: { category: cat.key, vertical: cat.vertical },
      });
    }
    const stays = this.catalog.categories().reduce((n, cat) => n + this.catalog.liveCount(cat, 'RentNightly'), 0);
    tiles.splice(2, 0, { key: 'stays', label: 'Stays', icon: 'bed', count: formatNumber(stays), params: { dealType: 'RentNightly' } });
    const rentals = this.catalog.categories().reduce((n, cat) => n + this.catalog.liveCount(cat, 'RentDaily'), 0);
    tiles.push({ key: 'rent-a-car', label: 'Rent a car', icon: 'carKey', count: formatNumber(rentals), params: { vertical: 'vehicles', dealType: 'RentDaily' } });
    return tiles;
  });

  protected readonly goodsTiles = computed<Tile[]>(() =>
    this.catalog.inVertical('goods').map((cat) => ({
      key: cat.key,
      label: cat.name,
      icon: cat.icon,
      count: formatNumber(this.catalog.liveCount(cat)),
      params: { category: cat.key, vertical: cat.vertical },
    })),
  );

  constructor() {
    RAILS.forEach((r, i) =>
      this.api.search(r.criteria, 1, 8).subscribe((page) =>
        this.rails.update((rails) => rails.map((x, j) => (j === i ? { ...x, items: page.items } : x))),
      ),
    );
    this.api.businesses().subscribe((b) => {
      this.businesses.set(b.slice(0, 8));
      this.businessCount.set(b.length);
    });
  }

  protected params(c: SearchCriteria) {
    return criteriaToParams(c);
  }

  protected go(q: string, max: string) {
    const maxPrice = Number(max);
    const c: SearchCriteria = {
      ...this.intent().criteria,
      municipality: this.where().municipality,
      place: this.where().place,
      q: q.trim() || null,
      maxPrice: max && maxPrice > 0 ? maxPrice : null,
    };
    this.router.navigate(['/search'], { queryParams: criteriaToParams(c) });
  }
}
