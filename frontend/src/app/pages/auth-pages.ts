import { Component, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../core/api.service';
import { Auth } from '../core/auth';
import { Catalog } from '../core/catalog';
import { BUSINESS_KINDS, entries } from '../core/labels';
import { BusinessKind } from '../core/models';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <div class="container narrow-page">
      <form class="card auth-card" [formGroup]="form" (ngSubmit)="submit()">
        <h1>Log in</h1>
        @if (expired()) {
          <p class="notice">Your session ended. Log in again to carry on.</p>
        }
        <label class="stack"><span>Email</span><input type="email" formControlName="email" autocomplete="email" /></label>
        <label class="stack">
          <span>Password</span><input type="password" formControlName="password" autocomplete="current-password" />
        </label>
        @if (error()) {
          <p class="error">{{ error() }}</p>
        }
        <button class="btn block" type="submit" [disabled]="form.invalid || busy()">Log in</button>
        <p class="muted">No account yet? <a routerLink="/register" [queryParams]="{ returnUrl: returnUrl() }">Create one</a></p>
      </form>
    </div>
  `,
})
export class LoginPage {
  readonly returnUrl = input<string>('/');
  readonly expired = input<string>();
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  protected submit() {
    const { email, password } = this.form.getRawValue();
    this.busy.set(true);
    this.error.set(null);
    this.auth.login(email, password).subscribe({
      next: () => this.router.navigateByUrl(this.returnUrl() || '/'),
      error: (e) => {
        this.busy.set(false);
        this.error.set(errorMessage(e));
      },
    });
  }
}

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <div class="container narrow-page">
      <form class="card auth-card" [formGroup]="form" (ngSubmit)="submit()">
        <h1>Create your free account</h1>
        <p class="muted">One account to search, save, message and post ads of any kind.</p>
        <fieldset class="role-picker">
          <legend class="sr-only">Account type</legend>
          <label class="role" [class.selected]="form.controls.accountType.value === 'Personal'">
            <input type="radio" formControlName="accountType" value="Personal" />
            <strong>Personal</strong>
            <span class="muted small">Find a home or car, book a stay, or sell your own things.</span>
          </label>
          <label class="role" [class.selected]="form.controls.accountType.value === 'Business'">
            <input type="radio" formControlName="accountType" value="Business" />
            <strong>Business</strong>
            <span class="muted small">Agencies, developers, car dealers, rent-a-car. Get a public page with all your ads.</span>
          </label>
        </fieldset>
        @if (form.controls.accountType.value === 'Business') {
          <label class="stack"><span>Business name</span><input formControlName="businessName" /></label>
          <label class="stack">
            <span>Type of business</span>
            <select formControlName="businessKind">
              @for (k of kinds; track k.value) {
                <option [value]="k.value">{{ k.label }}</option>
              }
            </select>
          </label>
          <label class="stack">
            <span>Municipality</span>
            <select formControlName="municipality">
              <option value="">Choose…</option>
              @for (m of municipalities(); track m.name) {
                <option [value]="m.name">{{ m.name }}</option>
              }
            </select>
          </label>
        }
        <label class="stack"><span>Your name</span><input formControlName="displayName" autocomplete="name" /></label>
        <label class="stack"><span>Email</span><input type="email" formControlName="email" autocomplete="email" /></label>
        <label class="stack">
          <span>Phone (shown only to people who tap “Show phone” on your ads)</span>
          <input type="tel" formControlName="phone" placeholder="+383 4x xxx xxx" autocomplete="tel" />
        </label>
        <label class="stack">
          <span>Password (at least 8 characters)</span>
          <input type="password" formControlName="password" autocomplete="new-password" />
        </label>
        @if (error()) {
          <p class="error">{{ error() }}</p>
        }
        <button class="btn block" type="submit" [disabled]="form.invalid || busy()">Create account</button>
        <p class="muted">Already registered? <a routerLink="/login" [queryParams]="{ returnUrl: returnUrl() }">Log in</a></p>
      </form>
    </div>
  `,
})
export class RegisterPage {
  readonly returnUrl = input<string>('/');
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly catalog = inject(Catalog);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly kinds = entries(BUSINESS_KINDS);
  protected readonly municipalities = computed(() => [...this.catalog.locations()].sort((a, b) => a.name.localeCompare(b.name, 'sq')));

  protected readonly form = inject(FormBuilder).nonNullable.group({
    accountType: ['Personal' as 'Personal' | 'Business'],
    businessName: [''],
    businessKind: ['RealEstateAgency' as BusinessKind],
    municipality: [''],
    displayName: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    phone: [''],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  protected submit() {
    const v = this.form.getRawValue();
    const business = v.accountType === 'Business';
    this.busy.set(true);
    this.error.set(null);
    this.auth
      .register({
        email: v.email,
        password: v.password,
        displayName: v.displayName,
        phone: v.phone || null,
        accountType: v.accountType,
        businessName: business ? v.businessName : null,
        businessKind: business ? v.businessKind : null,
        municipality: business ? v.municipality || null : null,
      })
      .subscribe({
        next: () => this.router.navigateByUrl(business ? '/post' : this.returnUrl() || '/'),
        error: (e) => {
          this.busy.set(false);
          this.error.set(errorMessage(e));
        },
      });
  }
}
