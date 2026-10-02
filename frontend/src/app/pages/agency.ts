import { DatePipe } from '@angular/common';
import { Component, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { AgencyProfile, ListingSummary } from '../core/models';
import { ListingCard } from '../shared/listing-card';

@Component({
  selector: 'app-agency',
  imports: [ListingCard, DatePipe],
  template: `
    <div class="container">
      @if (agency(); as a) {
        <section class="card agency-head">
          <div class="avatar big">{{ a.name.charAt(0) }}</div>
          <div>
            <h1>{{ a.name }}</h1>
            <p class="muted">
              {{ a.city ? a.city + ' · ' : '' }}{{ a.activeListings }} live listings · on Prona since {{ a.memberSince | date: 'MMM y' }}
            </p>
            @if (a.description) {
              <p>{{ a.description }}</p>
            }
            <p>
              @if (a.phone) {
                <a class="btn small" [href]="'tel:' + a.phone">📞 {{ a.phone }}</a>
              }
              @if (a.website) {
                <a class="btn small ghost" [href]="a.website" target="_blank" rel="noopener">Website</a>
              }
            </p>
          </div>
        </section>
        <h2>Listings</h2>
        <div class="grid">
          @for (l of listings(); track l.id) {
            <app-listing-card [listing]="l" />
          } @empty {
            <p class="muted">No live listings right now.</p>
          }
        </div>
      } @else if (notFound()) {
        <p class="card empty">This agency doesn’t exist.</p>
      }
    </div>
  `,
})
export class AgencyPage {
  readonly slug = input.required<string>();
  private readonly api = inject(Api);
  protected readonly agency = signal<AgencyProfile | null>(null);
  protected readonly listings = signal<ListingSummary[]>([]);
  protected readonly notFound = signal(false);

  constructor() {
    effect(() => {
      const slug = this.slug();
      this.api.agency(slug).subscribe({ next: (a) => this.agency.set(a), error: () => this.notFound.set(true) });
      this.api.agencyListings(slug).subscribe({ next: (r) => this.listings.set(r.items), error: () => {} });
    });
  }
}

@Component({
  selector: 'app-agencies',
  imports: [RouterLink],
  template: `
    <div class="container">
      <h1>Agencies</h1>
      <div class="grid">
        @for (a of agencies(); track a.id) {
          <a class="card agency-tile" [routerLink]="['/agencies', a.slug]">
            <div class="avatar">{{ a.name.charAt(0) }}</div>
            <div>
              <strong>{{ a.name }}</strong>
              <div class="muted small">{{ a.city }} · {{ a.activeListings }} live listings</div>
            </div>
          </a>
        } @empty {
          <p class="muted">No agencies yet.</p>
        }
      </div>
    </div>
  `,
})
export class AgenciesPage {
  protected readonly agencies = signal<AgencyProfile[]>([]);
  constructor() {
    inject(Api).agencies().subscribe((a) => this.agencies.set(a));
  }
}
