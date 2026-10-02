import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Auth } from './core/auth';
import { Unread } from './core/stores';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
})
export class App {
  protected readonly auth = inject(Auth);
  protected readonly unread = inject(Unread);
  private readonly router = inject(Router);
  protected readonly menuOpen = signal(false);

  protected logout() {
    this.auth.logout();
    this.menuOpen.set(false);
    this.router.navigateByUrl('/');
  }
}
