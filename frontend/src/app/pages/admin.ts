import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../core/api.service';
import { LabelPipe, PricePipe, REPORT_REASONS, STATUS, placeLabel } from '../core/labels';
import { Catalog } from '../core/catalog';
import { AdminStats, ListingSummary, Report } from '../core/models';

@Component({
  selector: 'app-admin',
  imports: [RouterLink, DatePipe, PricePipe, LabelPipe],
  template: `
    <div class="container">
      <h1>Moderation</h1>
      @if (stats(); as s) {
        <div class="stats">
          <div class="card stat"><strong>{{ s.pendingReview }}</strong><span>waiting for review</span></div>
          <div class="card stat"><strong>{{ s.openReports }}</strong><span>open reports</span></div>
          <div class="card stat"><strong>{{ s.active }}</strong><span>live listings</span></div>
          <div class="card stat"><strong>{{ s.users }}</strong><span>users</span></div>
          <div class="card stat"><strong>{{ s.businesses }}</strong><span>businesses</span></div>
        </div>
      }
      <div class="tabs">
        <button type="button" [class.active]="tab() === 'queue'" (click)="tab.set('queue')">Review queue</button>
        <button type="button" [class.active]="tab() === 'reports'" (click)="tab.set('reports')">Reports</button>
      </div>
      @if (error()) {
        <p class="error">{{ error() }}</p>
      }

      @if (tab() === 'queue') {
        @for (l of queue(); track l.id) {
          <div class="card row-item">
            <a [routerLink]="['/listings', l.id]" target="_blank" class="row-thumb">
              @if (l.thumbnailUrl) {
                <img [src]="l.thumbnailUrl" alt="" />
              } @else {
                <div class="thumb-placeholder">No photo</div>
              }
            </a>
            <div class="row-main">
              <a [routerLink]="['/listings', l.id]" target="_blank"><strong>{{ l.title }}</strong></a>
              <div class="muted small">
                {{ categoryName(l.category) }} · {{ l.priceEur | price: l.dealType }} · {{ place(l) }} · {{ l.photoCount }} photos
              </div>
              <div class="small">{{ facts(l) }}</div>
            </div>
            <div class="row-actions column">
              <button type="button" class="btn small" (click)="approve(l)">Approve</button>
              @if (rejecting() === l.id) {
                <input #reason class="inline-input" placeholder="Reason shown to the owner" />
                <button type="button" class="btn small danger" (click)="reject(l, reason.value)">Send rejection</button>
              } @else {
                <button type="button" class="btn small ghost danger" (click)="rejecting.set(l.id)">Reject…</button>
              }
            </div>
          </div>
        } @empty {
          <p class="card empty muted">The queue is empty. 🎉</p>
        }
      } @else {
        @for (r of reports(); track r.id) {
          <div class="card row-item">
            <div class="row-main">
              <a [routerLink]="['/listings', r.listingId]" target="_blank"><strong>{{ r.listingTitle }}</strong></a>
              <span class="status-pill" [attr.data-status]="r.listingStatus">{{ r.listingStatus | label: statuses }}</span>
              <div><strong>{{ r.reason | label: reasons }}</strong>{{ r.comment ? ': “' + r.comment + '”' : '' }}</div>
              <div class="muted small">
                {{ r.reporterEmail }} · {{ r.createdAt | date: 'd MMM y, HH:mm' }} · {{ r.openReportsOnListing }} open report(s) on this listing
              </div>
            </div>
            <div class="row-actions column">
              <button type="button" class="btn small danger" (click)="resolve(r, true)">Take listing down</button>
              <button type="button" class="btn small ghost" (click)="resolve(r, false)">Dismiss</button>
            </div>
          </div>
        } @empty {
          <p class="card empty muted">No open reports.</p>
        }
      }
    </div>
  `,
})
export class AdminPage {
  private readonly api = inject(Api);
  private readonly catalog = inject(Catalog);
  protected readonly reasons = REPORT_REASONS;
  protected readonly statuses = STATUS;
  protected readonly tab = signal<'queue' | 'reports'>('queue');
  protected readonly stats = signal<AdminStats | null>(null);
  protected readonly queue = signal<ListingSummary[]>([]);
  protected readonly reports = signal<Report[]>([]);
  protected readonly rejecting = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  constructor() {
    this.reload();
  }

  protected categoryName(key: string) {
    return this.catalog.category(key)?.name ?? key;
  }

  protected place(l: ListingSummary) {
    return placeLabel(l);
  }

  protected facts(l: ListingSummary) {
    return this.catalog.cardFacts(l).join(' · ');
  }

  protected approve(l: ListingSummary) {
    this.api.approve(l.id).subscribe({ next: () => this.reload(), error: (e) => this.error.set(errorMessage(e)) });
  }

  protected reject(l: ListingSummary, reason: string) {
    if (reason.trim().length < 3) {
      this.error.set('Write a short reason so the owner knows what to fix.');
      return;
    }
    this.api.reject(l.id, reason.trim()).subscribe({
      next: () => {
        this.rejecting.set(null);
        this.reload();
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  protected resolve(r: Report, removeListing: boolean) {
    this.api.resolveReport(r.id, removeListing).subscribe({
      next: () => this.reload(),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  private reload() {
    this.error.set(null);
    this.api.adminStats().subscribe((s) => this.stats.set(s));
    this.api.adminListings().subscribe((r) => this.queue.set(r.items));
    this.api.reports().subscribe((r) => this.reports.set(r));
  }
}
