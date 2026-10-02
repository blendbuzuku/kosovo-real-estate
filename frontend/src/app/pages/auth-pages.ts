import { Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../core/api.service';
import { Auth } from '../core/auth';
import { UserRole } from '../core/models';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <div class="container narrow-page">
      <form class="card auth-card" [formGroup]="form" (ngSubmit)="submit()">
        <h1>Log in</h1>
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
        <h1>Create an account</h1>
        <fieldset class="role-picker">
          <legend>I want to…</legend>
          @for (r of roles; track r.value) {
            <label class="role" [class.selected]="form.controls.role.value === r.value">
              <input type="radio" formControlName="role" [value]="r.value" />
              <strong>{{ r.title }}</strong>
              <span class="muted small">{{ r.text }}</span>
            </label>
          }
        </fieldset>
        @if (form.controls.role.value === 'Agency') {
          <label class="stack"><span>Agency name</span><input formControlName="agencyName" /></label>
        }
        <label class="stack"><span>Your name</span><input formControlName="displayName" autocomplete="name" /></label>
        <label class="stack"><span>Email</span><input type="email" formControlName="email" autocomplete="email" /></label>
        <label class="stack">
          <span>Phone {{ form.controls.role.value === 'Seeker' ? '(optional)' : '(shown to people who ask for it)' }}</span>
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
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly roles: { value: UserRole; title: string; text: string }[] = [
    { value: 'Seeker', title: 'Find a place', text: 'Save favourites, get alerts and message owners.' },
    { value: 'Owner', title: 'Sell or rent my property', text: 'Post your own apartment, house or land.' },
    { value: 'Agency', title: 'List as an agency', text: 'A profile page with all your listings.' },
  ];

  protected readonly form = inject(FormBuilder).nonNullable.group({
    role: ['Seeker' as UserRole],
    agencyName: [''],
    displayName: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    phone: [''],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  protected submit() {
    const v = this.form.getRawValue();
    this.busy.set(true);
    this.error.set(null);
    this.auth
      .register({
        ...v,
        phone: v.phone || null,
        agencyName: v.role === 'Agency' ? v.agencyName : null,
      })
      .subscribe({
        next: () => this.router.navigateByUrl(v.role === 'Seeker' ? this.returnUrl() || '/' : '/my-listings/new'),
        error: (e) => {
          this.busy.set(false);
          this.error.set(errorMessage(e));
        },
      });
  }
}
