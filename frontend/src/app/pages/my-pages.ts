import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../core/api.service';
import { Auth } from '../core/auth';
import { criteriaToParams } from '../core/criteria';
import { LabelPipe, PricePipe, STATUS } from '../core/labels';
import { ListingStatus, ListingSummary, SavedSearch } from '../core/models';
import { ListingCard } from '../shared/listing-card';

const RENEW_WINDOW_MS = 7 * 24 * 3600 * 1000;

@Component({
  selector: 'app-my-listings',
  imports: [RouterLink, DatePipe, PricePipe, LabelPipe],
  template: `
    <div class="container">
      <div class="title-row">
        <h1>My listings</h1>
        <a class="btn" routerLink="/my-listings/new">+ Post a property</a>
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
              <div class="muted small">{{ l.priceEur | price: l.dealType }} · {{ l.city }}</div>
              <div class="small">
                <span class="status-pill" [attr.data-status]="l.status">{{ l.status | label: statuses }}</span>
                @if (l.status === 'Active' && l.expiresAt) {
                  <span class="muted"> until {{ l.expiresAt | date: 'd MMM y' }}</span>
                }
              </div>
            </div>
            <div class="row-actions">
              <a class="btn small ghost" [routerLink]="['/my-listings', l.id, 'edit']">Edit</a>
              @if (canRenew(l)) {
                <button type="button" class="btn small" (click)="renew(l)">Renew 60 days</button>
              }
              @if (l.status === 'Active') {
                <button type="button" class="btn small ghost" (click)="archive(l)">Mark sold/rented</button>
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
            <p>You haven’t saved any listings yet. Tap the ♡ on a listing to keep it here.</p>
            <a class="btn" routerLink="/">Start searching</a>
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
            <a routerLink="/" [queryParams]="params(s)"><strong>{{ s.name }}</strong></a>
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
          <a class="btn" routerLink="/">Go to search</a>
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
  imports: [ReactiveFormsModule],
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

      @if (auth.user()?.agency; as agency) {
        <form class="card" [formGroup]="agencyForm" (ngSubmit)="saveAgency()">
          <h2>Agency page</h2>
          <p class="muted small">Public at /agencies/{{ agency.slug }}</p>
          <label class="stack"><span>Agency name</span><input formControlName="name" /></label>
          <label class="stack"><span>City</span><input formControlName="city" /></label>
          <label class="stack"><span>Website</span><input type="url" formControlName="website" placeholder="https://" /></label>
          <label class="stack"><span>About</span><textarea rows="4" formControlName="description"></textarea></label>
          <button class="btn" type="submit" [disabled]="agencyForm.invalid">Save agency</button>
          @if (agencyMessage()) {
            <p class="notice">{{ agencyMessage() }}</p>
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
  protected readonly agencyMessage = signal<string | null>(null);

  protected readonly profile = this.fb.nonNullable.group({
    displayName: [this.auth.user()?.displayName ?? '', [Validators.required, Validators.minLength(2)]],
    phone: [this.auth.user()?.phone ?? ''],
  });

  protected readonly agencyForm = this.fb.nonNullable.group({
    name: [this.auth.user()?.agency?.name ?? '', Validators.required],
    city: [this.auth.user()?.agency?.city ?? ''],
    website: [this.auth.user()?.agency?.website ?? ''],
    description: [this.auth.user()?.agency?.description ?? ''],
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

  protected saveAgency() {
    const v = this.agencyForm.getRawValue();
    this.api
      .updateMyAgency({ name: v.name, city: v.city || null, website: v.website || null, description: v.description || null })
      .subscribe({
        next: () => {
          this.api.me().subscribe((u) => this.auth.updateUser(u));
          this.agencyMessage.set('Saved.');
        },
        error: (e) => this.agencyMessage.set(errorMessage(e)),
      });
  }
}
