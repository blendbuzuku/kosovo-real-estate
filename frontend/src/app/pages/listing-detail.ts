import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../core/api.service';
import { Auth } from '../core/auth';
import {
  DEAL_TYPES,
  HEATING,
  LEGALIZATION,
  LabelPipe,
  PROPERTY_TYPES,
  PricePipe,
  REPORT_REASONS,
  STATUS,
  entries,
} from '../core/labels';
import { ListingDetail, ReportReason } from '../core/models';
import { Favorites } from '../core/stores';
import { MapView } from '../shared/map-view';

@Component({
  selector: 'app-listing-detail',
  imports: [RouterLink, FormsModule, MapView, PricePipe, LabelPipe, DecimalPipe, DatePipe],
  template: `
    <div class="container detail">
      @if (error()) {
        <div class="card empty">
          <p><strong>{{ error() }}</strong></p>
          <a routerLink="/" class="btn">Back to search</a>
        </div>
      }
      @if (listing(); as l) {
        @if (l.isMine && l.status !== 'Active') {
          <div class="notice" [class.warn]="l.status === 'Rejected'">
            This listing is <strong>{{ l.status | label: statuses }}</strong>.
            @if (l.moderationNote) {
              Reviewer’s note: “{{ l.moderationNote }}”
            }
            <a [routerLink]="['/my-listings', l.id, 'edit']">Edit listing</a>
          </div>
        }

        <div class="gallery">
          @if (l.photos.length) {
            <img class="main-photo" [src]="l.photos[photoIndex()].url" [alt]="l.title" />
            @if (l.photos.length > 1) {
              <button type="button" class="nav prev" aria-label="Previous photo" (click)="step(-1)">‹</button>
              <button type="button" class="nav next" aria-label="Next photo" (click)="step(1)">›</button>
              <span class="counter">{{ photoIndex() + 1 }} / {{ l.photos.length }}</span>
            }
          } @else {
            <div class="thumb-placeholder big">No photos</div>
          }
        </div>
        @if (l.photos.length > 1) {
          <div class="thumbs">
            @for (p of l.photos; track p.id; let i = $index) {
              <button type="button" [class.active]="i === photoIndex()" (click)="photoIndex.set(i)">
                <img [src]="p.thumbnailUrl" alt="" loading="lazy" />
              </button>
            }
          </div>
        }

        <div class="detail-grid">
          <div>
            <div class="title-row">
              <div>
                <span class="chip">{{ l.dealType | label: deals }}</span>
                <h1>{{ l.title }}</h1>
                <p class="muted">{{ l.address ? l.address + ', ' : '' }}{{ l.neighborhood ? l.neighborhood + ', ' : '' }}{{ l.city }}</p>
              </div>
              <div class="price-block">
                <div class="price big">{{ l.priceEur | price: l.dealType }}</div>
                @if (l.pricePerM2 && l.dealType === 'Sale') {
                  <div class="muted">{{ l.pricePerM2 | number: '1.0-0' }} € / m²</div>
                }
              </div>
            </div>

            <section class="card">
              <h2>Key facts</h2>
              <dl class="facts-grid">
                <div><dt>Type</dt><dd>{{ l.propertyType | label: types }}</dd></div>
                <div><dt>Area</dt><dd>{{ l.areaM2 }} m²</dd></div>
                @if (l.rooms != null) { <div><dt>Rooms</dt><dd>{{ l.rooms }}</dd></div> }
                @if (l.bathrooms != null) { <div><dt>Bathrooms</dt><dd>{{ l.bathrooms }}</dd></div> }
                @if (l.floor != null) {
                  <div><dt>Floor</dt><dd>{{ l.floor }}{{ l.totalFloors ? ' of ' + l.totalFloors : '' }}</dd></div>
                }
                @if (l.yearBuilt) { <div><dt>Built</dt><dd>{{ l.yearBuilt }}</dd></div> }
                <div><dt>Heating</dt><dd>{{ l.heating | label: heating }}</dd></div>
                <div><dt>Parking</dt><dd>{{ l.hasParking ? 'Yes' : 'No' }}</dd></div>
                <div><dt>Furnished</dt><dd>{{ l.isFurnished ? 'Yes' : 'No' }}</dd></div>
                <div><dt>Elevator</dt><dd>{{ l.hasElevator ? 'Yes' : 'No' }}</dd></div>
                <div><dt>Balcony</dt><dd>{{ l.hasBalcony ? 'Yes' : 'No' }}</dd></div>
              </dl>
            </section>

            <section class="card legal-panel">
              <h2>Legal status</h2>
              <p class="muted small">As declared by the poster. Always check documents with a notary before paying anything.</p>
              <ul class="legal-list">
                <li [class]="legalClass(l.legal.legalization === 'Legalized' || l.legal.legalization === 'NotRequired' ? true : l.legal.legalization === 'Unknown' || l.legal.legalization === 'InProcess' ? null : false)">
                  <span class="dot"></span>
                  <div><strong>Building legalization</strong><br />{{ l.legal.legalization | label: legalization }}</div>
                </li>
                <li [class]="legalClass(l.legal.hasCadastreCertificate)">
                  <span class="dot"></span>
                  <div><strong>Cadastre certificate (certifikata e pronësisë)</strong><br />{{ yesNo(l.legal.hasCadastreCertificate) }}</div>
                </li>
                <li [class]="legalClass(l.legal.hasConstructionPermit)">
                  <span class="dot"></span>
                  <div><strong>Construction permit (leje ndërtimi)</strong><br />{{ yesNo(l.legal.hasConstructionPermit) }}</div>
                </li>
              </ul>
              @if (l.legal.notes) {
                <p class="legal-notes">{{ l.legal.notes }}</p>
              }
            </section>

            <section class="card">
              <h2>Description</h2>
              <p class="description">{{ l.description }}</p>
            </section>

            <section class="card">
              <h2>Location</h2>
              <app-map-view class="detail-map" [marker]="{ lat: l.lat, lng: l.lng }" [center]="{ lat: l.lat, lng: l.lng, zoom: 15 }" />
            </section>

            <p class="muted small">
              Published {{ l.publishedAt | date: 'd MMM y' }} · {{ l.viewCount }} views
              @if (l.expiresAt) { · Listed until {{ l.expiresAt | date: 'd MMM y' }} }
            </p>
          </div>

          <aside class="contact-col">
            <div class="card contact">
              <div class="poster">
                <div class="avatar">{{ l.owner.displayName.charAt(0) }}</div>
                <div>
                  @if (l.owner.isAgency && l.owner.agencySlug) {
                    <a [routerLink]="['/agencies', l.owner.agencySlug]"><strong>{{ l.owner.agencyName }}</strong></a>
                    <div class="muted small">Agency</div>
                  } @else {
                    <strong>{{ l.owner.displayName }}</strong>
                    <div class="muted small">Private owner</div>
                  }
                </div>
              </div>

              @if (l.isMine) {
                <a class="btn block" [routerLink]="['/my-listings', l.id, 'edit']">Edit your listing</a>
              } @else {
                @if (l.owner.hasPhone) {
                  @if (phone()) {
                    <a class="btn block" [href]="'tel:' + phone()">📞 {{ phone() }}</a>
                  } @else {
                    <button type="button" class="btn block" (click)="revealPhone()">Show phone number</button>
                  }
                }

                @if (auth.isLoggedIn()) {
                  @if (sentConversationId()) {
                    <p class="notice">Message sent. <a [routerLink]="['/messages', sentConversationId()]">Open conversation</a></p>
                  } @else {
                    <label class="stack">
                      <span>Message</span>
                      <textarea rows="4" [(ngModel)]="messageText" maxlength="4000"></textarea>
                    </label>
                    <button type="button" class="btn block ghost" [disabled]="!messageText.trim() || sending()" (click)="sendMessage()">
                      Send message
                    </button>
                  }
                  <button type="button" class="btn block ghost" (click)="favorites.toggle(l.id)">
                    {{ isFavorite() ? '♥ Saved' : '♡ Save to favorites' }}
                  </button>
                } @else {
                  <a class="btn block ghost" routerLink="/login" [queryParams]="{ returnUrl: '/listings/' + l.id }">Log in to send a message</a>
                }
                @if (contactError()) {
                  <p class="error">{{ contactError() }}</p>
                }
              }
            </div>

            @if (auth.isLoggedIn() && !l.isMine) {
              @if (reportOpen()) {
                <div class="card">
                  <h3>Report this listing</h3>
                  @if (reported()) {
                    <p class="notice">Thanks. Our team will review it.</p>
                  } @else {
                    <label class="stack">
                      <span>What’s wrong?</span>
                      <select [(ngModel)]="reportReason">
                        @for (r of reasons; track r.value) {
                          <option [value]="r.value">{{ r.label }}</option>
                        }
                      </select>
                    </label>
                    <label class="stack">
                      <span>Details (optional)</span>
                      <textarea rows="3" [(ngModel)]="reportComment" maxlength="1000"></textarea>
                    </label>
                    <button type="button" class="btn small danger" (click)="sendReport()">Send report</button>
                  }
                </div>
              } @else {
                <button type="button" class="link report-link" (click)="reportOpen.set(true)">⚑ Report listing</button>
              }
            }
          </aside>
        </div>
      }
    </div>
  `,
})
export class ListingDetailPage {
  readonly id = input.required<string>();

  private readonly api = inject(Api);
  protected readonly auth = inject(Auth);
  protected readonly favorites = inject(Favorites);

  protected readonly types = PROPERTY_TYPES;
  protected readonly deals = DEAL_TYPES;
  protected readonly heating = HEATING;
  protected readonly legalization = LEGALIZATION;
  protected readonly statuses = STATUS;
  protected readonly reasons = entries(REPORT_REASONS);

  protected readonly listing = signal<ListingDetail | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly photoIndex = signal(0);
  protected readonly phone = signal<string | null>(null);
  protected readonly sending = signal(false);
  protected readonly sentConversationId = signal<string | null>(null);
  protected readonly contactError = signal<string | null>(null);
  protected readonly reportOpen = signal(false);
  protected readonly reported = signal(false);
  protected readonly isFavorite = computed(() => {
    const l = this.listing();
    return !!l && this.favorites.has(l.id);
  });

  protected messageText = 'Hello, is this property still available? I would like to arrange a viewing.';
  protected reportReason: ReportReason = 'WrongInformation';
  protected reportComment = '';

  constructor() {
    effect(() => {
      const id = this.id();
      this.listing.set(null);
      this.error.set(null);
      this.photoIndex.set(0);
      this.phone.set(null);
      this.api.listing(id).subscribe({
        next: (l) => this.listing.set(l),
        error: (e) => this.error.set(e.status === 404 ? 'This listing is no longer available.' : errorMessage(e)),
      });
    });
  }

  protected step(delta: number) {
    const n = this.listing()?.photos.length ?? 0;
    if (n) this.photoIndex.set((this.photoIndex() + delta + n) % n);
  }

  protected revealPhone() {
    this.api.phone(this.id()).subscribe({
      next: (r) => this.phone.set(r.phone),
      error: (e) => this.contactError.set(errorMessage(e)),
    });
  }

  protected sendMessage() {
    this.sending.set(true);
    this.contactError.set(null);
    this.api.sendFirstMessage(this.id(), this.messageText.trim()).subscribe({
      next: (c) => {
        this.sending.set(false);
        this.sentConversationId.set(c.id);
      },
      error: (e) => {
        this.sending.set(false);
        this.contactError.set(errorMessage(e));
      },
    });
  }

  protected sendReport() {
    this.api.report(this.id(), this.reportReason, this.reportComment.trim() || null).subscribe({
      next: () => this.reported.set(true),
      error: (e) => this.contactError.set(errorMessage(e)),
    });
  }

  protected yesNo(v: boolean | null | undefined) {
    return v === true ? 'Yes' : v === false ? 'No' : 'Not specified';
  }

  protected legalClass(v: boolean | null | undefined) {
    return v === true ? 'ok' : v === false ? 'bad' : 'unknown';
  }
}
