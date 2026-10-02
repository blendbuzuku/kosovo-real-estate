import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, debounceTime, of, switchMap, tap } from 'rxjs';
import { Api, errorMessage } from '../core/api.service';
import { Auth } from '../core/auth';
import { criteriaFromParams, criteriaToParams, describeCriteria } from '../core/criteria';
import { HEATING, PROPERTY_TYPES, SORTS, entries } from '../core/labels';
import { ListingSummary, MapPin, SearchCriteria } from '../core/models';
import { Cities } from '../core/stores';
import { ListingCard } from '../shared/listing-card';
import { MapView } from '../shared/map-view';

type View = 'list' | 'map';

@Component({
  selector: 'app-search',
  imports: [ReactiveFormsModule, ListingCard, MapView, RouterLink],
  template: `
    <section class="search-hero">
      <div class="container">
        <h1>Find a home in Kosovo</h1>
        <p class="muted">Apartments, houses, land and commercial space, with the legal paperwork shown up front.</p>
        <div class="deal-tabs" role="tablist">
          <button type="button" role="tab" [class.active]="!criteria().dealType" (click)="setDeal(null)">All</button>
          <button type="button" role="tab" [class.active]="criteria().dealType === 'Sale'" (click)="setDeal('Sale')">Buy</button>
          <button type="button" role="tab" [class.active]="criteria().dealType === 'RentMonthly'" (click)="setDeal('RentMonthly')">Rent</button>
          <button type="button" role="tab" [class.active]="criteria().dealType === 'RentShortTerm'" (click)="setDeal('RentShortTerm')">Short stay</button>
        </div>
      </div>
    </section>

    <div class="container">
      <form class="filters card" [formGroup]="form">
        <div class="filter-row">
          <label class="grow">
            <span>Search</span>
            <input type="search" formControlName="q" placeholder="Street, neighbourhood or keyword" />
          </label>
          <label>
            <span>City</span>
            <select formControlName="city">
              <option value="">All of Kosovo</option>
              @for (c of cities.all(); track c.name) {
                <option [value]="c.name">{{ c.name }}</option>
              }
            </select>
          </label>
          @if (neighborhoods().length > 1) {
            <label>
              <span>Neighbourhood</span>
              <select formControlName="neighborhood">
                <option value="">Any</option>
                @for (n of neighborhoods(); track n) {
                  <option [value]="n">{{ n }}</option>
                }
              </select>
            </label>
          }
          <label>
            <span>Type</span>
            <select formControlName="propertyType">
              <option value="">Any</option>
              @for (t of propertyTypes; track t.value) {
                <option [value]="t.value">{{ t.label }}</option>
              }
            </select>
          </label>
          <label class="narrow">
            <span>Min €</span>
            <input type="number" min="0" formControlName="minPrice" />
          </label>
          <label class="narrow">
            <span>Max €</span>
            <input type="number" min="0" formControlName="maxPrice" />
          </label>
          <label class="narrow">
            <span>Rooms</span>
            <select formControlName="minRooms">
              <option [ngValue]="null">Any</option>
              @for (r of [1, 2, 3, 4, 5]; track r) {
                <option [ngValue]="r">{{ r }}+</option>
              }
            </select>
          </label>
        </div>

        @if (showMore()) {
          <div class="filter-row">
            <label class="narrow"><span>Min m²</span><input type="number" min="0" formControlName="minArea" /></label>
            <label class="narrow"><span>Max m²</span><input type="number" min="0" formControlName="maxArea" /></label>
            <label class="narrow"><span>Min floor</span><input type="number" formControlName="minFloor" /></label>
            <label class="narrow"><span>Max floor</span><input type="number" formControlName="maxFloor" /></label>
            <label class="narrow"><span>Built after</span><input type="number" min="1900" formControlName="minYearBuilt" /></label>
            <label>
              <span>Heating</span>
              <select formControlName="heating">
                <option value="">Any</option>
                @for (h of heating; track h.value) {
                  <option [value]="h.value">{{ h.label }}</option>
                }
              </select>
            </label>
          </div>
          <div class="filter-row checks">
            <label class="check"><input type="checkbox" formControlName="hasParking" /> Parking</label>
            <label class="check"><input type="checkbox" formControlName="isFurnished" /> Furnished</label>
            <label class="check"><input type="checkbox" formControlName="hasElevator" /> Elevator</label>
            <span class="divider"></span>
            <label class="check legal"><input type="checkbox" formControlName="legalizedOnly" /> Legalized only</label>
            <label class="check legal"><input type="checkbox" formControlName="hasCadastreCertificate" /> Has cadastre certificate</label>
            <label class="check legal"><input type="checkbox" formControlName="hasConstructionPermit" /> Has construction permit</label>
          </div>
        }

        <div class="filter-actions">
          <button type="button" class="link" (click)="showMore.set(!showMore())">
            {{ showMore() ? 'Fewer filters' : 'More filters' }}
          </button>
          @if (activeFilterCount() > 0) {
            <button type="button" class="link" (click)="clear()">Clear all</button>
          }
          <span class="spacer"></span>
          @if (auth.isLoggedIn()) {
            @if (saving()) {
              <input class="inline-input" #name [value]="defaultName()" aria-label="Name for this search" />
              <button type="button" class="btn small" (click)="saveSearch(name.value)">Save</button>
              <button type="button" class="link" (click)="saving.set(false)">Cancel</button>
            } @else {
              <button type="button" class="btn small ghost" (click)="saving.set(true)">🔔 Save search &amp; get alerts</button>
            }
          } @else {
            <a class="link" routerLink="/login" [queryParams]="{ returnUrl: '/' }">Log in to save this search</a>
          }
        </div>
        @if (saveMessage()) {
          <p class="notice">{{ saveMessage() }}</p>
        }
      </form>

      <div class="results-bar">
        <strong>{{ total() }} {{ total() === 1 ? 'listing' : 'listings' }}</strong>
        @if (criteria().bbox) {
          <button type="button" class="chip-btn" (click)="clearArea()">In map area ✕</button>
        }
        <span class="spacer"></span>
        <label class="inline">
          Sort
          <select [value]="criteria().sort ?? 'Newest'" (change)="setSort($any($event.target).value)">
            @for (s of sorts; track s.value) {
              <option [value]="s.value">{{ s.label }}</option>
            }
          </select>
        </label>
        <div class="view-toggle">
          <button type="button" [class.active]="view() === 'list'" (click)="view.set('list')">List</button>
          <button type="button" [class.active]="view() === 'map'" (click)="view.set('map')">Map</button>
        </div>
      </div>

      @if (error()) {
        <p class="error">{{ error() }}</p>
      }

      <div class="results" [class.with-map]="view() === 'map'">
        <div class="grid">
          @for (l of listings(); track l.id) {
            <app-listing-card [listing]="l" />
          } @empty {
            @if (!loading()) {
              <div class="empty card">
                <p><strong>No listings match these filters.</strong></p>
                <p class="muted">Try a wider price range or another city, or save the search to get an email when one appears.</p>
              </div>
            }
          }
        </div>
        @if (view() === 'map') {
          <div class="map-panel">
            <app-map-view
              [pins]="pins()"
              [center]="mapCenter()"
              (boundsChange)="onMapMoved($event)"
              (pinClick)="openListing($event)"
            />
          </div>
        }
      </div>

      @if (pageCount() > 1) {
        <nav class="pager" aria-label="Pages">
          <button type="button" class="btn ghost small" [disabled]="page() <= 1" (click)="goToPage(page() - 1)">← Previous</button>
          <span>Page {{ page() }} of {{ pageCount() }}</span>
          <button type="button" class="btn ghost small" [disabled]="page() >= pageCount()" (click)="goToPage(page() + 1)">Next →</button>
        </nav>
      }
    </div>
  `,
})
export class SearchPage {
  private readonly api = inject(Api);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  protected readonly auth = inject(Auth);
  protected readonly cities = inject(Cities);

  protected readonly propertyTypes = entries(PROPERTY_TYPES);
  protected readonly heating = entries(HEATING);
  protected readonly sorts = entries(SORTS);

  private readonly params = toSignal(this.route.queryParams, { initialValue: {} as Record<string, string> });
  protected readonly criteria = computed(() => criteriaFromParams(this.params()));
  protected readonly page = computed(() => Math.max(1, Number(this.params()['page'] ?? 1) || 1));

  protected readonly listings = signal<ListingSummary[]>([]);
  protected readonly pins = signal<MapPin[]>([]);
  protected readonly total = signal(0);
  protected readonly pageSize = 24;
  protected readonly pageCount = computed(() => Math.ceil(this.total() / this.pageSize));
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly view = signal<View>('list');
  protected readonly showMore = signal(false);
  protected readonly saving = signal(false);
  protected readonly saveMessage = signal<string | null>(null);

  protected readonly form = this.fb.group({
    q: [''],
    city: [''],
    neighborhood: [''],
    propertyType: [''],
    minPrice: [null as number | null],
    maxPrice: [null as number | null],
    minRooms: [null as number | null],
    minArea: [null as number | null],
    maxArea: [null as number | null],
    minFloor: [null as number | null],
    maxFloor: [null as number | null],
    minYearBuilt: [null as number | null],
    heating: [''],
    hasParking: [false],
    isFurnished: [false],
    hasElevator: [false],
    legalizedOnly: [false],
    hasCadastreCertificate: [false],
    hasConstructionPermit: [false],
  });

  private readonly formCity = toSignal(this.form.controls.city.valueChanges, { initialValue: '' });
  protected readonly neighborhoods = computed(() => this.cities.find(this.formCity())?.neighborhoods ?? []);
  protected readonly mapCenter = signal<{ lat: number; lng: number; zoom?: number } | null>(null);

  protected readonly activeFilterCount = computed(
    () => Object.keys(criteriaToParams({ ...this.criteria(), sort: undefined, dealType: undefined })).length,
  );
  protected readonly defaultName = computed(() => describeCriteria(this.criteria()));

  constructor() {
    const destroyRef = inject(DestroyRef);

    // URL → form (without echoing back).
    effect(() => {
      const c = this.criteria();
      this.form.patchValue(
        {
          q: c.q ?? '',
          city: c.city ?? '',
          neighborhood: c.neighborhood ?? '',
          propertyType: c.propertyType ?? '',
          minPrice: c.minPrice ?? null,
          maxPrice: c.maxPrice ?? null,
          minRooms: c.minRooms ?? null,
          minArea: c.minArea ?? null,
          maxArea: c.maxArea ?? null,
          minFloor: c.minFloor ?? null,
          maxFloor: c.maxFloor ?? null,
          minYearBuilt: c.minYearBuilt ?? null,
          heating: c.heating ?? '',
          hasParking: !!c.hasParking,
          isFurnished: !!c.isFurnished,
          hasElevator: !!c.hasElevator,
          legalizedOnly: !!c.legalizedOnly,
          hasCadastreCertificate: !!c.hasCadastreCertificate,
          hasConstructionPermit: !!c.hasConstructionPermit,
        },
        { emitEvent: false },
      );
      if (c.minArea || c.maxFloor || c.minFloor || c.heating || c.legalizedOnly || c.hasCadastreCertificate) {
        this.showMore.set(true);
      }
    });

    // Form → URL.
    this.form.valueChanges
      .pipe(debounceTime(350), takeUntilDestroyed(destroyRef))
      .subscribe((v) => {
        const current = this.criteria();
        const cityChanged = (v.city || null) !== (current.city ?? null);
        const next: SearchCriteria = {
          ...current,
          q: v.q || null,
          city: v.city || null,
          neighborhood: cityChanged ? null : v.neighborhood || null,
          propertyType: (v.propertyType || null) as SearchCriteria['propertyType'],
          minPrice: v.minPrice,
          maxPrice: v.maxPrice,
          minRooms: v.minRooms,
          minArea: v.minArea,
          maxArea: v.maxArea,
          minFloor: v.minFloor,
          maxFloor: v.maxFloor,
          minYearBuilt: v.minYearBuilt,
          heating: (v.heating || null) as SearchCriteria['heating'],
          hasParking: v.hasParking,
          isFurnished: v.isFurnished,
          hasElevator: v.hasElevator,
          legalizedOnly: v.legalizedOnly,
          hasCadastreCertificate: v.hasCadastreCertificate,
          hasConstructionPermit: v.hasConstructionPermit,
          // A new city means a new map area.
          bbox: cityChanged ? null : current.bbox,
        };
        if (cityChanged) {
          const city = this.cities.find(v.city);
          this.mapCenter.set(city ? { lat: city.lat, lng: city.lng, zoom: 13 } : { lat: 42.6, lng: 20.9, zoom: 8 });
        }
        this.navigate(next);
      });

    // Criteria → results. switchMap drops responses for filters the user has already changed.
    toObservable(computed(() => ({ c: this.criteria(), page: this.page() })))
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.error.set(null);
        }),
        switchMap(({ c, page }) =>
          this.api.search(c, page, this.pageSize).pipe(
            catchError((e) => {
              this.error.set(errorMessage(e));
              return of({ items: [], total: 0, page: 1, pageSize: this.pageSize });
            }),
          ),
        ),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe((r) => {
        this.listings.set(r.items);
        this.total.set(r.total);
        this.loading.set(false);
      });

    toObservable(computed(() => (this.view() === 'map' ? this.criteria() : null)))
      .pipe(
        switchMap((c) => (c ? this.api.mapPins(c).pipe(catchError(() => of([]))) : of([]))),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe((p) => this.pins.set(p));

    // Start the map on the selected city.
    effect(() => {
      const city = this.cities.find(this.criteria().city);
      if (city && !this.mapCenter()) this.mapCenter.set({ lat: city.lat, lng: city.lng, zoom: 13 });
    });
  }

  protected setDeal(dealType: SearchCriteria['dealType']) {
    this.navigate({ ...this.criteria(), dealType });
  }

  protected setSort(sort: SearchCriteria['sort']) {
    this.navigate({ ...this.criteria(), sort: sort === 'Newest' ? undefined : sort });
  }

  protected onMapMoved(bbox: string) {
    this.navigate({ ...this.criteria(), bbox });
  }

  protected clearArea() {
    this.navigate({ ...this.criteria(), bbox: null });
  }

  protected clear() {
    this.navigate({ dealType: this.criteria().dealType, sort: this.criteria().sort });
  }

  protected goToPage(page: number) {
    this.router.navigate([], { queryParams: { ...criteriaToParams(this.criteria()), page } });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  protected openListing(id: string) {
    this.router.navigate(['/listings', id]);
  }

  protected saveSearch(name: string) {
    const trimmed = name.trim() || this.defaultName();
    this.api.saveSearch(trimmed, this.criteria()).subscribe({
      next: () => {
        this.saving.set(false);
        this.saveMessage.set(`Saved “${trimmed}”. We’ll email you when new listings match.`);
      },
      error: (e) => this.saveMessage.set(errorMessage(e)),
    });
  }

  private navigate(c: SearchCriteria) {
    this.router.navigate([], { queryParams: criteriaToParams(c), replaceUrl: true });
  }
}
