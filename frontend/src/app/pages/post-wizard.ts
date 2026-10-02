import { Location } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../core/api.service';
import { Catalog, appliesTo, formatField } from '../core/catalog';
import { DEAL_POST, DEAL_UNIT, formatEur } from '../core/labels';
import { AttributeValue, Attributes, Category, DealType, FieldDef, ListingDetail, ListingSummary, ListingUpsert, Photo } from '../core/models';
import { Icon } from '../shared/icon';
import { ListingCard } from '../shared/listing-card';
import { MapView } from '../shared/map-view';
import { HttpErrorResponse } from '@angular/common/http';

const STEPS = ['What', 'Where', 'Details', 'Photos', 'Publish'] as const;

interface Group {
  name: string;
  fields: FieldDef[];
  toggles: FieldDef[];
}

/**
 * Posting in five short steps: pick what it is, where it is, fill in the category's own fields,
 * add photos, then send it for review. The draft is saved after the details step, so nothing is lost.
 */
@Component({
  selector: 'app-post-wizard',
  imports: [FormsModule, RouterLink, Icon, ListingCard, MapView],
  template: `
    <div class="container wizard">
      <header class="wizard-head">
        <h1>{{ id() ? 'Edit your ad' : 'Post an ad' }}</h1>
        <ol class="steps" aria-label="Progress">
          @for (s of steps; track s; let i = $index) {
            <li [class.done]="i < step()" [class.current]="i === step()">
              <button type="button" [disabled]="!canJump(i)" (click)="goTo(i)">
                <span class="step-dot">
                  @if (i < step()) {
                    <app-icon name="check" [size]="14" [stroke]="2.6" />
                  } @else {
                    {{ i + 1 }}
                  }
                </span>
                <span class="step-name">{{ s }}</span>
              </button>
            </li>
          }
        </ol>
      </header>

      @if (loadError()) {
        <p class="error">{{ loadError() }}</p>
      }
      @if (status() === 'Active' && step() < 3) {
        <p class="notice">This ad is live. Saving changes sends it back for a quick review before they show.</p>
      }

      <div class="wizard-body card">
        @switch (step()) {
          @case (0) {
            <h2>What are you posting?</h2>
            @for (v of verticals; track v.key) {
              <h3 class="muted">{{ v.label }}</h3>
              <div class="pick-grid">
                @for (cat of catalog.inVertical(v.key); track cat.key) {
                  <button type="button" class="pick" [class.on]="categoryKey() === cat.key" (click)="pickCategory(cat)">
                    <app-icon [name]="cat.icon" [size]="28" [stroke]="1.6" />
                    <strong>{{ cat.name }}</strong>
                  </button>
                }
              </div>
            }
            @if (category(); as cat) {
              <h2 class="mt">How do you want to offer it?</h2>
              <div class="pick-grid deals">
                @for (d of cat.deals; track d) {
                  <button type="button" class="pick wide" [class.on]="deal() === d" (click)="deal.set(d)">
                    <strong>{{ dealPost[d].title }}</strong>
                    <span class="muted small">{{ dealPost[d].text }}</span>
                  </button>
                }
              </div>
            }
          }

          @case (1) {
            <h2>Where is it?</h2>
            <p class="muted">Buyers search by municipality, neighbourhood and village, so pick the closest one.</p>
            <div class="form-grid">
              <label class="stack">
                <span>Municipality *</span>
                <select [ngModel]="municipality()" (ngModelChange)="setMunicipality($event)">
                  <option [ngValue]="''" disabled>Choose…</option>
                  @for (m of municipalities(); track m.name) {
                    <option [ngValue]="m.name">{{ m.name }}</option>
                  }
                </select>
              </label>
              <label class="stack">
                <span>Neighbourhood or village</span>
                <select [ngModel]="place()" (ngModelChange)="place.set($event)" [disabled]="!municipality()">
                  <option [ngValue]="''">Not listed / whole municipality</option>
                  @if (neighbourhoods().length) {
                    <optgroup label="Neighbourhoods">
                      @for (p of neighbourhoods(); track p) {
                        <option [ngValue]="p">{{ p }}</option>
                      }
                    </optgroup>
                  }
                  @if (villages().length) {
                    <optgroup label="Villages">
                      @for (p of villages(); track p) {
                        <option [ngValue]="p">{{ p }}</option>
                      }
                    </optgroup>
                  }
                </select>
              </label>
              <label class="stack wide">
                <span>Street or landmark (optional)</span>
                <input [ngModel]="address()" (ngModelChange)="address.set($event)" maxlength="200"
                  [placeholder]="isVehicle() ? 'e.g. showroom on the Prishtinë–Ferizaj road' : 'e.g. Rr. Agim Ramadani, near the Grand Hotel'" />
              </label>
            </div>
            <label class="check pin-toggle">
              <input type="checkbox" [ngModel]="usePin()" (ngModelChange)="usePin.set($event)" />
              Show the exact spot on the map
              <span class="muted small">{{ usePin() ? 'Click the map or drag the pin.' : 'Otherwise we show the municipality.' }}</span>
            </label>
            @if (usePin() && municipality()) {
              <div class="picker-map">
                <app-map-view [picker]="true" [marker]="pin()" [center]="mapCenter()" (picked)="setPin($event)" />
              </div>
            }
          }

          @case (2) {
            <h2>Tell people about it</h2>
            @for (g of groups(); track g.name) {
              <fieldset class="fgroup">
                <legend>{{ g.name }}</legend>
                @if (g.name === 'Legal status') {
                  <p class="muted small">Buyers in Kosovo ask about this first. Ads with clear paperwork get more calls.</p>
                }
                <div class="form-grid">
                  @for (f of g.fields; track f.key) {
                    <div class="stack" [class.wide]="f.type === 'Text' && f.key !== 'model' && f.key !== 'make' || isChoice(f)">
                      <span class="flabel">{{ f.label }}{{ f.required ? ' *' : '' }}</span>
                      @switch (inputKind(f)) {
                        @case ('chips') {
                          <div class="chips">
                            @for (o of f.options; track o.value) {
                              <button type="button" class="chip-toggle" [class.on]="attr(f.key) === o.value" (click)="setAttr(f.key, attr(f.key) === o.value ? null : o.value)">
                                {{ o.label }}
                              </button>
                            }
                          </div>
                        }
                        @case ('select') {
                          <select [ngModel]="attr(f.key) ?? ''" (ngModelChange)="setAttr(f.key, $event || null)">
                            <option value="">Choose…</option>
                            @for (o of f.options; track o.value) {
                              <option [value]="o.value">{{ o.label }}</option>
                            }
                          </select>
                        }
                        @case ('tri') {
                          <div class="segmented">
                            <button type="button" [class.on]="attr(f.key) === true" (click)="setAttr(f.key, true)">Yes</button>
                            <button type="button" [class.on]="attr(f.key) === false" (click)="setAttr(f.key, false)">No</button>
                            <button type="button" [class.on]="attr(f.key) === undefined" (click)="setAttr(f.key, null)">Not sure</button>
                          </div>
                        }
                        @case ('number') {
                          <div class="with-unit">
                            <input type="number" inputmode="decimal" [min]="f.min ?? null" [max]="f.max ?? null"
                              [step]="f.type === 'Number' ? 'any' : 1" [ngModel]="attr(f.key) ?? null"
                              (ngModelChange)="setAttr(f.key, $event === null || $event === '' ? null : +$event)" />
                            @if (f.unit) {
                              <span class="unit">{{ f.unit }}</span>
                            }
                          </div>
                        }
                        @case ('textarea') {
                          <textarea rows="2" maxlength="1000" [ngModel]="attr(f.key) ?? ''" (ngModelChange)="setAttr(f.key, $event || null)"></textarea>
                        }
                        @default {
                          <input type="text" maxlength="200" [ngModel]="attr(f.key) ?? ''" (ngModelChange)="setAttr(f.key, $event || null)" />
                        }
                      }
                      @if (f.help) {
                        <span class="muted small">{{ f.help }}</span>
                      }
                      @if (fieldError(f.key); as e) {
                        <span class="error small">{{ e }}</span>
                      }
                    </div>
                  }
                </div>
                @if (g.toggles.length) {
                  <div class="chips toggles">
                    @for (f of g.toggles; track f.key) {
                      <button type="button" class="chip-toggle" [class.on]="attr(f.key) === true" (click)="setAttr(f.key, attr(f.key) === true ? null : true)">
                        @if (attr(f.key) === true) {
                          <app-icon name="check" [size]="14" [stroke]="2.4" />
                        }
                        {{ f.label }}
                      </button>
                    }
                  </div>
                }
              </fieldset>
            }

            <fieldset class="fgroup">
              <legend>{{ isJob() ? 'Salary and description' : 'Price and description' }}</legend>
              <div class="form-grid">
                <div class="stack">
                  <span class="flabel">{{ isJob() ? 'Monthly salary' : 'Price *' }}</span>
                  <div class="with-unit">
                    <input type="number" inputmode="numeric" min="1" [ngModel]="price()" (ngModelChange)="price.set($event)"
                      [placeholder]="isJob() ? 'Agreed at interview' : ''" />
                    <span class="unit">€{{ unit() ? ' / ' + unit() : '' }}</span>
                  </div>
                  @if (pricePerM2(); as ppm) {
                    <span class="muted small">{{ ppm }} per m²</span>
                  }
                </div>
                <label class="check self-end">
                  <input type="checkbox" [ngModel]="negotiable()" (ngModelChange)="negotiable.set($event)" /> {{ isJob() ? 'Salary is negotiable' : 'Price is negotiable' }}
                </label>
                <div class="stack wide">
                  <span class="flabel">Title *</span>
                  <div class="title-input">
                    <input [ngModel]="title()" (ngModelChange)="title.set($event)" maxlength="140" [placeholder]="suggestedTitle()" />
                    @if (!title() && suggestedTitle()) {
                      <button type="button" class="btn small ghost" (click)="title.set(suggestedTitle())">Use suggestion</button>
                    }
                  </div>
                  @if (fieldError('title'); as e) {
                    <span class="error small">{{ e }}</span>
                  }
                </div>
                <div class="stack wide">
                  <span class="flabel">Description *</span>
                  <textarea rows="6" maxlength="5000" [ngModel]="description()" (ngModelChange)="description.set($event)"
                    [placeholder]="descriptionHint()"></textarea>
                  <span class="muted small">{{ description().length }} / 5000 · at least 20 characters</span>
                </div>
              </div>
            </fieldset>
          }

          @case (3) {
            <h2>Add photos</h2>
            <p class="muted">Ads with 5 or more photos get far more messages. The first photo is the cover. Use the arrows to reorder.</p>
            <div class="photo-grid">
              @for (p of photos(); track p.id; let i = $index; let last = $last) {
                <div class="photo-tile">
                  <img [src]="p.thumbnailUrl" alt="" />
                  @if (i === 0) {
                    <span class="cover-badge">Cover</span>
                  }
                  <div class="photo-actions">
                    <button type="button" class="icon-btn" [disabled]="i === 0" (click)="move(i, -1)" aria-label="Move left"><app-icon name="chevronLeft" [size]="18" /></button>
                    <button type="button" class="icon-btn" [disabled]="last" (click)="move(i, 1)" aria-label="Move right"><app-icon name="chevronRight" [size]="18" /></button>
                    <button type="button" class="icon-btn" (click)="removePhoto(p)" aria-label="Delete photo"><app-icon name="trash" [size]="18" /></button>
                  </div>
                </div>
              }
              <label class="upload-tile" [class.busy]="uploading()">
                <input type="file" accept="image/jpeg,image/png,image/webp" multiple (change)="upload($event)" hidden />
                <app-icon name="camera" [size]="32" [stroke]="1.5" />
                <strong>{{ uploading() ? 'Uploading…' : 'Add photos' }}</strong>
                <span class="muted small">JPEG, PNG or WebP · up to 30</span>
              </label>
            </div>
          }

          @case (4) {
            @if (submitted()) {
              <div class="done">
                <app-icon name="check" [size]="40" [stroke]="2.4" />
                <h2>Sent for review</h2>
                <p class="muted">We check new ads quickly, usually within a few hours. You’ll get an email when it’s live.</p>
                <div class="row-actions">
                  <a class="btn" routerLink="/my-ads">Go to my ads</a>
                  <a class="btn ghost" [routerLink]="['/listings', id()]">View the ad</a>
                  <a class="btn ghost" routerLink="/post" (click)="reset()">Post another</a>
                </div>
              </div>
            } @else {
              <h2>Check and publish</h2>
              @if (status() === 'PendingReview') {
                <p class="notice">Your changes are saved and the ad is waiting for review. We’ll email you when it’s live.</p>
              } @else if (status() === 'Active') {
                <p class="notice">This ad is live.</p>
              }
              <div class="review">
                <div class="review-card">
                  @if (preview(); as p) {
                    <app-listing-card [listing]="p" />
                  }
                </div>
                <ul class="checklist">
                  @for (c of checks(); track c.text) {
                    <li [class.ok]="c.ok">
                      <app-icon [name]="c.ok ? 'check' : 'close'" [size]="16" [stroke]="2.4" />
                      <span>{{ c.text }}</span>
                      @if (!c.ok) {
                        <button type="button" class="link small" (click)="goTo(c.step)">Fix</button>
                      }
                    </li>
                  }
                </ul>
              </div>
            }
          }
        }

        @if (error()) {
          <p class="error">{{ error() }}</p>
        }
      </div>

      @if (!submitted()) {
        <footer class="wizard-foot">
          @if (step() > 0) {
            <button type="button" class="btn ghost" (click)="back()"><app-icon name="arrowLeft" [size]="18" /> Back</button>
          }
          <span class="spacer"></span>
          @if (step() < 4) {
            <button type="button" class="btn" [disabled]="busy()" (click)="next()">
              {{ busy() ? 'Saving…' : step() === 2 ? (isJob() ? 'Save and add a logo' : 'Save and add photos') : step() === 3 && !photos().length ? 'Skip for now' : 'Continue' }}
              <app-icon name="arrowRight" [size]="18" />
            </button>
          } @else if (canSubmit()) {
            <button type="button" class="btn" [disabled]="busy() || !ready()" (click)="submit()">
              Send for review
            </button>
          } @else {
            <a class="btn" [routerLink]="['/listings', id()]">View the ad</a>
          }
        </footer>
      }
    </div>
  `,
})
export class PostWizardPage {
  readonly id = input<string>();

  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  protected readonly catalog = inject(Catalog);

  protected readonly steps = STEPS;
  protected readonly dealPost = DEAL_POST;
  protected readonly verticals = [
    { key: 'property' as const, label: 'Property' },
    { key: 'vehicles' as const, label: 'Vehicles' },
    { key: 'goods' as const, label: 'Goods' },
    { key: 'jobs' as const, label: 'Jobs' },
  ];

  protected readonly step = signal(0);
  protected readonly busy = signal(false);
  protected readonly uploading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly serverErrors = signal<Record<string, string[]>>({});
  protected readonly submitted = signal(false);
  protected readonly savedId = signal<string | null>(null);
  protected readonly status = signal<string | null>(null);

  protected readonly categoryKey = signal<string | null>(null);
  protected readonly deal = signal<DealType | null>(null);
  protected readonly municipality = signal('');
  protected readonly place = signal('');
  protected readonly address = signal('');
  protected readonly usePin = signal(false);
  protected readonly pin = signal<{ lat: number; lng: number } | null>(null);
  protected readonly attrs = signal<Attributes>({});
  protected readonly price = signal<number | null>(null);
  protected readonly negotiable = signal(false);
  protected readonly title = signal('');
  protected readonly description = signal('');
  protected readonly photos = signal<Photo[]>([]);

  protected readonly category = computed(() => this.catalog.category(this.categoryKey()));
  protected readonly isJob = computed(() => this.deal() === 'Job');
  protected readonly isVehicle = computed(() => this.category()?.vertical === 'vehicles');
  protected readonly unit = computed(() => (this.deal() ? DEAL_UNIT[this.deal()!] : ''));
  protected readonly municipalities = computed(() => [...this.catalog.locations()].sort((a, b) => a.name.localeCompare(b.name, 'sq')));
  private readonly places = computed(() => this.catalog.municipality(this.municipality())?.places ?? []);
  protected readonly neighbourhoods = computed(() => this.places().filter((p) => p.kind === 'neighbourhood').map((p) => p.name));
  protected readonly villages = computed(() => this.places().filter((p) => p.kind === 'village').map((p) => p.name).sort((a, b) => a.localeCompare(b, 'sq')));
  protected readonly mapCenter = computed(() => {
    const p = this.pin();
    if (p) return { ...p, zoom: 16 };
    const m = this.catalog.municipality(this.municipality());
    return m ? { lat: m.lat, lng: m.lng, zoom: 13 } : null;
  });

  protected readonly groups = computed<Group[]>(() => {
    const groups: Group[] = [];
    for (const f of this.catalog.fields(this.category(), this.deal())) {
      let g = groups.find((x) => x.name === f.group);
      if (!g) groups.push((g = { name: f.group, fields: [], toggles: [] }));
      if (f.type === 'Boolean' && f.group !== 'Legal status') g.toggles.push(f);
      else g.fields.push(f);
    }
    return groups;
  });

  protected readonly pricePerM2 = computed(() => {
    const area = Number(this.attrs()['areaM2']);
    const price = this.price();
    return this.deal() === 'Sale' && area > 0 && price ? formatEur(Math.round(price / area)) : null;
  });

  protected readonly suggestedTitle = computed(() => {
    const cat = this.category();
    if (!cat) return '';
    const a = this.attrs();
    const where = this.place() || this.municipality();
    const at = where ? ` in ${where}` : '';
    const label = (key: string) => {
      const f = cat.fields.find((x) => x.key === key);
      return f ? formatField(f, a[key]) : '';
    };
    if (cat.vertical === 'jobs') {
      if (!a['sector']) return '';
      const kind = a['employmentType'] ? ` (${label('employmentType').toLowerCase()})` : '';
      return `${label('sector')} job${kind}${at}`;
    }
    if (cat.vertical === 'goods') {
      const typeField = cat.fields.find((f) => f.type === 'Select' && f.key.endsWith('Type'));
      const kind = typeField && a[typeField.key] !== 'Other' ? label(typeField.key) : '';
      const name = [a['brand'], a['model']].filter(Boolean).join(' ');
      const size = a['size'] && cat.key === 'clothing' ? `, size ${a['size']}` : '';
      const what = name && kind ? `${name} (${kind.toLowerCase()})` : name || kind;
      if (!what) return '';
      return `${what}${size}${a['condition'] === 'New' ? ', new' : ''}`.replace(/^./, (c) => c.toUpperCase());
    }
    if (cat.vertical === 'vehicles') {
      const name = [a['make'], a['model'], a['year']].filter(Boolean).join(' ');
      if (!name) return '';
      return this.deal() === 'RentDaily' ? `Rent ${name}` : name;
    }
    const noun = cat.key === 'apartments' ? 'apartment' : cat.key === 'houses' ? 'house' : '';
    if (cat.key === 'land') return a['areaM2'] ? `${label('landType') || 'Land'}, ${label('areaM2')}${at}` : '';
    if (cat.key === 'commercial') return a['commercialType'] ? `${label('commercialType')}${a['areaM2'] ? ' of ' + label('areaM2') : ''}${at}` : '';
    if (this.deal() === 'RentNightly')
      return a['maxGuests'] ? `${noun[0].toUpperCase() + noun.slice(1)} for ${a['maxGuests']} guests${at}` : '';
    const rooms = a['rooms'] ? `${a['rooms']}-room ` : '';
    const prefix = this.deal() === 'Sale' ? '' : 'For rent: ';
    return `${prefix}${rooms}${noun}${a['areaM2'] ? ', ' + label('areaM2') : ''}${at}`.replace(/^./, (c) => c.toUpperCase());
  });

  protected readonly descriptionHint = computed(() =>
    this.category()?.vertical === 'jobs'
      ? 'What the job involves, who you’re looking for, hours, pay and benefits, when it starts…'
      : this.category()?.vertical === 'goods'
      ? 'What it is, how it’s been used, any marks or faults, what’s included…'
      : this.isVehicle()
      ? 'Condition, service history, what’s included, why you’re selling…'
      : this.deal() === 'RentNightly'
        ? 'What guests will love, check-in, parking, house rules…'
        : 'Light, view, renovations, what’s nearby, when it’s available…',
  );

  /** What the review step checks before sending; each item links back to its step. */
  protected readonly checks = computed(() => {
    const missing = this.missingRequired();
    return [
      { text: 'Category and type chosen', ok: !!this.category() && !!this.deal(), step: 0 },
      { text: 'Location chosen', ok: !!this.municipality(), step: 1 },
      { text: missing.length ? `Missing: ${missing.join(', ')}` : 'All required details filled in', ok: !missing.length, step: 2 },
      { text: 'Price, title and description', ok: this.detailsOk(), step: 2 },
      this.isJob()
        ? { text: this.photos().length ? `${this.photos().length} photo${this.photos().length === 1 ? '' : 's'}` : 'No photo needed (a logo helps)', ok: true, step: 3 }
        : { text: this.photos().length ? `${this.photos().length} photo${this.photos().length === 1 ? '' : 's'}` : 'At least one photo', ok: this.photos().length > 0, step: 3 },
    ];
  });
  protected readonly ready = computed(() => this.checks().every((c) => c.ok));
  protected readonly canSubmit = computed(() => ['Draft', 'Rejected', 'Expired', null].includes(this.status()));

  protected readonly preview = computed<ListingSummary | null>(() => {
    const cat = this.category();
    if (!cat || !this.deal()) return null;
    return {
      id: this.savedId() ?? 'preview',
      category: cat.key,
      dealType: this.deal()!,
      title: this.title() || this.suggestedTitle(),
      priceEur: this.price() ?? 0,
      negotiable: this.negotiable(),
      municipality: this.municipality(),
      place: this.place() || null,
      lat: 0,
      lng: 0,
      thumbnailUrl: this.photos()[0]?.thumbnailUrl ?? null,
      photoCount: this.photos().length,
      attributes: this.attrs(),
      seller: { name: '', isBusiness: false },
      status: 'Draft',
    };
  });

  constructor() {
    // Any edit clears a stale "please fill in" message; Continue checks again.
    effect(() => {
      this.attrs();
      this.price();
      this.title();
      this.description();
      this.categoryKey();
      this.deal();
      this.municipality();
      untracked(() => this.error.set(null));
    });
    effect(() => {
      const id = this.id();
      if (id) untracked(() => this.loadExisting(id));
    });
  }

  // ---------- Navigation ----------

  protected canJump(i: number): boolean {
    if (i <= this.step()) return true;
    for (let s = 0; s < i; s++) if (this.stepProblem(s)) return false;
    return true;
  }

  protected goTo(i: number) {
    if (!this.canJump(i)) return;
    const show = () => {
      this.error.set(null);
      this.step.set(i);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    // Leaving the first three steps forwards saves them, so a jump from the step bar loses nothing.
    if (i >= 3 && this.step() < 3) this.save(show);
    else show();
  }

  protected back() {
    this.goTo(this.step() - 1);
  }

  protected next() {
    const problem = this.stepProblem(this.step());
    if (problem) {
      this.error.set(problem);
      return;
    }
    if (this.step() === 2) {
      this.save(() => this.goTo(3));
    } else {
      this.error.set(null);
      this.step.update((s) => s + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  private stepProblem(s: number): string | null {
    if (s === 0) return !this.category() ? 'Pick a category.' : !this.deal() ? 'Choose how you want to offer it.' : null;
    if (s === 1) return this.municipality() ? null : 'Choose the municipality.';
    if (s === 2) {
      const missing = this.missingRequired();
      if (missing.length) return `Please fill in: ${missing.join(', ')}.`;
      if (!this.detailsOk())
        return this.isJob()
          ? 'Add a title (5+ characters) and a description (20+ characters).'
          : 'Add a price, a title (5+ characters) and a description (20+ characters).';
    }
    return null;
  }

  private missingRequired(): string[] {
    const a = this.attrs();
    return this.catalog
      .fields(this.category(), this.deal())
      .filter((f) => f.required && (a[f.key] === undefined || a[f.key] === ''))
      .map((f) => f.label);
  }

  private detailsOk(): boolean {
    const title = this.title().trim() || this.suggestedTitle();
    const priceOk = this.isJob() ? (this.price() ?? 0) >= 0 : !!this.price() && this.price()! > 0;
    return priceOk && title.length >= 5 && this.description().trim().length >= 20;
  }

  // ---------- Step 1 ----------

  protected pickCategory(cat: Category) {
    if (this.categoryKey() === cat.key) return;
    this.categoryKey.set(cat.key);
    if (!this.deal() || !cat.deals.includes(this.deal()!)) this.deal.set(cat.deals.length === 1 ? cat.deals[0] : null);
    // Keep values the new category also has (e.g. area when switching apartment → house).
    const keep = Object.fromEntries(Object.entries(this.attrs()).filter(([k]) => cat.fields.some((f) => f.key === k)));
    this.attrs.set(keep);
    this.usePin.set(cat.vertical === 'property');
  }

  // ---------- Step 2 ----------

  protected setMunicipality(name: string) {
    this.municipality.set(name);
    this.place.set('');
    this.pin.set(null);
  }

  protected setPin(p: { lat: number; lng: number }) {
    this.pin.set({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) });
  }

  // ---------- Step 3 ----------

  protected attr(key: string): AttributeValue | undefined {
    return this.attrs()[key];
  }

  protected setAttr(key: string, value: AttributeValue | null) {
    const next = { ...this.attrs() };
    if (value === null || value === undefined || (typeof value === 'number' && Number.isNaN(value))) delete next[key];
    else next[key] = value;
    this.attrs.set(next);
    if (this.serverErrors()[`attributes.${key}`]) {
      const errs = { ...this.serverErrors() };
      delete errs[`attributes.${key}`];
      this.serverErrors.set(errs);
    }
  }

  protected inputKind(f: FieldDef): string {
    if (f.type === 'Select') return (f.options?.length ?? 0) <= 6 ? 'chips' : 'select';
    if (f.type === 'Boolean') return 'tri';
    if (f.type === 'Text') return f.key === 'legalNotes' ? 'textarea' : 'text';
    return 'number';
  }

  protected isChoice(f: FieldDef) {
    return this.inputKind(f) === 'chips' || f.key === 'legalization';
  }

  protected fieldError(key: string): string | null {
    const errs = this.serverErrors();
    return (errs[`attributes.${key}`] ?? errs[key])?.[0] ?? null;
  }

  private body(): ListingUpsert {
    const fields = this.catalog.fields(this.category(), this.deal());
    const a = this.attrs();
    const attributes = Object.fromEntries(Object.entries(a).filter(([k]) => fields.some((f) => f.key === k && appliesTo(f, this.deal()))));
    return {
      category: this.categoryKey()!,
      dealType: this.deal()!,
      title: (this.title().trim() || this.suggestedTitle()).slice(0, 140),
      description: this.description().trim(),
      priceEur: Number(this.price()),
      negotiable: this.negotiable(),
      municipality: this.municipality(),
      place: this.place() || null,
      address: this.address().trim() || null,
      lat: this.usePin() ? (this.pin()?.lat ?? null) : null,
      lng: this.usePin() ? (this.pin()?.lng ?? null) : null,
      attributes,
    };
  }

  private save(then: () => void) {
    const id = this.savedId();
    this.busy.set(true);
    this.error.set(null);
    this.serverErrors.set({});
    const call = id ? this.api.updateListing(id, this.body()) : this.api.createListing(this.body());
    call.subscribe({
      next: (l) => {
        this.busy.set(false);
        if (!this.title().trim()) this.title.set(l.title);
        this.savedId.set(l.id);
        this.status.set(l.status);
        // Keep the wizard in place but make the URL the edit URL, so a reload doesn't lose the draft.
        if (!id) this.location.replaceState(`/my-ads/${l.id}/edit`);
        then();
      },
      error: (e: unknown) => {
        this.busy.set(false);
        const errs = e instanceof HttpErrorResponse ? (e.error?.errors as Record<string, string[]> | undefined) : undefined;
        if (errs) {
          this.serverErrors.set(Object.fromEntries(Object.entries(errs).map(([k, v]) => [k.charAt(0).toLowerCase() + k.slice(1), v])));
          const where = Object.keys(errs).some((k) => /municipality|place|lat|lng/i.test(k)) ? 1 : Object.keys(errs).some((k) => /category|dealtype/i.test(k)) ? 0 : 2;
          this.step.set(where);
        }
        this.error.set(errorMessage(e));
      },
    });
  }

  // ---------- Step 4 ----------

  protected upload(event: Event) {
    const inputEl = event.target as HTMLInputElement;
    const files = Array.from(inputEl.files ?? []);
    inputEl.value = '';
    if (!files.length || !this.savedId()) return;
    this.uploading.set(true);
    this.error.set(null);
    this.api.uploadPhotos(this.savedId()!, files).subscribe({
      next: (photos) => {
        this.photos.set(photos);
        this.uploading.set(false);
      },
      error: (e) => {
        this.uploading.set(false);
        this.error.set(errorMessage(e));
      },
    });
  }

  protected move(index: number, delta: number) {
    const list = [...this.photos()];
    const [item] = list.splice(index, 1);
    list.splice(index + delta, 0, item);
    this.photos.set(list);
    this.api.reorderPhotos(this.savedId()!, list.map((p) => p.id)).subscribe({
      next: (photos) => this.photos.set(photos),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  protected removePhoto(photo: Photo) {
    if (!confirm('Delete this photo?')) return;
    this.api.deletePhoto(this.savedId()!, photo.id).subscribe({
      next: () => this.photos.set(this.photos().filter((p) => p.id !== photo.id)),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  // ---------- Step 5 ----------

  protected submit() {
    const id = this.savedId()!;
    this.busy.set(true);
    this.error.set(null);
    this.api.submitListing(id).subscribe({
      next: (l) => {
        this.busy.set(false);
        this.status.set(l.status);
        this.submitted.set(true);
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(errorMessage(e));
      },
    });
  }

  protected reset() {
    this.submitted.set(false);
    this.savedId.set(null);
    this.status.set(null);
    this.step.set(0);
    this.categoryKey.set(null);
    this.deal.set(null);
    this.attrs.set({});
    this.price.set(null);
    this.title.set('');
    this.description.set('');
    this.photos.set([]);
    this.place.set('');
    this.address.set('');
    this.pin.set(null);
  }

  private loadExisting(id: string) {
    this.api.listing(id).subscribe({
      next: (l: ListingDetail) => {
        if (!l.isMine) {
          this.router.navigate(['/listings', id]);
          return;
        }
        this.savedId.set(l.id);
        this.status.set(l.status);
        this.categoryKey.set(l.category);
        this.deal.set(l.dealType);
        this.municipality.set(l.municipality);
        this.place.set(l.place ?? '');
        this.address.set(l.address ?? '');
        const centre = this.catalog.municipality(l.municipality);
        const pinned = !centre || Math.abs(centre.lat - l.lat) > 1e-5 || Math.abs(centre.lng - l.lng) > 1e-5;
        this.usePin.set(pinned);
        this.pin.set(pinned ? { lat: l.lat, lng: l.lng } : null);
        this.attrs.set({ ...l.attributes });
        this.price.set(l.priceEur);
        this.negotiable.set(l.negotiable);
        this.title.set(l.title);
        this.description.set(l.description);
        this.photos.set(l.photos);
        this.step.set(2);
      },
      error: (e) => this.loadError.set(errorMessage(e)),
    });
  }
}

