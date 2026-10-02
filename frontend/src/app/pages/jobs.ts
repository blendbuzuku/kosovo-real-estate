import { DatePipe } from '@angular/common';
import { Component, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../core/api.service';
import { APPLICATION_STATUS, LabelPipe } from '../core/labels';
import { Applicant, ApplicationStatus, JobApplicants, MyApplication } from '../core/models';
import { Icon } from '../shared/icon';

/** Jobs the signed-in user applied for, with where each one stands. */
@Component({
  selector: 'app-my-applications',
  imports: [RouterLink, DatePipe, LabelPipe, Icon],
  template: `
    <div class="container narrow-page wide">
      <div class="title-row">
        <h1>My applications</h1>
        <a class="btn ghost" routerLink="/search" [queryParams]="{ vertical: 'jobs' }"><app-icon name="search" [size]="18" /> Find jobs</a>
      </div>
      @if (error()) {
        <p class="error">{{ error() }}</p>
      }
      <div class="rows">
        @for (a of applications(); track a.id) {
          <div class="card row-item application">
            <div class="row-main">
              <a [routerLink]="['/listings', a.listingId]"><strong>{{ a.listingTitle }}</strong></a>
              <div class="muted small">{{ a.employer }} · {{ a.municipality }} · applied {{ a.createdAt | date: 'd MMM y' }}</div>
              <div class="small">
                <span class="app-status" [attr.data-status]="a.status">{{ a.status | label: statuses }}</span>
                @if (a.listingStatus !== 'Active') {
                  <span class="muted"> · the ad is closed</span>
                }
              </div>
            </div>
            <div class="row-actions">
              @if (a.cvFileName) {
                <button type="button" class="btn small ghost" (click)="cv(a)"><app-icon name="download" [size]="16" /> {{ a.cvFileName }}</button>
              }
              <a class="btn small" [routerLink]="['/messages', a.conversationId]"><app-icon name="chat" [size]="16" /> Messages</a>
            </div>
          </div>
        } @empty {
          @if (loaded()) {
            <div class="card empty">
              <p class="muted">You haven’t applied for any jobs yet.</p>
              <a class="btn" routerLink="/search" [queryParams]="{ vertical: 'jobs' }">Browse jobs</a>
            </div>
          }
        }
      </div>
    </div>
  `,
})
export class MyApplicationsPage {
  private readonly api = inject(Api);
  protected readonly statuses = APPLICATION_STATUS;
  protected readonly applications = signal<MyApplication[]>([]);
  protected readonly loaded = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    this.api.myApplications().subscribe({
      next: (a) => {
        this.applications.set(a);
        this.loaded.set(true);
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  protected cv(a: MyApplication) {
    this.api.downloadCv(a.id, a.cvFileName ?? 'CV').subscribe({ error: (e) => this.error.set(errorMessage(e)) });
  }
}

/** The employer's view of everyone who applied for one job ad. */
@Component({
  selector: 'app-applicants',
  imports: [RouterLink, DatePipe, LabelPipe, Icon],
  template: `
    <div class="container narrow-page wide">
      <a class="back-link" routerLink="/my-ads"><app-icon name="arrowLeft" [size]="16" /> My ads</a>
      @if (data(); as d) {
        <div class="title-row">
          <div>
            <h1>Applicants</h1>
            <p class="muted"><a [routerLink]="['/listings', d.listingId]">{{ d.listingTitle }}</a> · {{ d.applicants.length }}
              {{ d.applicants.length === 1 ? 'application' : 'applications' }}</p>
          </div>
        </div>
        <div class="tabs">
          @for (t of filters; track t.label) {
            <button type="button" [class.active]="filter() === t.status" (click)="filter.set(t.status)">
              {{ t.label }} <span class="count">{{ count(t.status) }}</span>
            </button>
          }
        </div>
        @if (error()) {
          <p class="error">{{ error() }}</p>
        }
        <div class="rows">
          @for (a of d.applicants; track a.id) {
            @if (!filter() || a.status === filter()) {
              <article class="card applicant">
                <header>
                  <span class="avatar">{{ a.name.charAt(0) }}</span>
                  <div>
                    <strong>{{ a.name }}</strong>
                    <div class="muted small">Applied {{ a.createdAt | date: 'd MMM y, HH:mm' }}</div>
                  </div>
                  <span class="app-status" [attr.data-status]="a.status">{{ a.status | label: statuses }}</span>
                </header>
                <p class="cover">{{ a.coverLetter }}</p>
                <div class="contact-line small">
                  <a [href]="'mailto:' + a.email"><app-icon name="chat" [size]="14" /> {{ a.email }}</a>
                  @if (a.phone) {
                    <a [href]="'tel:' + a.phone"><app-icon name="phone" [size]="14" /> {{ a.phone }}</a>
                  }
                </div>
                <footer>
                  @if (a.cvFileName) {
                    <button type="button" class="btn small ghost" (click)="cv(a)"><app-icon name="download" [size]="16" /> {{ a.cvFileName }}</button>
                  } @else {
                    <span class="muted small">No CV attached</span>
                  }
                  <span class="spacer"></span>
                  <a class="btn small ghost" [routerLink]="['/messages', a.conversationId]"><app-icon name="chat" [size]="16" /> Message</a>
                  @if (a.status !== 'Shortlisted') {
                    <button type="button" class="btn small" (click)="set(a, 'Shortlisted')">Shortlist</button>
                  }
                  @if (a.status !== 'Rejected') {
                    <button type="button" class="btn small ghost danger" (click)="set(a, 'Rejected')">Not a fit</button>
                  }
                  @if (a.status !== 'New') {
                    <button type="button" class="link small" (click)="set(a, 'New')">Undo</button>
                  }
                </footer>
              </article>
            }
          } @empty {
            <div class="card empty">
              <p class="muted">No applications yet. They’ll show up here, and you’ll get an email for each one.</p>
            </div>
          }
        </div>
      } @else if (error()) {
        <p class="error">{{ error() }}</p>
      }
    </div>
  `,
})
export class ApplicantsPage {
  readonly id = input.required<string>();
  private readonly api = inject(Api);
  protected readonly statuses = APPLICATION_STATUS;
  protected readonly data = signal<JobApplicants | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly filter = signal<ApplicationStatus | null>(null);
  protected readonly filters: { label: string; status: ApplicationStatus | null }[] = [
    { label: 'All', status: null },
    { label: 'New', status: 'New' },
    { label: 'Shortlisted', status: 'Shortlisted' },
    { label: 'Not selected', status: 'Rejected' },
  ];

  constructor() {
    effect(() => {
      const id = this.id();
      this.api.applicants(id).subscribe({
        next: (d) => this.data.set(d),
        error: (e) => this.error.set(e.status === 404 ? 'This job ad isn’t yours or no longer exists.' : errorMessage(e)),
      });
    });
  }

  protected count(status: ApplicationStatus | null) {
    const all = this.data()?.applicants ?? [];
    return status ? all.filter((a) => a.status === status).length : all.length;
  }

  protected set(a: Applicant, status: ApplicationStatus) {
    this.error.set(null);
    this.api.setApplicationStatus(a.id, status).subscribe({
      next: (u) => this.data.update((d) => d && { ...d, applicants: d.applicants.map((x) => (x.id === u.id ? u : x)) }),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  protected cv(a: Applicant) {
    this.api.downloadCv(a.id, a.cvFileName ?? 'CV').subscribe({ error: (e) => this.error.set(errorMessage(e)) });
  }
}
