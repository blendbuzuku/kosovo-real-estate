import { Component, ElementRef, OnDestroy, afterNextRender, effect, input, output, viewChild } from '@angular/core';
import * as L from 'leaflet';
import { shortPrice } from '../core/labels';
import { MapPin } from '../core/models';

export const KOSOVO_CENTER: L.LatLngTuple = [42.6, 20.9];

/**
 * Leaflet + OpenStreetMap. Three uses:
 * - search: price pins, emits the viewport as a bbox when the user pans
 * - detail: one fixed marker
 * - picker: click or drag to choose the property's location
 */
@Component({
  selector: 'app-map-view',
  template: `<div #host class="map-host"></div>`,
  styles: `
    :host { display: block; }
    .map-host { width: 100%; height: 100%; min-height: 260px; border-radius: var(--radius); }
  `,
})
export class MapView implements OnDestroy {
  readonly pins = input<MapPin[]>([]);
  readonly marker = input<{ lat: number; lng: number } | null>(null);
  readonly center = input<{ lat: number; lng: number; zoom?: number } | null>(null);
  readonly picker = input(false);

  readonly boundsChange = output<string>();
  readonly pinClick = output<string>();
  readonly picked = output<{ lat: number; lng: number }>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private map?: L.Map;
  private pinLayer = L.layerGroup();
  private singleMarker?: L.Marker;
  private suppressMoveEvent = false;

  constructor() {
    afterNextRender(() => this.init());

    effect(() => {
      const pins = this.pins();
      if (this.map) this.drawPins(pins);
    });
    effect(() => {
      const m = this.marker();
      if (this.map) this.drawMarker(m);
    });
    effect(() => {
      const c = this.center();
      if (this.map && c) this.moveTo(c.lat, c.lng, c.zoom);
    });
  }

  private init() {
    const c = this.center() ?? this.marker();
    const map = L.map(this.host().nativeElement, { scrollWheelZoom: true }).setView(
      c ? [c.lat, c.lng] : KOSOVO_CENTER,
      c ? (this.center()?.zoom ?? 15) : 8,
    );
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    this.pinLayer.addTo(map);
    this.map = map;

    map.on('moveend', () => {
      if (this.suppressMoveEvent) {
        this.suppressMoveEvent = false;
        return;
      }
      const b = map.getBounds();
      this.boundsChange.emit(
        [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => v.toFixed(5)).join(','),
      );
    });

    if (this.picker()) {
      map.on('click', (e: L.LeafletMouseEvent) => this.pick(e.latlng.lat, e.latlng.lng));
    }

    this.drawPins(this.pins());
    this.drawMarker(this.marker());
    // The host may have been sized after Leaflet measured it.
    setTimeout(() => map.invalidateSize(), 0);
  }

  private moveTo(lat: number, lng: number, zoom?: number) {
    this.suppressMoveEvent = true;
    this.map!.setView([lat, lng], zoom ?? this.map!.getZoom());
  }

  private drawPins(pins: MapPin[]) {
    this.pinLayer.clearLayers();
    for (const p of pins) {
      const icon = L.divIcon({
        className: 'price-pin',
        html: `<span class="${p.dealType === 'Sale' ? 'sale' : 'rent'}">${shortPrice(p.priceEur)}</span>`,
        iconSize: undefined,
      });
      L.marker([p.lat, p.lng], { icon, title: shortPrice(p.priceEur) })
        .on('click', () => this.pinClick.emit(p.id))
        .addTo(this.pinLayer);
    }
  }

  private drawMarker(m: { lat: number; lng: number } | null) {
    if (!m) {
      this.singleMarker?.remove();
      this.singleMarker = undefined;
      return;
    }
    if (!this.singleMarker) {
      this.singleMarker = L.marker([m.lat, m.lng], {
        icon: L.divIcon({ className: 'home-pin', html: '<span></span>', iconSize: [28, 28], iconAnchor: [14, 28] }),
        draggable: this.picker(),
      }).addTo(this.map!);
      this.singleMarker.on('dragend', () => {
        const p = this.singleMarker!.getLatLng();
        this.picked.emit({ lat: p.lat, lng: p.lng });
      });
    } else {
      this.singleMarker.setLatLng([m.lat, m.lng]);
    }
  }

  private pick(lat: number, lng: number) {
    this.drawMarker({ lat, lng });
    this.picked.emit({ lat, lng });
  }

  ngOnDestroy() {
    // Detach handlers first: a pending moveend would otherwise read a removed map.
    this.map?.off();
    this.map?.remove();
    this.map = undefined;
  }
}
