import { Component, computed, inject, input, output } from '@angular/core';
import { Catalog } from '../core/catalog';
import { withFilter } from '../core/criteria';
import { DEAL_TYPES, DEAL_UNIT } from '../core/labels';
import { DealType, FieldDef, SearchCriteria, SellerType } from '../core/models';
import { Icon } from './icon';

interface FieldGroup {
  name: string;
  fields: FieldDef[];
}

/**
 * Filters built from the category's fields: ranges get from/to boxes, counts get 1+ 2+ 3+ chips,
 * choices and yes/no features get toggle chips. Used in the sidebar and the mobile drawer.
 */
@Component({
  selector: 'app-filter-panel',
  imports: [Icon],
  template: `
    @let c = criteria();
    @if (categories().length > 1) {
      <section class="fsec">
        <h3>Category</h3>
        <div class="chips">
          <button type="button" class="chip-toggle" [class.on]="!c.category" (click)="setCategory(null)">All</button>
          @for (cat of categories(); track cat.key) {
            <button type="button" class="chip-toggle" [class.on]="c.category === cat.key" (click)="setCategory(cat.key)">
              <app-icon [name]="cat.icon" [size]="16" /> {{ cat.name }}
            </button>
          }
        </div>
      </section>
    }

    @if (deals().length > 1) {
      <section class="fsec">
        <h3>Type of ad</h3>
        <div class="segmented">
          <button type="button" [class.on]="!c.dealType" (click)="set({ dealType: null })">Any</button>
          @for (d of deals(); track d) {
            <button type="button" [class.on]="c.dealType === d" (click)="set({ dealType: d })">{{ dealLabels[d] }}</button>
          }
        </div>
      </section>
    }

    <section class="fsec">
      <h3>Price{{ priceUnit() ? ' per ' + priceUnit() : '' }} (€)</h3>
      <div class="range">
        <input type="number" inputmode="numeric" min="0" placeholder="Min" aria-label="Minimum price"
          [value]="c.minPrice ?? ''" (change)="setNumber('minPrice', $any($event.target).value)" />
        <span class="dash">–</span>
        <input type="number" inputmode="numeric" min="0" placeholder="Max" aria-label="Maximum price"
          [value]="c.maxPrice ?? ''" (change)="setNumber('maxPrice', $any($event.target).value)" />
      </div>
    </section>

    @for (g of groups(); track g.name) {
      <section class="fsec">
        <h3>{{ g.name }}</h3>
        @for (f of g.fields; track f.key) {
          @switch (control(f)) {
            @case ('range') {
              <div class="field-label">{{ f.label }}{{ f.unit ? ' (' + f.unit + ')' : '' }}</div>
              <div class="range">
                <input type="number" inputmode="numeric" placeholder="From" [attr.aria-label]="f.label + ' from'"
                  [value]="value(f.key + '.min')" (change)="setField(f.key + '.min', $any($event.target).value)" />
                <span class="dash">–</span>
                <input type="number" inputmode="numeric" placeholder="To" [attr.aria-label]="f.label + ' to'"
                  [value]="value(f.key + '.max')" (change)="setField(f.key + '.max', $any($event.target).value)" />
              </div>
            }
            @case ('steps') {
              <div class="field-label">{{ f.label }}</div>
              <div class="segmented small">
                <button type="button" [class.on]="!value(f.key + '.min')" (click)="setField(f.key + '.min', null)">Any</button>
                @for (n of steps(f); track n) {
                  <button type="button" [class.on]="value(f.key + '.min') === '' + n" (click)="setField(f.key + '.min', '' + n)">{{ n }}+</button>
                }
              </div>
            }
            @case ('year') {
              <label class="stack">
                <span>{{ f.label }} from</span>
                <select (change)="setField(f.key + '.min', $any($event.target).value)">
                  <option value="" [selected]="!value(f.key + '.min')">Any</option>
                  @for (y of years(f); track y) {
                    <option [value]="y" [selected]="value(f.key + '.min') === '' + y">{{ y }}</option>
                  }
                </select>
              </label>
            }
            @case ('multi') {
              <div class="field-label">{{ f.label }}</div>
              <div class="chips">
                @for (o of f.options; track o.value) {
                  <button type="button" class="chip-toggle" [class.on]="isPicked(f.key, o.value)" (click)="togglePick(f.key, o.value)">
                    {{ o.label }}
                  </button>
                }
              </div>
            }
            @case ('select') {
              <label class="stack">
                <span>{{ f.label }}</span>
                <select (change)="setField(f.key, $any($event.target).value)">
                  <option value="" [selected]="!value(f.key)">Any</option>
                  @for (o of f.options; track o.value) {
                    <option [value]="o.value" [selected]="value(f.key) === o.value">{{ o.label }}</option>
                  }
                </select>
              </label>
            }
            @case ('text') {
              <label class="stack">
                <span>{{ f.label }}</span>
                <input type="text" [placeholder]="'Any ' + f.label.toLowerCase()" [value]="value(f.key)"
                  (change)="setField(f.key, $any($event.target).value.trim())" />
              </label>
            }
          }
        }
        @if (booleans(g).length) {
          <div class="chips">
            @for (f of booleans(g); track f.key) {
              <button type="button" class="chip-toggle" [class.on]="value(f.key) === 'true'"
                (click)="setField(f.key, value(f.key) === 'true' ? null : 'true')">
                @if (value(f.key) === 'true') {
                  <app-icon name="check" [size]="14" [stroke]="2.4" />
                }
                {{ shortLabel(f) }}
              </button>
            }
          </div>
        }
      </section>
    }

    <section class="fsec">
      <h3>Posted by</h3>
      <div class="segmented">
        <button type="button" [class.on]="!c.seller" (click)="set({ seller: null })">Anyone</button>
        @for (s of sellers; track s.value) {
          <button type="button" [class.on]="c.seller === s.value" (click)="set({ seller: s.value })">{{ s.label }}</button>
        }
      </div>
    </section>
  `,
})
export class FilterPanel {
  readonly criteria = input.required<SearchCriteria>();
  readonly criteriaChange = output<SearchCriteria>();

  private readonly catalog = inject(Catalog);
  protected readonly dealLabels = DEAL_TYPES;
  protected readonly sellers: { value: SellerType; label: string }[] = [
    { value: 'Private', label: 'Private' },
    { value: 'Business', label: 'Businesses' },
  ];

  protected readonly categories = computed(() => {
    const c = this.criteria();
    const vertical = c.vertical ?? this.catalog.category(c.category)?.vertical ?? null;
    return this.catalog
      .inVertical(vertical)
      .filter((cat) => !c.dealType || cat.deals.includes(c.dealType));
  });

  protected readonly deals = computed<DealType[]>(() => {
    const c = this.criteria();
    const one = this.catalog.category(c.category);
    if (one) return one.deals;
    const all = this.catalog.inVertical(c.vertical ?? null).flatMap((cat) => cat.deals);
    return [...new Set(all)];
  });

  protected readonly priceUnit = computed(() => (this.criteria().dealType ? DEAL_UNIT[this.criteria().dealType!] : ''));

  protected readonly groups = computed<FieldGroup[]>(() => {
    const groups: FieldGroup[] = [];
    for (const f of this.catalog.filterFields(this.criteria())) {
      let g = groups.find((x) => x.name === f.group);
      if (!g) groups.push((g = { name: f.group, fields: [] }));
      g.fields.push(f);
    }
    return groups;
  });

  protected control(f: FieldDef): string {
    if (f.type === 'Boolean') return 'none';
    if (f.filter === 'Range') return 'range';
    if (f.filter === 'Min' && f.type === 'Year') return 'year';
    if (f.filter === 'Min') return 'steps';
    if (f.filter === 'Multi') return 'multi';
    if (f.filter === 'Exact' && f.type === 'Select' && (f.options?.length ?? 0) <= 3) return 'multi';
    if (f.filter === 'Exact') return 'select';
    if (f.filter === 'Contains') return 'text';
    return 'none';
  }

  protected booleans(g: FieldGroup) {
    return g.fields.filter((f) => f.type === 'Boolean');
  }

  protected steps(f: FieldDef): number[] {
    if (f.key === 'maxGuests' || f.key === 'seats') return [2, 4, 5, 7, 9];
    return [1, 2, 3, 4, 5];
  }

  protected years(f: FieldDef): number[] {
    const now = new Date().getFullYear();
    const from = Math.max(f.min ?? 1950, 1950);
    const out: number[] = [];
    // Every year for the last twenty, then round five-year steps (2005, 2000, 1995…).
    for (let y = now; y >= Math.max(from, now - 20); y--) out.push(y);
    for (let y = Math.floor((now - 21) / 5) * 5; y >= from; y -= 5) out.push(y);
    return out;
  }

  /** "Cadastre certificate (certifikata e pronësisë)" → "Cadastre certificate" on a chip. */
  protected shortLabel(f: FieldDef) {
    return f.label.replace(/\s*\(.*\)$/, '');
  }

  protected value(key: string): string {
    return this.criteria().f?.[key] ?? '';
  }

  protected isPicked(key: string, option: string) {
    return this.value(key).split(',').includes(option);
  }

  protected togglePick(key: string, option: string) {
    const current = this.value(key).split(',').filter(Boolean);
    const next = current.includes(option) ? current.filter((v) => v !== option) : [...current, option];
    this.setField(key, next.join(','));
  }

  protected setField(key: string, value: string | null) {
    this.criteriaChange.emit(withFilter(this.criteria(), key, value));
  }

  protected setNumber(key: 'minPrice' | 'maxPrice', raw: string) {
    const n = raw === '' ? null : Number(raw);
    this.set({ [key]: n !== null && Number.isFinite(n) && n >= 0 ? n : null });
  }

  protected setCategory(key: string | null) {
    const cat = this.catalog.category(key);
    const c = this.criteria();
    // Keep the deal type only if the new category offers it; drop field filters it doesn't have.
    const dealType = cat && c.dealType && !cat.deals.includes(c.dealType) ? null : c.dealType;
    const f = Object.fromEntries(
      Object.entries(c.f ?? {}).filter(([k]) => !cat || cat.fields.some((x) => x.key === k.replace(/\.(min|max)$/, ''))),
    );
    this.criteriaChange.emit({
      ...c,
      category: key,
      vertical: cat?.vertical ?? c.vertical,
      dealType,
      f: Object.keys(f).length ? f : null,
    });
  }

  protected set(patch: Partial<SearchCriteria>) {
    this.criteriaChange.emit({ ...this.criteria(), ...patch });
  }
}
