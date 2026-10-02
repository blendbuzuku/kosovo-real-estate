import { Injectable, effect, inject, signal } from '@angular/core';
import { Api } from './api.service';
import { Auth } from './auth';

/** Ids of the user's favourites, so every card can show a filled heart without extra requests. */
@Injectable({ providedIn: 'root' })
export class Favorites {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  readonly ids = signal<ReadonlySet<string>>(new Set());

  constructor() {
    effect(() => {
      if (this.auth.isLoggedIn()) {
        this.api.favoriteIds().subscribe({ next: (ids) => this.ids.set(new Set(ids)), error: () => {} });
      } else {
        this.ids.set(new Set());
      }
    });
  }

  has(id: string) {
    return this.ids().has(id);
  }

  toggle(id: string) {
    const isFav = this.has(id);
    this.update(id, !isFav);
    const call = isFav ? this.api.removeFavorite(id) : this.api.addFavorite(id);
    call.subscribe({ error: () => this.update(id, isFav) });
  }

  private update(id: string, on: boolean) {
    const next = new Set(this.ids());
    if (on) next.add(id);
    else next.delete(id);
    this.ids.set(next);
  }
}

/** Unread message count for the header badge. Refreshed on navigation and every minute. */
@Injectable({ providedIn: 'root' })
export class Unread {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  readonly count = signal(0);

  constructor() {
    effect(() => {
      if (this.auth.isLoggedIn()) this.refresh();
      else this.count.set(0);
    });
    setInterval(() => this.auth.isLoggedIn() && this.refresh(), 60_000);
  }

  refresh() {
    this.api.unreadCount().subscribe({ next: (n) => this.count.set(n), error: () => {} });
  }
}
