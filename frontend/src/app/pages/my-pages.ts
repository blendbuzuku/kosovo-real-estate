import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../core/api.service';
import { Auth } from '../core/auth';
import { criteriaToParams } from '../core/criteria';
import { BUSINESS_KINDS, LabelPipe, PricePipe, STATUS, entries, placeLabel } from '../core/labels';
import { BusinessKind, ListingStatus, ListingSummary, SavedSearch } from '../core/models';
import { Catalog } from '../core/catalog';
import { ListingCard } from '../shared/listing-card';

const RENEW_WINDOW_MS = 7 * 24 * 3600 * 1000;

@Component({
  selector: 'app-my-listings',
  imports: [RouterLink, DatePipe, PricePipe, LabelPipe],
  template: `
    <div class="container">
      <div class="title-row">
        <h1>My ads</h1>
        <a class="btn" routerLink="/post">+ Post an ad</a>
      </div>
      <div class="tabs">
        @for (t of tabs; track t.label) {
          <button type="button" [class.active]="tab() === t.status" (click)="tab.set(t.status)">
            {{ t.label }} <span class="count">{{ countFor(t.status) }}</span>
          </button>
        }
      </div>
      @if (error()) {
        <p class="error">{{ error() }}</p>
      }
      <div class="rows">
        @for (l of visible(); track l.id) {
          <div class="card row-item">
            <a [routerLink]="['/listings', l.id]" class="row-thumb">
              @if (l.thumbnailUrl) {
                <img [src]="l.thumbnailUrl" alt="" />
              } @else {
                <div class="thumb-placeholder">No photo</div>
              }
            </a>
            <div class="row-main">
              <a [routerLink]="['/listings', l.id]"><strong>{{ l.title }}</strong></a>
              <div class="muted small">{{ l.priceEur | price: l.dealType }} · {{ place(l) }}</div>
              <div class="small">
                <span class="status-pill" [attr.data-status]="l.status">{{ l.status | label: statuses }}</span>
                @if (l.status === 'Active' && l.expiresAt) {
                  <span class="muted"> until {{ l.expiresAt | date: 'd MMM y' }}</span>
                }
              </div>
            </div>
            <div class="row-actions">
              @if (l.dealType === 'Job') {
                <a class="btn small" [routerLink]="['/my-ads', l.id, 'applicants']">Applicants</a>
              }
              <a class="btn small ghost" [routerLink]="['/my-ads', l.id, 'edit']">Edit</a>
              @if (canRenew(l)) {
                <button type="button" class="btn small" (click)="renew(l)">Renew 60 days</button>
              }
              @if (l.status === 'Active') {
                <button type="button" class="btn small ghost" (click)="archive(l)">{{ l.dealType === 'Job' ? 'Mark filled' : 'Mark sold/rented' }}</button>
              }
              <button type="button" class="btn small ghost danger" (click)="remove(l)">Delete</button>
            </div>
          </div>
        } @empty {
          <div class="card empty">
            <p class="muted">Nothing here yet.</p>
          </div>
        }
      </div>
    </div>
  `,
})
export class MyListingsPage {
  private readonly api = inject(Api);
  protected readonly statuses = STATUS;
  protected readonly tabs: { label: string; status: ListingStatus | null }[] = [
    { label: 'All', status: null },
    { label: 'Live', status: 'Active' },
    { label: 'In review', status: 'PendingReview' },
    { label: 'Drafts', status: 'Draft' },
    { label: 'Needs changes', status: 'Rejected' },
    { label: 'Expired', status: 'Expired' },
    { label: 'Sold / rented', status: 'Archived' },
  ];
  protected readonly tab = signal<ListingStatus | null>(null);
  protected readonly listings = signal<ListingSummary[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly visible = computed(() => {
    const t = this.tab();
    return t ? this.listings().filter((l) => l.status === t) : this.listings();
  });

  constructor() {
    this.reload();
  }

  protected place(l: ListingSummary) {
    return placeLabel(l);
  }

  protected countFor(status: ListingStatus | null) {
    return status ? this.listings().filter((l) => l.status === status).length : this.listings().length;
  }

  protected canRenew(l: ListingSummary) {
    if (l.status === 'Expired') return true;
    return l.status === 'Active' && !!l.expiresAt && new Date(l.expiresAt).getTime() - Date.now() <= RENEW_WINDOW_MS;
  }

  protected renew(l: ListingSummary) {
    this.api.renewListing(l.id).subscribe({ next: () => this.reload(), error: (e) => this.error.set(errorMessage(e)) });
  }

  protected archive(l: ListingSummary) {
    if (!confirm('Mark as sold or rented? It will be taken off the site.')) return;
    this.api.archiveListing(l.id).subscribe({ next: () => this.reload(), error: (e) => this.error.set(errorMessage(e)) });
  }

  protected remove(l: ListingSummary) {
    if (!confirm(`Delete “${l.title}” permanently?`)) return;
    this.api.deleteListing(l.id).subscribe({ next: () => this.reload(), error: (e) => this.error.set(errorMessage(e)) });
  }

  private reload() {
    this.api.myListings().subscribe({
      next: (r) => this.listings.set(r.items),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }
}

@Component({
  selector: 'app-favorites',
  imports: [ListingCard, RouterLink],
  template: `
    <div class="container">
      <h1>Favorites</h1>
      <div class="grid">
        @for (l of listings(); track l.id) {
          <div class="fav-wrap" [class.inactive]="l.status !== 'Active'">
            <app-listing-card [listing]="l" />
            @if (l.status !== 'Active') {
              <span class="chip gone">No longer available</span>
            }
          </div>
        } @empty {
          <div class="card empty">
            <p>You haven’t saved any ads yet. Tap the ♡ on an ad to keep it here.</p>
            <a class="btn" routerLink="/search">Start searching</a>
          </div>
        }
      </div>
    </div>
  `,
})
export class FavoritesPage {
  protected readonly listings = signal<ListingSummary[]>([]);
  constructor() {
    inject(Api).favorites().subscribe((l) => this.listings.set(l));
  }
}

@Component({
  selector: 'app-saved-searches',
  imports: [RouterLink, DatePipe],
  template: `
    <div class="container narrow-page">
      <h1>Saved searches</h1>
      <p class="muted">We check for new matches every 15 minutes and email you a summary.</p>
      @for (s of searches(); track s.id) {
        <div class="card row-item">
          <div class="row-main">
            <a routerLink="/search" [queryParams]="params(s)"><strong>{{ s.name }}</strong></a>
            <div class="muted small">Saved {{ s.createdAt | date: 'd MMM y' }}</div>
          </div>
          <div class="row-actions">
            <label class="check"><input type="checkbox" [checked]="s.emailAlerts" (change)="toggle(s)" /> Email alerts</label>
            <button type="button" class="btn small ghost danger" (click)="remove(s)">Delete</button>
          </div>
        </div>
      } @empty {
        <div class="card empty">
          <p>No saved searches. Set your filters on the search page and press “Save search”.</p>
          <a class="btn" routerLink="/search">Go to search</a>
        </div>
      }
    </div>
  `,
})
export class SavedSearchesPage {
  private readonly api = inject(Api);
  protected readonly searches = signal<SavedSearch[]>([]);

  constructor() {
    this.api.savedSearches().subscribe((s) => this.searches.set(s));
  }

  protected params(s: SavedSearch) {
    return criteriaToParams(s.criteria);
  }

  protected toggle(s: SavedSearch) {
    this.api.setSearchAlerts(s.id, !s.emailAlerts).subscribe((updated) =>
      this.searches.set(this.searches().map((x) => (x.id === s.id ? updated : x))),
    );
  }

  protected remove(s: SavedSearch) {
    this.api.deleteSavedSearch(s.id).subscribe(() => this.searches.set(this.searches().filter((x) => x.id !== s.id)));
  }
}

@Component({
  selector: 'app-profile',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <div class="container narrow-page">
      <h1>Your profile</h1>
      <form class="card" [formGroup]="profile" (ngSubmit)="saveProfile()">
        <p class="muted small">{{ auth.user()?.email }}</p>
        <label class="stack"><span>Name</span><input formControlName="displayName" /></label>
        <label class="stack"><span>Phone</span><input type="tel" formControlName="phone" /></label>
        <button class="btn" type="submit" [disabled]="profile.invalid">Save</button>
        @if (profileMessage()) {
          <p class="notice">{{ profileMessage() }}</p>
        }
      </form>

      @if (auth.user()?.business; as business) {
        <form class="card" [formGroup]="businessForm" (ngSubmit)="saveBusiness()">
          <h2>Business page</h2>
          <p class="muted small">Public at <a [routerLink]="['/businesses', business.slug]">/businesses/{{ business.slug }}</a></p>
          <label class="stack"><span>Business name</span><input formControlName="name" /></label>
          <label class="stack">
            <span>Type of business</span>
            <select formControlName="kind">
              @for (k of kinds; track k.value) {
                <option [value]="k.value">{{ k.label }}</option>
              }
            </select>
          </label>
          <label class="stack">
            <span>Municipality</span>
            <select formControlName="municipality">
              <option value="">Choose…</option>
              @for (m of catalog.locations(); track m.name) {
                <option [value]="m.name">{{ m.name }}</option>
              }
            </select>
          </label>
          <label class="stack"><span>Address</span><input formControlName="address" /></label>
          <label class="stack"><span>Website</span><input type="url" formControlName="website" placeholder="https://" /></label>
          <label class="stack"><span>About</span><textarea rows="4" formControlName="description"></textarea></label>
          <button class="btn" type="submit" [disabled]="businessForm.invalid">Save business page</button>
          @if (businessMessage()) {
            <p class="notice">{{ businessMessage() }}</p>
          }
        </form>
      }
    </div>
  `,
})
export class ProfilePage {
  private readonly api = inject(Api);
  protected readonly auth = inject(Auth);
  private readonly fb = inject(FormBuilder);
  protected readonly profileMessage = signal<string | null>(null);
  protected readonly businessMessage = signal<string | null>(null);
  protected readonly catalog = inject(Catalog);
  protected readonly kinds = entries(BUSINESS_KINDS);

  protected readonly profile = this.fb.nonNullable.group({
    displayName: [this.auth.user()?.displayName ?? '', [Validators.required, Validators.minLength(2)]],
    phone: [this.auth.user()?.phone ?? ''],
  });

  protected readonly businessForm = this.fb.nonNullable.group({
    name: [this.auth.user()?.business?.name ?? '', Validators.required],
    kind: [(this.auth.user()?.business?.kind ?? 'Other') as BusinessKind],
    municipality: [this.auth.user()?.business?.municipality ?? ''],
    address: [this.auth.user()?.business?.address ?? ''],
    website: [this.auth.user()?.business?.website ?? ''],
    description: [this.auth.user()?.business?.description ?? ''],
  });

  protected saveProfile() {
    const v = this.profile.getRawValue();
    this.api.updateMe({ displayName: v.displayName, phone: v.phone || null }).subscribe({
      next: (u) => {
        this.auth.updateUser(u);
        this.profileMessage.set('Saved.');
      },
      error: (e) => this.profileMessage.set(errorMessage(e)),
    });
  }

  protected saveBusiness() {
    const v = this.businessForm.getRawValue();
    this.api
      .updateMyBusiness({
        name: v.name,
        kind: v.kind,
        municipality: v.municipality || null,
        address: v.address || null,
        website: v.website || null,
        description: v.description || null,
      })
      .subscribe({
        next: () => {
          this.api.me().subscribe((u) => this.auth.updateUser(u));
          this.businessMessage.set('Saved.');
        },
        error: (e) => this.businessMessage.set(errorMessage(e)),
      });
  }
}
