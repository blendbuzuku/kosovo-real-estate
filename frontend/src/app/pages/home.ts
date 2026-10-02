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

interface Rail {
  title: string;
  subtitle: string;
  criteria: SearchCriteria;
  items: ListingSummary[];
}

const RAILS: Omit<Rail, 'items'>[] = [
  { title: 'Property for sale', subtitle: 'Apartments, houses, land and commercial, newest first', criteria: { vertical: 'property', dealType: 'Sale' } },
  { title: 'Stays for your next visit', subtitle: 'Book by the night: city flats, old-town houses, mountain chalets', criteria: { dealType: 'RentNightly' } },
  { title: 'Cars for sale', subtitle: 'From private sellers and dealers, customs status shown', criteria: { category: 'cars', dealType: 'Sale' } },
  { title: 'Rent a car', subtitle: 'Pick-up in town or delivered to the airport', criteria: { vertical: 'vehicles', dealType: 'RentDaily' } },
  { title: 'Homes to rent', subtitle: 'Monthly rentals, furnished and unfurnished', criteria: { vertical: 'property', dealType: 'RentMonthly' } },
  { title: 'Land and plots', subtitle: 'Building plots, farmland and forest', criteria: { category: 'land' } },
];

@Component({
  selector: 'app-home',
  imports: [RouterLink, Icon, ListingCard, LocationInput],
  template: `
    <section class="hero">
      <div class="container">
        <h1>Everything for sale and rent in Kosovo, <span class="accent">in one place.</span></h1>
        <p class="lead">Homes, stays, land, cars and rent-a-car from people and businesses across all 38 municipalities.</p>

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
      </div>
    </section>

    <div class="container">
      <section class="section">
        <div class="section-head">
          <h2>Browse by category</h2>
        </div>
        <div class="category-tiles">
          @for (t of tiles(); track t.label) {
            <a class="category-tile" routerLink="/search" [queryParams]="t.params">
              <span class="tile-icon"><app-icon [name]="t.icon" [size]="28" [stroke]="1.6" /></span>
              <strong>{{ t.label }}</strong>
              <span class="muted small">{{ t.count }} {{ t.count === 1 ? 'ad' : 'ads' }}</span>
            </a>
          }
        </div>
      </section>

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
              <h2>Businesses on Prona</h2>
              <p class="muted small">Agencies, developers, car dealers and rent-a-car companies with their own pages</p>
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
          <p class="muted">Post a home, a room for the night, land, a car or your whole rental fleet. It’s free, and takes about three minutes.</p>
        </div>
        <a class="btn big" [routerLink]="auth.isLoggedIn() ? '/post' : '/register'"><app-icon name="plus" /> Post an ad</a>
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

  protected readonly unit = computed(() => {
    const d = this.intent().criteria.dealType;
    return d === 'RentMonthly' ? ' / month' : d === 'RentNightly' ? ' / night' : d === 'RentDaily' ? ' / day' : '';
  });

  /** One tile per category, plus "Stays" since per-night rentals are their own world. */
  protected readonly tiles = computed(() => {
    const tiles: { label: string; icon: string; count: string | number; params: object }[] = [];
    for (const cat of this.catalog.categories()) {
      tiles.push({
        label: cat.name,
        icon: cat.icon,
        count: formatNumber(this.catalog.liveCount(cat) - this.catalog.liveCount(cat, 'RentNightly')),
        params: { category: cat.key, vertical: cat.vertical },
      });
    }
    const stays = this.catalog.categories().reduce((n, cat) => n + this.catalog.liveCount(cat, 'RentNightly'), 0);
    tiles.splice(2, 0, { label: 'Stays', icon: 'bed', count: formatNumber(stays), params: { dealType: 'RentNightly' } });
    const rentals = this.catalog.categories().reduce((n, cat) => n + this.catalog.liveCount(cat, 'RentDaily'), 0);
    tiles.push({ label: 'Rent a car', icon: 'carKey', count: formatNumber(rentals), params: { vertical: 'vehicles', dealType: 'RentDaily' } });
    return tiles;
  });

  constructor() {
    RAILS.forEach((r, i) =>
      this.api.search(r.criteria, 1, 8).subscribe((page) =>
        this.rails.update((rails) => rails.map((x, j) => (j === i ? { ...x, items: page.items } : x))),
      ),
    );
    this.api.businesses().subscribe((b) => this.businesses.set(b.slice(0, 8)));
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
