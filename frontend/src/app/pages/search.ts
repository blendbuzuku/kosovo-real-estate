import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { Api, errorMessage } from '../core/api.service';
import { Auth } from '../core/auth';
import { Catalog, INTENTS, Intent, formatField, intentFor } from '../core/catalog';
import { activeFilterCount, criteriaFromParams, criteriaToParams, withFilter } from '../core/criteria';
import { DEAL_TYPES, SORTS, formatNumber, placeLabel } from '../core/labels';
import { ListingSort, ListingSummary, MapPin, SearchCriteria } from '../core/models';
import { FilterPanel } from '../shared/filter-panel';
import { Icon } from '../shared/icon';
import { ListingCard } from '../shared/listing-card';
import { LocationInput, LocationValue } from '../shared/location-input';
import { MapView } from '../shared/map-view';

type View = 'grid' | 'map';

interface Chip {
  label: string;
  clear: SearchCriteria;
}

const PAGE_SIZE = 24;

@Component({
  selector: 'app-search',
  imports: [RouterLink, ListingCard, MapView, FilterPanel, Icon, LocationInput],
  host: { '(document:keydown.escape)': 'drawerOpen.set(false)' },
  template: `
    @let c = criteria();
    <div class="search-top" [class.map-mode]="view() === 'map'">
      <div class="container">
        <nav class="intent-pills" aria-label="What are you looking for?">
          <a class="intent-pill" routerLink="/search" [class.on]="!intent() && !c.category && !c.vertical">
            <app-icon name="grid" [size]="18" /> Everything
          </a>
          @for (i of intents; track i.key) {
            <a class="intent-pill" routerLink="/search" [queryParams]="intentParams(i)" [class.on]="intent()?.key === i.key">
              <app-icon [name]="i.icon" [size]="18" /> {{ i.short }}
            </a>
          }
        </nav>
        <div class="search-bar">
          <app-location-input class="grow" [municipality]="c.municipality" [place]="c.place" (changed)="setLocation($event)" />
          <form class="kw" (submit)="$event.preventDefault(); setKeyword(kw.value)">
            <app-icon name="search" [size]="18" />
            <input #kw type="search" [value]="c.q ?? ''" [placeholder]="intent()?.hint ?? 'Search anything…'" aria-label="Keyword"
              (search)="setKeyword(kw.value)" />
          </form>
          <button type="button" class="btn ghost filters-btn" (click)="drawerOpen.set(true)">
            <app-icon name="sliders" [size]="18" /> Filters
            @if (filterCount()) {
              <span class="count-dot">{{ filterCount() }}</span>
            }
          </button>
        </div>
      </div>
    </div>

    <div class="container search-layout" [class.map-mode]="view() === 'map'">
      <aside class="filters-side" aria-label="Filters">
        <app-filter-panel [criteria]="c" (criteriaChange)="navigate($event)" />
      </aside>

      <section class="results">
        <div class="results-head">
          <div>
            <h1 class="results-title">{{ title() }}</h1>
            <p class="muted small">
              @if (loading() && !results().length) {
                Searching…
              } @else {
                {{ formatCount(total()) }} {{ total() === 1 ? 'ad' : 'ads' }}
              }
            </p>
          </div>
          <div class="results-tools">
            <label class="inline sort">
              <span class="sr-only">Sort</span>
              <select [value]="c.sort ?? 'Newest'" (change)="setSort($any($event.target).value)">
                @for (s of sorts(); track s) {
                  <option [value]="s" [selected]="(c.sort ?? 'Newest') === s">{{ sortLabels[s] }}</option>
                }
              </select>
            </label>
            <div class="view-toggle" role="group" aria-label="View">
              <button type="button" [class.on]="view() === 'grid'" (click)="view.set('grid')" aria-label="List view">
                <app-icon name="grid" [size]="18" />
              </button>
              <button type="button" [class.on]="view() === 'map'" (click)="view.set('map')" aria-label="Map view">
                <app-icon name="map" [size]="18" />
              </button>
            </div>
            <button type="button" class="btn ghost small" (click)="saveOpen.set(!saveOpen())">
              <app-icon name="bell" [size]="16" /> Save search
            </button>
          </div>
        </div>

        @if (saveOpen()) {
          <div class="card save-box">
            @if (auth.isLoggedIn()) {
              <form (submit)="$event.preventDefault(); saveSearch(name.value)">
                <label class="stack">
                  <span>Name this search. We’ll email you when new ads match.</span>
                  <input #name [value]="title()" maxlength="120" />
                </label>
                <button class="btn small" type="submit">Save and notify me</button>
              </form>
            } @else {
              <p>
                <a routerLink="/login" [queryParams]="{ returnUrl: currentUrl() }">Log in</a> or
                <a routerLink="/register" [queryParams]="{ returnUrl: currentUrl() }">create a free account</a>
                to get an email when new ads match this search.
              </p>
            }
            @if (saveMessage()) {
              <p class="notice">{{ saveMessage() }}</p>
            }
          </div>
        }

        @if (chips().length) {
          <div class="active-chips">
            @for (chip of chips(); track chip.label) {
              <button type="button" class="active-chip" (click)="navigate(chip.clear)">
                {{ chip.label }} <app-icon name="close" [size]="14" [stroke]="2.2" />
              </button>
            }
            <button type="button" class="link small" (click)="clearAll()">Clear all</button>
          </div>
        }

        @if (error()) {
          <p class="error">{{ error() }}</p>
        }

        @if (view() === 'map') {
          <div class="map-split">
            <div class="map-list">
              @for (l of results(); track l.id) {
                <app-listing-card [listing]="l" [compact]="true" [class.highlight]="l.id === highlighted()" />
              }
              @if (hasMore()) {
                <button type="button" class="btn ghost block" (click)="loadMore()" [disabled]="loading()">Show more</button>
              }
            </div>
            <div class="map-panel">
              <app-map-view [pins]="pins()" (boundsChange)="mapMoved.set($event)" (pinClick)="onPinClick($event)" />
              @if (mapMoved() && mapMoved() !== c.bbox) {
                <button type="button" class="btn small map-search-here" (click)="navigate({ ...c, bbox: mapMoved() })">
                  <app-icon name="search" [size]="16" /> Search this area
                </button>
              }
            </div>
          </div>
        } @else {
          <div class="grid">
            @for (l of results(); track l.id) {
              <app-listing-card [listing]="l" />
            } @empty {
              @if (!loading()) {
                <div class="card empty wide">
                  <app-icon name="search" [size]="36" />
                  <h2>No ads match yet</h2>
                  <p class="muted">Try removing a filter, or save this search and we’ll email you as soon as one is posted.</p>
                  @if (chips().length) {
                    <button type="button" class="btn ghost" (click)="clearAll()">Clear filters</button>
                  }
                </div>
              } @else {
                @for (s of skeletons; track $index) {
                  <div class="listing-card skeleton"><div class="thumb"></div><div class="body"><i></i><i></i><i></i></div></div>
                }
              }
            }
          </div>
          @if (hasMore()) {
            <div class="load-more">
              <button type="button" class="btn ghost" (click)="loadMore()" [disabled]="loading()">
                {{ loading() ? 'Loading…' : 'Show more ads' }}
              </button>
              <span class="muted small">Showing {{ results().length }} of {{ formatCount(total()) }}</span>
            </div>
          }
        }
      </section>
    </div>

    @if (drawerOpen()) {
      <div class="drawer-backdrop" (click)="drawerOpen.set(false)"></div>
      <div class="drawer" role="dialog" aria-modal="true" aria-label="Filters">
        <header class="drawer-head">
          <button type="button" class="icon-btn" aria-label="Close" (click)="drawerOpen.set(false)">
            <app-icon name="close" />
          </button>
          <strong>Filters</strong>
          <button type="button" class="link" (click)="clearAll()">Clear all</button>
        </header>
        <div class="drawer-body">
          <app-filter-panel [criteria]="c" (criteriaChange)="navigate($event)" />
        </div>
        <footer class="drawer-foot">
          <button type="button" class="btn block" (click)="drawerOpen.set(false)">
            Show {{ formatCount(total()) }} {{ total() === 1 ? 'ad' : 'ads' }}
          </button>
        </footer>
      </div>
    }
  `,
})
export class SearchPage {
  private readonly api = inject(Api);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly catalog = inject(Catalog);
  protected readonly auth = inject(Auth);

  protected readonly intents = INTENTS;
  protected readonly sortLabels = SORTS;
  protected readonly skeletons = Array(8);

  protected readonly criteria = toSignal(this.route.queryParams.pipe(map(criteriaFromParams)), {
    initialValue: {} as SearchCriteria,
  });
  protected readonly intent = computed(() => intentFor(this.criteria()));
  protected readonly filterCount = computed(() => activeFilterCount(this.criteria()));

  protected readonly results = signal<ListingSummary[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly pins = signal<MapPin[]>([]);
  protected readonly view = signal<View>('grid');
  protected readonly drawerOpen = signal(false);
  protected readonly saveOpen = signal(false);
  protected readonly saveMessage = signal<string | null>(null);
  protected readonly mapMoved = signal<string | null>(null);
  protected readonly highlighted = signal<string | null>(null);
  protected readonly hasMore = computed(() => this.results().length < this.total());

  protected readonly sorts = computed<ListingSort[]>(() => {
    const c = this.criteria();
    const cat = this.catalog.category(c.category);
    const vertical = cat?.vertical ?? c.vertical;
    const base: ListingSort[] = ['Newest', 'PriceAsc', 'PriceDesc'];
    if (vertical === 'vehicles') return c.dealType === 'RentDaily' ? [...base, 'YearDesc'] : [...base, 'YearDesc', 'MileageAsc'];
    if (vertical === 'property' && c.dealType !== 'RentNightly') return [...base, 'PricePerM2Asc'];
    return base;
  });

  protected readonly title = computed(() => {
    const c = this.criteria();
    const cat = this.catalog.category(c.category);
    let what: string;
    if (cat && c.dealType === 'RentNightly') what = `${cat.name} per night`;
    else if (cat?.key === 'cars' && c.dealType === 'RentDaily') what = 'Rent a car';
    else if (cat) what = `${cat.name}${c.dealType ? ' · ' + DEAL_TYPES[c.dealType].toLowerCase() : ''}`;
    else what = this.intent()?.label ?? 'All ads';
    const where = c.municipality ? ` in ${placeLabel({ municipality: c.municipality, place: c.place })}` : ' in Kosovo';
    return what + where;
  });

  protected readonly chips = computed<Chip[]>(() => {
    const c = this.criteria();
    const out: Chip[] = [];
    if (c.municipality)
      out.push({ label: placeLabel({ municipality: c.municipality, place: c.place }), clear: { ...c, municipality: null, place: null } });
    if (c.q) out.push({ label: `“${c.q}”`, clear: { ...c, q: null } });
    if (c.minPrice || c.maxPrice) {
      const lo = c.minPrice ? `${formatNumber(c.minPrice)} €` : '';
      const hi = c.maxPrice ? `${formatNumber(c.maxPrice)} €` : '';
      out.push({ label: lo && hi ? `${lo} – ${hi}` : lo ? `From ${lo}` : `Up to ${hi}`, clear: { ...c, minPrice: null, maxPrice: null } });
    }
    if (c.seller) out.push({ label: c.seller === 'Business' ? 'Businesses only' : 'Private only', clear: { ...c, seller: null } });
    if (c.bbox) out.push({ label: 'Map area', clear: { ...c, bbox: null } });
    const fields = this.catalog.filterFields(c).concat(this.catalog.category(c.category)?.fields ?? []);
    for (const [key, value] of Object.entries(c.f ?? {})) {
      const [base, bound] = key.split('.') as [string, string | undefined];
      const field = fields.find((f) => f.key === base);
      if (!field) continue;
      let label: string;
      if (field.type === 'Boolean') label = field.label.replace(/\s*\(.*\)$/, '');
      else if (bound === 'min')
        label = field.filter === 'Min' && field.type !== 'Year' ? `${field.label} ${value}+` : `${field.label} from ${formatField(field, Number(value))}`;
      else if (bound === 'max') label = `${field.label} up to ${formatField(field, Number(value))}`;
      else if (field.type === 'Text') label = `${field.label}: ${value}`;
      else label = `${field.label}: ${value.split(',').map((v) => formatField(field, v)).join(', ')}`;
      out.push({ label, clear: withFilter(c, key, null) });
    }
    return out;
  });

  constructor() {
    // New criteria: start again from page 1 and refresh the map pins.
    effect(() => {
      const c = this.criteria();
      untracked(() => {
        this.page.set(1);
        this.load(c, 1, false);
        if (this.view() === 'map') this.loadPins(c);
      });
    });
    effect(() => {
      if (this.view() === 'map') untracked(() => this.loadPins(this.criteria()));
    });
  }

  protected intentParams(i: Intent) {
    const c = this.criteria();
    return criteriaToParams({ ...i.criteria, municipality: c.municipality, place: c.place });
  }

  protected formatCount(n: number) {
    return formatNumber(n);
  }

  protected currentUrl() {
    return this.router.url;
  }

  protected navigate(c: SearchCriteria) {
    this.router.navigate(['/search'], { queryParams: criteriaToParams(c) });
  }

  protected setLocation(v: LocationValue) {
    this.navigate({ ...this.criteria(), municipality: v.municipality, place: v.place, bbox: null });
  }

  protected setKeyword(q: string) {
    const trimmed = q.trim();
    if ((this.criteria().q ?? '') !== trimmed) this.navigate({ ...this.criteria(), q: trimmed || null });
  }

  protected setSort(sort: ListingSort) {
    this.navigate({ ...this.criteria(), sort: sort === 'Newest' ? null : sort });
  }

  protected clearAll() {
    const c = this.criteria();
    this.navigate({ vertical: c.vertical, category: c.category, dealType: c.dealType, sort: c.sort });
  }

  protected loadMore() {
    const next = this.page() + 1;
    this.page.set(next);
    this.load(this.criteria(), next, true);
  }

  protected onPinClick(id: string) {
    this.highlighted.set(id);
    const card = document.querySelector(`.map-list a[href$="${id}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else this.router.navigate(['/listings', id]);
  }

  protected saveSearch(name: string) {
    const trimmed = name.trim() || this.title();
    this.api.saveSearch(trimmed, this.criteria()).subscribe({
      next: () => this.saveMessage.set('Saved. We’ll email you when new ads match.'),
      error: (e) => this.saveMessage.set(errorMessage(e)),
    });
  }

  private load(c: SearchCriteria, page: number, append: boolean) {
    this.loading.set(true);
    this.error.set(null);
    this.api.search(c, page, PAGE_SIZE).subscribe({
      next: (r) => {
        // Ignore a slow response for criteria the user has already moved on from.
        if (this.criteria() !== c) return;
        this.results.set(append ? [...this.results(), ...r.items] : r.items);
        this.total.set(r.total);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.error.set(errorMessage(e));
      },
    });
  }

  private loadPins(c: SearchCriteria) {
    this.api.mapPins(c).subscribe({ next: (p) => this.pins.set(p), error: () => this.pins.set([]) });
  }
}
