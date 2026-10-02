import { HttpInterceptorFn } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { Api } from './api.service';
import { AuthResponse, User, UserRole } from './models';

const STORAGE_KEY = 'prona.auth';

interface StoredAuth {
  token: string;
  expiresAt: string;
  user: User;
}

function readStored(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredAuth;
    return new Date(stored.expiresAt) > new Date() ? stored : null;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly api = inject(Api);
  private readonly state = signal<StoredAuth | null>(readStored());

  readonly user = computed(() => this.state()?.user ?? null);
  readonly token = computed(() => this.state()?.token ?? null);
  readonly isLoggedIn = computed(() => this.state() !== null);
  readonly isAdmin = computed(() => this.user()?.role === 'Admin');

  login(email: string, password: string): Observable<AuthResponse> {
    return this.api.login(email, password).pipe(tap((r) => this.store(r)));
  }

  register(body: Parameters<Api['register']>[0]): Observable<AuthResponse> {
    return this.api.register(body).pipe(tap((r) => this.store(r)));
  }

  /** Keeps the cached profile in sync after the user edits it. */
  updateUser(user: User) {
    const s = this.state();
    if (s) this.save({ ...s, user });
  }

  logout() {
    this.state.set(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
  }

  hasRole(...roles: UserRole[]) {
    const role = this.user()?.role;
    return !!role && roles.includes(role);
  }

  private store(r: AuthResponse) {
    this.save({ token: r.token, expiresAt: r.expiresAt, user: r.user });
  }

  private save(s: StoredAuth) {
    this.state.set(s);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* storage unavailable: stays logged in for this tab only */
    }
  }
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(Auth);
  const token = auth.token();
  if (token && req.url.startsWith('/api/')) {
    req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
  return next(req).pipe(
    tap({
      error: (err) => {
        if (err?.status === 401 && token) auth.logout();
      },
    }),
  );
};

/** Requires login; optionally a role. Sends the user to /login with a return URL. */
export function requireAuth(...roles: UserRole[]): CanActivateFn {
  return (_route, state) => {
    const auth = inject(Auth);
    const router = inject(Router);
    if (!auth.isLoggedIn()) return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
    if (roles.length && !auth.hasRole(...roles)) return router.createUrlTree(['/']);
    return true;
  };
}
