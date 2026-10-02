import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../core/api.service';
import { Auth } from '../core/auth';
import { Catalog, appliesTo, formatField } from '../core/catalog';
import { BUSINESS_KINDS, DEAL_TYPES, DEAL_UNIT, LabelPipe, PricePipe, REPORT_REASONS, STATUS, entries, formatEur, placeLabel } from '../core/labels';
import { FieldDef, ListingDetail, ListingSummary, ReportReason } from '../core/models';
import { Favorites } from '../core/stores';
import { Icon } from '../shared/icon';
import { ListingCard } from '../shared/listing-card';
import { MapView } from '../shared/map-view';

interface SpecGroup {
  name: string;
  rows: { label: string; value: string }[];
  features: string[];
}

interface LegalRow {
  label: string;
  value: string;
  tone: 'ok' | 'warn' | 'bad' | 'unknown';
  help?: string | null;
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

@Component({
  selector: 'app-listing-detail',
  imports: [RouterLink, FormsModule, DatePipe, PricePipe, LabelPipe, Icon, ListingCard, MapView],
  host: { '(document:keydown)': 'onKey($event)' },
  template: `
    @if (error()) {
      <div class="container narrow-page">
        <div class="card empty">
          <app-icon name="search" [size]="36" />
          <h2>{{ error() }}</h2>
          <a class="btn" routerLink="/search">Browse other ads</a>
        </div>
      </div>
    }
    @if (listing(); as l) {
      <div class="container detail">
        <nav class="crumbs" aria-label="Breadcrumb">
          <a routerLink="/search" [queryParams]="{ vertical: category()?.vertical }">{{ category()?.vertical === 'vehicles' ? 'Vehicles' : 'Property' }}</a>
          <app-icon name="chevronRight" [size]="14" />
          <a routerLink="/search" [queryParams]="{ category: l.category, dealType: l.dealType }">{{ category()?.name }}</a>
          <app-icon name="chevronRight" [size]="14" />
          <a routerLink="/search" [queryParams]="{ category: l.category, dealType: l.dealType, municipality: l.municipality }">{{ l.municipality }}</a>
          @if (l.place) {
            <app-icon name="chevronRight" [size]="14" />
            <a routerLink="/search" [queryParams]="{ category: l.category, dealType: l.dealType, municipality: l.municipality, place: l.place }">{{ l.place }}</a>
          }
        </nav>

        @if (l.isMine || l.status !== 'Active') {
          <div class="notice owner-banner" [class.warn]="l.status === 'Rejected'">
            <span>
              <span class="status-pill" [attr.data-status]="l.status">{{ l.status | label: statuses }}</span>
              @if (l.moderationNote) {
                <strong> Moderator: </strong>{{ l.moderationNote }}
              } @else if (l.status === 'Active') {
                Live until {{ l.expiresAt | date: 'd MMM y' }} · {{ l.viewCount }} views
              }
            </span>
            @if (l.isMine) {
              <a class="btn small ghost" [routerLink]="['/my-ads', l.id, 'edit']"><app-icon name="edit" [size]="16" /> Edit ad</a>
            }
          </div>
        }

        <div class="detail-title">
          <div>
            <h1>{{ l.title }}</h1>
            <p class="muted"><app-icon name="pin" [size]="16" /> {{ placeText() }}{{ l.address ? ' · ' + l.address : '' }}</p>
          </div>
          <div class="title-actions">
            <button type="button" class="btn ghost small" (click)="share()"><app-icon name="share" [size]="16" /> {{ shared() ? 'Link copied' : 'Share' }}</button>
            @if (auth.isLoggedIn() && !l.isMine) {
              <button type="button" class="btn ghost small" [class.on]="isFavorite()" (click)="favorites.toggle(l.id)">
                <app-icon name="heart" [size]="16" /> {{ isFavorite() ? 'Saved' : 'Save' }}
              </button>
            }
          </div>
        </div>

        <div class="gallery" [class.single]="l.photos.length > 0 && l.photos.length < 3" [class.none]="!l.photos.length">
          @if (l.photos.length) {
            <button type="button" class="g-main" (click)="openViewer(0)">
              <img [src]="l.photos[0].url" [alt]="l.title" />
            </button>
            @for (p of l.photos.slice(1, 5); track p.id; let i = $index) {
              <button type="button" class="g-side" (click)="openViewer(i + 1)">
                <img [src]="p.thumbnailUrl" alt="" loading="lazy" />
              </button>
            }
            @if (l.photos.length > 1) {
              <button type="button" class="btn small ghost g-all" (click)="openViewer(0)">
                <app-icon name="camera" [size]="16" /> All {{ l.photos.length }} photos
              </button>
            }
          } @else {
            <div class="g-main thumb-placeholder big"><app-icon [name]="category()?.icon ?? 'sparkles'" [size]="64" [stroke]="1.2" /></div>
          }
        </div>

        <div class="detail-grid">
          <div class="detail-main">
            @if (keyFacts().length) {
              <div class="key-facts">
                @for (f of keyFacts(); track f.label) {
                  <div class="key-fact">
                    <span class="muted small">{{ f.label }}</span>
                    <strong>{{ f.value }}</strong>
                  </div>
                }
              </div>
            }

            <section class="dsec">
              <h2>About this {{ category()?.vertical === 'vehicles' ? 'vehicle' : dealNoun() }}</h2>
              <p class="description">{{ l.description }}</p>
            </section>

            @for (g of specs(); track g.name) {
              <section class="dsec">
                <h2>{{ g.name }}</h2>
                @if (g.rows.length) {
                  <dl class="spec-list">
                    @for (r of g.rows; track r.label) {
                      <div><dt>{{ r.label }}</dt><dd>{{ r.value }}</dd></div>
                    }
                  </dl>
                }
                @if (g.features.length) {
                  <ul class="feature-list">
                    @for (f of g.features; track f) {
                      <li><app-icon name="check" [size]="16" [stroke]="2.4" /> {{ f }}</li>
                    }
                  </ul>
                }
              </section>
            }

            @if (legal().length) {
              <section class="dsec legal-panel">
                <h2><app-icon name="shield" /> Legal status</h2>
                <p class="muted small">Declared by the poster. Check the documents with a notary and the cadastre before paying anything.</p>
                <ul class="legal-list">
                  @for (r of legal(); track r.label) {
                    <li [class]="r.tone">
                      <span class="dot"></span>
                      <span><strong>{{ r.label }}</strong><span class="muted small">{{ r.help }}</span></span>
                      <span class="legal-value">{{ r.value }}</span>
                    </li>
                  }
                </ul>
                @if (l.attributes['legalNotes']) {
                  <p class="legal-notes">“{{ l.attributes['legalNotes'] }}”</p>
                }
              </section>
            }

            <section class="dsec">
              <h2>Location</h2>
              <p class="muted">{{ placeText() }}{{ l.address ? ', ' + l.address : '' }}</p>
              <div class="detail-map">
                <app-map-view [marker]="{ lat: l.lat, lng: l.lng }" [center]="{ lat: l.lat, lng: l.lng, zoom: l.place || l.address ? 15 : 12 }" />
              </div>
            </section>
          </div>

          <aside class="contact-col" id="contact">
            <div class="card contact-card">
              <div class="price-block">
                <span class="price big">{{ l.priceEur | price: l.dealType }}</span>
                @if (l.negotiable) {
                  <span class="badge">Negotiable</span>
                }
                @if (l.pricePerM2 && l.dealType === 'Sale') {
                  <div class="muted small">{{ eur(l.pricePerM2) }} per m²</div>
                }
                @if (deposit()) {
                  <div class="muted small">Deposit {{ eur(deposit()!) }}</div>
                }
              </div>

              @if (l.isMine) {
                <a class="btn block" [routerLink]="['/my-ads', l.id, 'edit']">Edit your ad</a>
                <a class="btn block ghost" routerLink="/my-ads">All my ads</a>
              } @else if (bookable()) {
                <form class="booking" (submit)="$event.preventDefault(); requestBooking()">
                  <div class="booking-dates">
                    <label>
                      <span>{{ l.dealType === 'RentNightly' ? 'Check-in' : 'Pick-up' }}</span>
                      <input type="date" name="from" [min]="today" [(ngModel)]="from" required />
                    </label>
                    <label>
                      <span>{{ l.dealType === 'RentNightly' ? 'Check-out' : 'Return' }}</span>
                      <input type="date" name="to" [min]="from || today" [(ngModel)]="to" required />
                    </label>
                    @if (l.dealType === 'RentNightly') {
                      <label class="guests">
                        <span>Guests</span>
                        <select name="guests" [(ngModel)]="guests">
                          @for (n of guestOptions(); track n) {
                            <option [ngValue]="n">{{ n }} {{ n === 1 ? 'guest' : 'guests' }}</option>
                          }
                        </select>
                      </label>
                    }
                  </div>
                  @if (units() > 0) {
                    <div class="booking-total">
                      <span>{{ eur(l.priceEur) }} × {{ units() }} {{ unitWord() }}{{ units() === 1 ? '' : 's' }}</span>
                      <strong>{{ eur(l.priceEur * units()) }}</strong>
                    </div>
                  }
                  @if (minNights() && units() > 0 && units() < minNights()!) {
                    <p class="error small">Minimum stay is {{ minNights() }} nights.</p>
                  }
                  <label class="stack">
                    <span>Message to the {{ l.dealType === 'RentNightly' ? 'host' : 'company' }} (optional)</span>
                    <textarea name="note" rows="2" maxlength="2000" [(ngModel)]="bookingNote" placeholder="Arrival time, questions…"></textarea>
                  </label>
                  @if (bookingSentId()) {
                    <p class="notice">Request sent. <a [routerLink]="['/messages', bookingSentId()]">Open the conversation</a></p>
                  } @else {
                    <button class="btn block big" type="submit" [disabled]="units() < 1 || sending()">Request to book</button>
                    <p class="muted small center">You won’t pay anything yet. The {{ l.dealType === 'RentNightly' ? 'host' : 'company' }} confirms by message.</p>
                  }
                </form>
              } @else {
                @if (sentConversationId()) {
                  <p class="notice">Message sent. <a [routerLink]="['/messages', sentConversationId()]">Open the conversation</a></p>
                } @else {
                  <label class="stack">
                    <span>Message</span>
                    <textarea rows="4" [(ngModel)]="messageText" maxlength="4000"></textarea>
                  </label>
                  <button type="button" class="btn block" [disabled]="!messageText.trim() || sending()" (click)="sendMessage()">
                    <app-icon name="chat" [size]="18" /> Send message
                  </button>
                }
              }

              @if (!l.isMine && l.owner.hasPhone) {
                @if (phone()) {
                  <a class="btn block ghost" [href]="'tel:' + phone()"><app-icon name="phone" [size]="18" /> {{ phone() }}</a>
                } @else {
                  <button type="button" class="btn block ghost" (click)="revealPhone()"><app-icon name="phone" [size]="18" /> Show phone number</button>
                }
              }
              @if (contactError()) {
                <p class="error">{{ contactError() }}</p>
              }

              <div class="poster">
                <span class="avatar">{{ (l.owner.businessName ?? l.owner.displayName).charAt(0) }}</span>
                <div>
                  @if (l.owner.businessSlug) {
                    <a [routerLink]="['/businesses', l.owner.businessSlug]"><strong>{{ l.owner.businessName }}</strong></a>
                    <div class="muted small">{{ l.owner.businessKind | label: kinds }} · on Prona since {{ l.owner.memberSince | date: 'MMM y' }}</div>
                  } @else {
                    <strong>{{ l.owner.displayName }}</strong>
                    <div class="muted small">Private seller · on Prona since {{ l.owner.memberSince | date: 'MMM y' }}</div>
                  }
                </div>
              </div>
            </div>

            <p class="muted small meta">
              Ad posted {{ l.publishedAt ?? l.createdAt | date: 'd MMM y' }} · {{ l.viewCount }} views
            </p>

            @if (auth.isLoggedIn() && !l.isMine) {
              @if (reportOpen()) {
                <div class="card">
                  <h3>Report this ad</h3>
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
                <button type="button" class="link report-link" (click)="reportOpen.set(true)"><app-icon name="flag" [size]="14" /> Report this ad</button>
              }
            }
          </aside>
        </div>

        @if (similar().length) {
          <section class="section">
            <div class="section-head"><h2>Similar ads nearby</h2></div>
            <div class="rail">
              @for (s of similar(); track s.id) {
                <app-listing-card [listing]="s" />
              }
            </div>
          </section>
        }
      </div>

      @if (!l.isMine) {
        <div class="mobile-cta">
          <div>
            <strong>{{ l.priceEur | price: l.dealType }}</strong>
            <span class="muted small">{{ l.owner.businessName ?? l.owner.displayName }}</span>
          </div>
          <a class="btn" href="#contact" (click)="$event.preventDefault(); scrollToContact()">
            {{ bookable() ? 'Check dates' : 'Contact' }}
          </a>
        </div>
      }

      @if (viewer() !== null) {
        <div class="viewer" role="dialog" aria-modal="true" aria-label="Photos">
          <button type="button" class="icon-btn viewer-close" aria-label="Close" (click)="viewer.set(null)"><app-icon name="close" [size]="24" /></button>
          <button type="button" class="icon-btn viewer-prev" aria-label="Previous photo" (click)="step(-1)"><app-icon name="chevronLeft" [size]="28" /></button>
          <img [src]="l.photos[viewer()!].url" [alt]="l.title + ' photo ' + (viewer()! + 1)" />
          <button type="button" class="icon-btn viewer-next" aria-label="Next photo" (click)="step(1)"><app-icon name="chevronRight" [size]="28" /></button>
          <span class="viewer-count">{{ viewer()! + 1 }} / {{ l.photos.length }}</span>
        </div>
      }
    }
  `,
})
export class ListingDetailPage {
  readonly id = input.required<string>();

  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly catalog = inject(Catalog);
  protected readonly auth = inject(Auth);
  protected readonly favorites = inject(Favorites);

  protected readonly statuses = STATUS;
  protected readonly kinds = BUSINESS_KINDS;
  protected readonly reasons = entries(REPORT_REASONS);
  protected readonly today = isoDate(new Date());

  protected readonly listing = signal<ListingDetail | null>(null);
  protected readonly similar = signal<ListingSummary[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly viewer = signal<number | null>(null);
  protected readonly phone = signal<string | null>(null);
  protected readonly sending = signal(false);
  protected readonly sentConversationId = signal<string | null>(null);
  protected readonly bookingSentId = signal<string | null>(null);
  protected readonly contactError = signal<string | null>(null);
  protected readonly reportOpen = signal(false);
  protected readonly reported = signal(false);
  protected readonly shared = signal(false);

  // Booking form (plain fields for ngModel; units() reads them through signals below).
  private readonly fromSig = signal('');
  private readonly toSig = signal('');
  protected guests = 2;
  protected bookingNote = '';
  get from() {
    return this.fromSig();
  }
  set from(v: string) {
    this.fromSig.set(v);
  }
  get to() {
    return this.toSig();
  }
  set to(v: string) {
    this.toSig.set(v);
  }

  protected messageText = '';
  protected reportReason: ReportReason = 'WrongInformation';
  protected reportComment = '';

  protected readonly category = computed(() => this.catalog.category(this.listing()?.category));
  protected readonly isFavorite = computed(() => !!this.listing() && this.favorites.has(this.listing()!.id));
  protected readonly placeText = computed(() => (this.listing() ? placeLabel(this.listing()!) : ''));
  protected readonly bookable = computed(() => ['RentNightly', 'RentDaily'].includes(this.listing()?.dealType ?? ''));
  protected readonly unitWord = computed(() => DEAL_UNIT[this.listing()?.dealType ?? 'Sale']);
  protected readonly minNights = computed(() => this.num('minNights'));
  protected readonly deposit = computed(() => this.num('depositEur'));
  protected readonly guestOptions = computed(() => Array.from({ length: this.num('maxGuests') ?? 8 }, (_, i) => i + 1));
  protected readonly units = computed(() => {
    const from = Date.parse(this.fromSig());
    const to = Date.parse(this.toSig());
    return Number.isNaN(from) || Number.isNaN(to) ? 0 : Math.round((to - from) / 86_400_000);
  });

  protected readonly dealNoun = computed(() => {
    const d = this.listing()?.dealType;
    return d === 'RentNightly' ? 'stay' : 'property';
  });

  /** The category's on-card fields as big tiles under the photos. */
  protected readonly keyFacts = computed(() => {
    const l = this.listing();
    const cat = this.category();
    if (!l || !cat) return [];
    const facts = cat.fields
      .filter((f) => f.onCard && appliesTo(f, l.dealType) && l.attributes[f.key] !== undefined)
      .map((f) => ({ label: f.label, value: formatField(f, l.attributes[f.key]) }));
    if (l.pricePerM2 && l.dealType === 'Sale') facts.push({ label: 'Price per m²', value: formatEur(l.pricePerM2) });
    return facts.slice(0, 6);
  });

  /** Every filled-in field, grouped as in the category (legal status has its own panel). */
  protected readonly specs = computed<SpecGroup[]>(() => {
    const l = this.listing();
    const cat = this.category();
    if (!l || !cat) return [];
    const groups: SpecGroup[] = [];
    for (const f of cat.fields) {
      if (f.group === 'Legal status' || !appliesTo(f, l.dealType)) continue;
      const v = l.attributes[f.key];
      if (v === undefined || v === null || v === '') continue;
      let g = groups.find((x) => x.name === f.group);
      if (!g) groups.push((g = { name: f.group, rows: [], features: [] }));
      if (f.type === 'Boolean') {
        if (v === true) g.features.push(f.label.replace(/\s*\(.*\)$/, ''));
      } else {
        g.rows.push({ label: f.label, value: formatField(f, v) });
      }
    }
    // A short "Type" row for property, where it isn't obvious from the fields.
    const details = groups.find((g) => g.name === 'Details' || g.name === 'Vehicle');
    details?.rows.unshift({ label: 'Ad type', value: `${cat.name} · ${DEAL_TYPES[l.dealType].toLowerCase()}` });
    return groups.filter((g) => g.rows.length || g.features.length);
  });

  protected readonly legal = computed<LegalRow[]>(() => {
    const l = this.listing();
    const cat = this.category();
    if (!l || !cat || l.dealType === 'RentNightly') return [];
    const fields = cat.fields.filter((f) => f.group === 'Legal status' && f.type !== 'Text');
    if (!fields.length) return [];
    return fields.map((f) => this.legalRow(f, l.attributes[f.key]));
  });

  constructor() {
    effect(() => {
      const id = this.id();
      this.listing.set(null);
      this.similar.set([]);
      this.error.set(null);
      this.viewer.set(null);
      this.phone.set(null);
      this.sentConversationId.set(null);
      this.bookingSentId.set(null);
      this.api.listing(id).subscribe({
        next: (l) => {
          this.listing.set(l);
          this.messageText = this.defaultMessage(l);
          const max = this.num('maxGuests');
          if (max && this.guests > max) this.guests = max;
        },
        error: (e) => this.error.set(e.status === 404 ? 'This ad is no longer available.' : errorMessage(e)),
      });
      this.api.similar(id).subscribe({ next: (s) => this.similar.set(s), error: () => {} });
    });
  }

  protected eur(n: number) {
    return formatEur(n);
  }

  protected openViewer(i: number) {
    this.viewer.set(i);
  }

  protected step(delta: number) {
    const n = this.listing()?.photos.length ?? 0;
    const i = this.viewer();
    if (n && i !== null) this.viewer.set((i + delta + n) % n);
  }

  protected onKey(e: KeyboardEvent) {
    if (this.viewer() === null) return;
    if (e.key === 'Escape') this.viewer.set(null);
    if (e.key === 'ArrowRight') this.step(1);
    if (e.key === 'ArrowLeft') this.step(-1);
  }

  protected scrollToContact() {
    document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected share() {
    const url = location.href;
    const nav = navigator as Navigator & { share?: (d: { title: string; url: string }) => Promise<void> };
    if (nav.share) {
      nav.share({ title: this.listing()?.title ?? 'Prona', url }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(url).then(() => this.shared.set(true));
    }
  }

  protected revealPhone() {
    this.api.phone(this.id()).subscribe({
      next: (r) => this.phone.set(r.phone),
      error: (e) => this.contactError.set(errorMessage(e)),
    });
  }

  protected sendMessage() {
    if (!this.requireLogin()) return;
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

  protected requestBooking() {
    if (!this.requireLogin()) return;
    this.sending.set(true);
    this.contactError.set(null);
    const nightly = this.listing()?.dealType === 'RentNightly';
    this.api
      .requestBooking(this.id(), {
        checkIn: this.from,
        checkOut: this.to,
        guests: nightly ? this.guests : null,
        message: this.bookingNote.trim() || null,
      })
      .subscribe({
        next: (c) => {
          this.sending.set(false);
          this.bookingSentId.set(c.id);
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

  private requireLogin(): boolean {
    if (this.auth.isLoggedIn()) return true;
    this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
    return false;
  }

  private num(key: string): number | null {
    const v = this.listing()?.attributes[key];
    return typeof v === 'number' ? v : null;
  }

  private defaultMessage(l: ListingDetail): string {
    const cat = this.catalog.category(l.category);
    if (cat?.vertical === 'vehicles') return 'Hello, is the vehicle still available? When could I see it?';
    if (l.dealType === 'RentMonthly') return 'Hello, is it still available to rent? I would like to arrange a viewing.';
    if (cat?.key === 'land') return 'Hello, is the land still available? Could you send the cadastre details?';
    return 'Hello, is this property still available? I would like to arrange a viewing.';
  }

  private legalRow(f: FieldDef, v: unknown): LegalRow {
    const label = f.label.replace(/\s*\(.*\)$/, '');
    if (f.type === 'Boolean') {
      if (v === true) return { label, value: 'Yes', tone: 'ok', help: f.help };
      if (v === false) return { label, value: 'No', tone: 'bad', help: f.help };
      return { label, value: 'Not stated', tone: 'unknown', help: f.help };
    }
    const value = typeof v === 'string' ? formatField(f, v) : 'Not stated';
    const tone = v === 'Legalized' || v === 'NotRequired' ? 'ok' : v === 'InProcess' ? 'warn' : v === 'NotLegalized' ? 'bad' : 'unknown';
    return { label, value, tone, help: f.help };
  }
}
