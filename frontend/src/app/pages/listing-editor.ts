import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../core/api.service';
import { DEAL_TYPES, HEATING, LEGALIZATION, LabelPipe, PROPERTY_TYPES, STATUS, entries } from '../core/labels';
import {
  DealType,
  HeatingType,
  LegalizationStatus,
  ListingDetail,
  ListingUpsert,
  Photo,
  PropertyType,
} from '../core/models';
import { Cities } from '../core/stores';
import { MapView } from '../shared/map-view';

/** Tri-state select value for yes / no / not specified. */
type TriState = '' | 'true' | 'false';
const toTri = (v: boolean | null | undefined): TriState => (v === true ? 'true' : v === false ? 'false' : '');
const fromTri = (v: TriState): boolean | null => (v === '' ? null : v === 'true');

@Component({
  selector: 'app-listing-editor',
  imports: [ReactiveFormsModule, RouterLink, MapView, LabelPipe],
  template: `
    <div class="container editor">
      <div class="title-row">
        <h1>{{ id() ? 'Edit listing' : 'Post a property' }}</h1>
        @if (listing(); as l) {
          <span class="status-pill" [attr.data-status]="l.status">{{ l.status | label: statuses }}</span>
        }
      </div>
      @if (listing()?.moderationNote) {
        <p class="notice warn">Reviewer’s note: “{{ listing()!.moderationNote }}”. Fix it and submit again.</p>
      }
      @if (listing()?.status === 'Active') {
        <p class="notice">This listing is live. Saving changes sends it back for a quick review before it shows again.</p>
      }

      <form [formGroup]="form" (ngSubmit)="save()">
        <section class="card">
          <h2>What are you listing?</h2>
          <div class="form-grid">
            <label class="stack">
              <span>Deal</span>
              <select formControlName="dealType">
                @for (d of deals; track d.value) {
                  <option [value]="d.value">{{ d.label }}</option>
                }
              </select>
            </label>
            <label class="stack">
              <span>Property type</span>
              <select formControlName="propertyType">
                @for (t of types; track t.value) {
                  <option [value]="t.value">{{ t.label }}</option>
                }
              </select>
            </label>
          </div>
          <label class="stack">
            <span>Title</span>
            <input formControlName="title" maxlength="140" placeholder="e.g. Bright 2-room apartment near Sheshi Nëna Terezë" />
          </label>
          <label class="stack">
            <span>Description</span>
            <textarea formControlName="description" rows="6" maxlength="5000"
              placeholder="Layout, condition, what’s nearby, when it’s available…"></textarea>
          </label>
        </section>

        <section class="card">
          <h2>Price and size</h2>
          <div class="form-grid">
            <label class="stack">
              <span>Price in € {{ priceSuffix() }}</span>
              <input type="number" min="1" formControlName="priceEur" />
            </label>
            <label class="stack"><span>Area (m²)</span><input type="number" min="1" formControlName="areaM2" /></label>
            @if (!isLand()) {
              <label class="stack"><span>Rooms</span><input type="number" min="0" formControlName="rooms" /></label>
              <label class="stack"><span>Bathrooms</span><input type="number" min="0" formControlName="bathrooms" /></label>
              <label class="stack"><span>Floor</span><input type="number" formControlName="floor" /></label>
              <label class="stack"><span>Floors in building</span><input type="number" min="1" formControlName="totalFloors" /></label>
              <label class="stack"><span>Year built</span><input type="number" min="1800" max="2100" formControlName="yearBuilt" /></label>
              <label class="stack">
                <span>Heating</span>
                <select formControlName="heating">
                  @for (h of heating; track h.value) {
                    <option [value]="h.value">{{ h.label }}</option>
                  }
                </select>
              </label>
            }
          </div>
          @if (!isLand()) {
            <div class="checks">
              <label class="check"><input type="checkbox" formControlName="hasParking" /> Parking</label>
              <label class="check"><input type="checkbox" formControlName="isFurnished" /> Furnished</label>
              <label class="check"><input type="checkbox" formControlName="hasElevator" /> Elevator</label>
              <label class="check"><input type="checkbox" formControlName="hasBalcony" /> Balcony</label>
            </div>
          }
        </section>

        <section class="card">
          <h2>Location</h2>
          <div class="form-grid">
            <label class="stack">
              <span>City</span>
              <select formControlName="city">
                <option value="" disabled>Choose a city</option>
                @for (c of cities.all(); track c.name) {
                  <option [value]="c.name">{{ c.name }}</option>
                }
              </select>
            </label>
            <label class="stack">
              <span>Neighbourhood</span>
              <input formControlName="neighborhood" list="neighborhoods" />
              <datalist id="neighborhoods">
                @for (n of neighborhoods(); track n) {
                  <option [value]="n"></option>
                }
              </datalist>
            </label>
            <label class="stack wide">
              <span>Street address (optional, shown publicly)</span>
              <input formControlName="address" maxlength="200" />
            </label>
          </div>
          <p class="muted small">Click the map or drag the pin to the building’s exact spot.</p>
          <app-map-view class="picker-map" [picker]="true" [marker]="pin()" [center]="mapCenter()" (picked)="setPin($event)" />
          @if (!pin()) {
            <p class="error small">Place the pin on the map.</p>
          }
        </section>

        <section class="card legal-panel">
          <h2>Legal status</h2>
          <p class="muted small">Buyers in Kosovo look for this first. Honest answers get more serious enquiries.</p>
          <div class="form-grid">
            <label class="stack">
              <span>Is the building legalized?</span>
              <select formControlName="legalization">
                @for (s of legalizationOptions; track s.value) {
                  <option [value]="s.value">{{ s.label }}</option>
                }
              </select>
            </label>
            <label class="stack">
              <span>Cadastre certificate (certifikata e pronësisë)</span>
              <select formControlName="hasCadastreCertificate">
                <option value="">Not specified</option>
                <option value="true">Yes, in the seller’s name</option>
                <option value="false">No</option>
              </select>
            </label>
            <label class="stack">
              <span>Construction permit (leje ndërtimi)</span>
              <select formControlName="hasConstructionPermit">
                <option value="">Not specified</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </label>
          </div>
          <label class="stack">
            <span>Notes on paperwork (optional)</span>
            <textarea formControlName="legalNotes" rows="2" maxlength="1000"
              placeholder="e.g. Legalization application filed in 2024, decision expected this year"></textarea>
          </label>
        </section>

        @if (error()) {
          <p class="error">{{ error() }}</p>
        }
        @if (saved()) {
          <p class="notice">{{ saved() }}</p>
        }
        <div class="form-actions">
          <button type="submit" class="btn" [disabled]="busy()">{{ id() ? 'Save changes' : 'Save and add photos' }}</button>
          <a class="link" routerLink="/my-listings">Back to my listings</a>
        </div>
      </form>

      @if (id()) {
        <section class="card">
          <h2>Photos</h2>
          <p class="muted small">JPEG, PNG or WebP, up to 15 MB each and 30 in total. The first photo is the cover.</p>
          <div class="photo-grid">
            @for (p of photos(); track p.id; let i = $index; let last = $last) {
              <figure>
                <img [src]="p.thumbnailUrl" alt="" />
                @if (i === 0) {
                  <span class="chip cover">Cover</span>
                }
                <figcaption>
                  <button type="button" [disabled]="i === 0" (click)="move(i, -1)" aria-label="Move left">←</button>
                  <button type="button" [disabled]="last" (click)="move(i, 1)" aria-label="Move right">→</button>
                  <button type="button" class="danger" (click)="removePhoto(p)" aria-label="Delete photo">✕</button>
                </figcaption>
              </figure>
            }
            <label class="upload-tile" [class.busy]="uploading()">
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple (change)="upload($event)" hidden />
              <span>{{ uploading() ? 'Uploading…' : '+ Add photos' }}</span>
            </label>
          </div>
        </section>

        @if (canSubmit()) {
          <div class="card submit-card">
            <div>
              <h2>Ready to publish?</h2>
              <p class="muted">Our team checks every listing before it goes live. Live listings stay up for 60 days and can be renewed.</p>
            </div>
            <button type="button" class="btn" [disabled]="!photos().length || busy()" (click)="submit()">
              Submit for review
            </button>
          </div>
        }
      }
    </div>
  `,
})
export class ListingEditorPage {
  readonly id = input<string>();

  private readonly api = inject(Api);
  private readonly router = inject(Router);
  protected readonly cities = inject(Cities);

  protected readonly deals = entries(DEAL_TYPES);
  protected readonly types = entries(PROPERTY_TYPES);
  protected readonly heating = entries(HEATING);
  protected readonly legalizationOptions = entries(LEGALIZATION);
  protected readonly statuses = STATUS;

  protected readonly listing = signal<ListingDetail | null>(null);
  protected readonly photos = signal<Photo[]>([]);
  protected readonly pin = signal<{ lat: number; lng: number } | null>(null);
  protected readonly mapCenter = signal<{ lat: number; lng: number; zoom?: number } | null>(null);
  protected readonly busy = signal(false);
  protected readonly uploading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly saved = signal<string | null>(null);

  protected readonly form = inject(FormBuilder).group({
    dealType: ['Sale' as DealType],
    propertyType: ['Apartment' as PropertyType],
    title: ['', [Validators.required, Validators.minLength(5), Validators.maxLength(140)]],
    description: ['', [Validators.required, Validators.minLength(20)]],
    priceEur: [null as number | null, [Validators.required, Validators.min(1)]],
    areaM2: [null as number | null, [Validators.required, Validators.min(1)]],
    rooms: [null as number | null],
    bathrooms: [null as number | null],
    floor: [null as number | null],
    totalFloors: [null as number | null],
    yearBuilt: [null as number | null],
    heating: ['None' as HeatingType],
    hasParking: [false],
    isFurnished: [false],
    hasElevator: [false],
    hasBalcony: [false],
    city: ['', Validators.required],
    neighborhood: [''],
    address: [''],
    legalization: ['Unknown' as LegalizationStatus],
    hasCadastreCertificate: ['' as TriState],
    hasConstructionPermit: ['' as TriState],
    legalNotes: [''],
  });

  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.value });
  protected readonly isLand = computed(() => this.formValue().propertyType === 'Land');
  protected readonly neighborhoods = computed(() => this.cities.find(this.formValue().city)?.neighborhoods ?? []);
  protected readonly priceSuffix = computed(() =>
    this.formValue().dealType === 'RentMonthly' ? 'per month' : this.formValue().dealType === 'RentShortTerm' ? 'per night' : '',
  );
  protected readonly canSubmit = computed(() => {
    const s = this.listing()?.status;
    return s === 'Draft' || s === 'Rejected';
  });

  constructor() {
    effect(() => {
      const id = this.id();
      if (!id) return;
      this.api.listing(id).subscribe({
        next: (l) => this.load(l),
        error: (e) => this.error.set(errorMessage(e)),
      });
    });

    // Picking a city moves the map there (unless the pin is already placed).
    this.form.controls.city.valueChanges.subscribe((name) => {
      const city = this.cities.find(name);
      if (city && !this.pin()) this.mapCenter.set({ lat: city.lat, lng: city.lng, zoom: 14 });
    });
  }

  protected setPin(p: { lat: number; lng: number }) {
    this.pin.set({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) });
  }

  protected save() {
    this.form.markAllAsTouched();
    if (this.form.invalid || !this.pin()) {
      this.error.set('Please fill in the required fields and place the pin on the map.');
      return;
    }
    const body = this.toRequest();
    const id = this.id();
    this.busy.set(true);
    this.error.set(null);
    this.saved.set(null);
    const call = id ? this.api.updateListing(id, body) : this.api.createListing(body);
    call.subscribe({
      next: (l) => {
        this.busy.set(false);
        if (!id) {
          this.router.navigate(['/my-listings', l.id, 'edit']);
        } else {
          this.load(l);
          this.saved.set(l.status === 'PendingReview' ? 'Saved. It’s back in the review queue.' : 'Saved.');
        }
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(errorMessage(e));
      },
    });
  }

  protected submit() {
    this.busy.set(true);
    this.api.submitListing(this.id()!).subscribe({
      next: (l) => {
        this.busy.set(false);
        this.load(l);
        this.saved.set('Submitted. You’ll get an email when it’s approved.');
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(errorMessage(e));
      },
    });
  }

  protected upload(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;
    this.uploading.set(true);
    this.error.set(null);
    this.api.uploadPhotos(this.id()!, files).subscribe({
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
    this.api.reorderPhotos(this.id()!, list.map((p) => p.id)).subscribe({
      next: (photos) => this.photos.set(photos),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  protected removePhoto(photo: Photo) {
    if (!confirm('Delete this photo?')) return;
    this.api.deletePhoto(this.id()!, photo.id).subscribe({
      next: () => this.photos.set(this.photos().filter((p) => p.id !== photo.id)),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  private load(l: ListingDetail) {
    this.listing.set(l);
    this.photos.set(l.photos);
    this.pin.set({ lat: l.lat, lng: l.lng });
    this.mapCenter.set({ lat: l.lat, lng: l.lng, zoom: 16 });
    this.form.patchValue({
      dealType: l.dealType,
      propertyType: l.propertyType,
      title: l.title,
      description: l.description,
      priceEur: l.priceEur,
      areaM2: l.areaM2,
      rooms: l.rooms ?? null,
      bathrooms: l.bathrooms ?? null,
      floor: l.floor ?? null,
      totalFloors: l.totalFloors ?? null,
      yearBuilt: l.yearBuilt ?? null,
      heating: l.heating,
      hasParking: l.hasParking,
      isFurnished: l.isFurnished,
      hasElevator: l.hasElevator,
      hasBalcony: l.hasBalcony,
      city: l.city,
      neighborhood: l.neighborhood ?? '',
      address: l.address ?? '',
      legalization: l.legal.legalization,
      hasCadastreCertificate: toTri(l.legal.hasCadastreCertificate),
      hasConstructionPermit: toTri(l.legal.hasConstructionPermit),
      legalNotes: l.legal.notes ?? '',
    });
  }

  private toRequest(): ListingUpsert {
    const v = this.form.getRawValue();
    const land = v.propertyType === 'Land';
    return {
      title: v.title!,
      description: v.description!,
      propertyType: v.propertyType!,
      dealType: v.dealType!,
      priceEur: v.priceEur!,
      areaM2: v.areaM2!,
      rooms: land ? null : v.rooms,
      bathrooms: land ? null : v.bathrooms,
      floor: land ? null : v.floor,
      totalFloors: land ? null : v.totalFloors,
      yearBuilt: land ? null : v.yearBuilt,
      heating: land ? 'None' : v.heating!,
      hasParking: !land && !!v.hasParking,
      isFurnished: !land && !!v.isFurnished,
      hasElevator: !land && !!v.hasElevator,
      hasBalcony: !land && !!v.hasBalcony,
      city: v.city!,
      neighborhood: v.neighborhood || null,
      address: v.address || null,
      lat: this.pin()!.lat,
      lng: this.pin()!.lng,
      legal: {
        legalization: v.legalization!,
        hasCadastreCertificate: fromTri(v.hasCadastreCertificate!),
        hasConstructionPermit: fromTri(v.hasConstructionPermit!),
        notes: v.legalNotes || null,
      },
    };
  }
}
