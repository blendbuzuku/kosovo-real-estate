import { Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { Catalog, LocationHit } from '../core/catalog';
import { Icon } from './icon';

export interface LocationValue {
  municipality: string | null;
  place: string | null;
}

/**
 * "Where" box: type any municipality, neighbourhood or village (with or without ë/ç) and pick it.
 * Every place in Kosovo's list is reachable from here.
 */
@Component({
  selector: 'app-location-input',
  imports: [Icon],
  host: { class: 'location-input', '(document:click)': 'onDocumentClick($event)' },
  template: `
    <div class="loc-field" [class.open]="open()">
      <app-icon name="pin" [size]="18" />
      <input
        #box
        type="text"
        role="combobox"
        autocomplete="off"
        [attr.aria-expanded]="open()"
        aria-autocomplete="list"
        [attr.aria-label]="label()"
        [placeholder]="placeholder()"
        [value]="text()"
        (focus)="openList(); box.select()"
        (click)="reopen()"
        (input)="onType($any($event.target).value)"
        (keydown)="onKey($event)"
      />
      @if (municipality()) {
        <button type="button" class="clear" aria-label="Clear location" (click)="choose(null)">
          <app-icon name="close" [size]="16" />
        </button>
      }
    </div>
    @if (open()) {
      <ul class="loc-list" role="listbox">
        @if (!query()) {
          <li role="option" [class.active]="active() === -1" (mousedown)="$event.preventDefault()" (click)="choose(null)">
            <app-icon name="map" [size]="16" /> <span>Anywhere in Kosovo</span>
          </li>
        }
        @for (h of hits(); track h.label; let i = $index) {
          <li
            role="option"
            [class.active]="i === active()"
            [attr.aria-selected]="i === active()"
            (mousedown)="$event.preventDefault()"
            (click)="choose(h)"
          >
            <app-icon [name]="h.kind === 'municipality' ? 'building' : 'pin'" [size]="16" />
            <span>
              <strong>{{ h.place ?? h.municipality }}</strong>
              @if (h.place) {
                <span class="muted">, {{ h.municipality }}</span>
              }
            </span>
            <span class="kind">{{ kindLabel[h.kind] }}</span>
          </li>
        } @empty {
          <li class="muted none">No place called “{{ query() }}”. Try the municipality name.</li>
        }
      </ul>
    }
  `,
})
export class LocationInput {
  readonly municipality = input<string | null | undefined>(null);
  readonly place = input<string | null | undefined>(null);
  readonly placeholder = input('City, neighbourhood or village');
  readonly label = input('Location');
  readonly changed = output<LocationValue>();

  private readonly catalog = inject(Catalog);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly box = viewChild.required<ElementRef<HTMLInputElement>>('box');

  protected readonly kindLabel = { municipality: 'Municipality', neighbourhood: 'Neighbourhood', village: 'Village' };
  protected readonly open = signal(false);
  protected readonly query = signal('');
  protected readonly text = signal('');
  protected readonly active = signal(0);
  protected readonly hits = computed<LocationHit[]>(() => this.catalog.searchLocations(this.query(), this.query() ? 12 : 38));

  constructor() {
    effect(() => {
      const m = this.municipality();
      const p = this.place();
      this.text.set(m ? (p ? `${p}, ${m}` : m) : '');
    });
  }

  protected openList() {
    this.query.set('');
    this.active.set(-1);
    this.open.set(true);
  }

  /** A click on the already-focused box (after Escape or a pick) opens the list again. */
  protected reopen() {
    if (this.open()) return;
    this.openList();
    this.box().nativeElement.select();
  }

  protected onType(value: string) {
    this.text.set(value);
    this.query.set(value);
    this.active.set(0);
    this.open.set(true);
  }

  protected onKey(e: KeyboardEvent) {
    const n = this.hits().length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.open.set(true);
      this.active.set(Math.min(this.active() + 1, n - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.active.set(Math.max(this.active() - 1, this.query() ? 0 : -1));
    } else if (e.key === 'Enter' && this.open()) {
      e.preventDefault();
      const i = this.active();
      this.choose(i === -1 ? null : (this.hits()[i] ?? null));
    } else if (e.key === 'Escape') {
      this.close();
    }
  }

  protected choose(h: LocationHit | null) {
    const value = { municipality: h?.municipality ?? null, place: h?.place ?? null };
    this.showText(h ? h.label : '');
    this.open.set(false);
    this.changed.emit(value);
    this.box().nativeElement.blur();
  }

  protected onDocumentClick(e: Event) {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.close();
  }

  private close() {
    this.open.set(false);
    // Typed text that wasn't picked is dropped, so the box always shows the real filter.
    const m = this.municipality();
    const p = this.place();
    this.showText(m ? (p ? `${p}, ${m}` : m) : '');
  }

  /**
   * Sets the box's text. Writes the input directly too: if the user typed and pressed Escape before
   * the next render, the signal goes back to the value last rendered and Angular wouldn't touch the box.
   */
  private showText(value: string) {
    this.text.set(value);
    const el = this.box()?.nativeElement;
    if (el && el.value !== value) el.value = value;
  }
}
