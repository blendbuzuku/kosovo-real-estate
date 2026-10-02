import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { Auth } from './core/auth';
import { Unread } from './core/stores';
import { Icon } from './shared/icon';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  templateUrl: './app.html',
  host: { '(document:click)': 'onDocumentClick($event)' },
})
export class App {
  protected readonly auth = inject(Auth);
  protected readonly unread = inject(Unread);
  private readonly router = inject(Router);
  protected readonly menuOpen = signal(false);

  constructor() {
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.menuOpen.set(false));
  }

  protected toggleMenu(e: Event) {
    e.stopPropagation();
    this.menuOpen.set(!this.menuOpen());
  }

  protected onDocumentClick(e: Event) {
    if (this.menuOpen() && !(e.target as HTMLElement).closest('.account-menu')) this.menuOpen.set(false);
  }

  protected logout() {
    this.auth.logout();
    this.menuOpen.set(false);
    this.router.navigateByUrl('/');
  }
}
