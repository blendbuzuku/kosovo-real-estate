import { DatePipe } from '@angular/common';
import { Component, DestroyRef, ElementRef, effect, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../core/api.service';
import { Conversation, Message } from '../core/models';
import { Unread } from '../core/stores';
import { formatEur } from '../core/labels';
import { Icon } from '../shared/icon';

@Component({
  selector: 'app-messages',
  imports: [RouterLink, DatePipe, FormsModule, Icon],
  template: `
    <div class="container">
      <h1>Messages</h1>
      <div class="inbox" [class.has-open]="!!id()">
        <ul class="card conversation-list">
          @for (c of conversations(); track c.id) {
            <li>
              <a [routerLink]="['/messages', c.id]" [class.active]="c.id === id()">
                <div class="row-top">
                  <strong>{{ c.otherPartyName }}</strong>
                  <span class="muted small">{{ c.lastMessageAt | date: 'd MMM, HH:mm' }}</span>
                </div>
                <div class="small">{{ c.iAmOwner ? 'About your ad: ' : '' }}{{ c.listingTitle }}</div>
                <div class="muted small ellipsis">{{ c.lastMessage }}</div>
                @if (c.unreadCount) {
                  <span class="unread">{{ c.unreadCount }}</span>
                }
              </a>
            </li>
          } @empty {
            <li class="muted pad">No conversations yet. Message a seller or request dates from any ad.</li>
          }
        </ul>

        <div class="card thread">
          @if (current(); as c) {
            <div class="thread-head">
              <a class="back link" routerLink="/messages">← All messages</a>
              <strong>{{ c.otherPartyName }}</strong>
              <a class="small" [routerLink]="['/listings', c.listingId]">{{ c.listingTitle }}</a>
            </div>
            <div class="bubbles" #scroller>
              @for (m of messages(); track m.id) {
                <div class="bubble" [class.mine]="m.isMine" [class.booking]="!!m.booking">
                  @if (m.booking; as b) {
                    <div class="booking-card">
                      <strong><app-icon name="calendar" [size]="16" /> Booking request</strong>
                      <span>{{ b.from | date: 'EEE d MMM' }} → {{ b.to | date: 'EEE d MMM y' }}</span>
                      <span>{{ b.units }} {{ b.guests !== null && b.guests !== undefined ? 'nights · ' + b.guests + ' guests' : 'days' }} · {{ eur(b.totalEur) }}</span>
                    </div>
                  }
                  <p>{{ m.booking ? stripSummary(m.body) : m.body }}</p>
                  @if (m.application; as app) {
                    <div class="message-application">
                      <app-icon name="briefcase" [size]="16" /> Job application
                      @if (app.cvFileName) {
                        · <button type="button" (click)="cv(app.id, app.cvFileName)">{{ app.cvFileName }}</button>
                      }
                      @if (!m.isMine) {
                        · <a [routerLink]="['/my-ads', c.listingId, 'applicants']">All applicants</a>
                      }
                    </div>
                  }
                  <span class="small muted">{{ m.sentAt | date: 'd MMM, HH:mm' }}</span>
                </div>
              }
            </div>
            <form class="composer" (ngSubmit)="send()">
              <textarea name="body" rows="2" [(ngModel)]="draft" maxlength="4000" placeholder="Write a message…"
                (keydown.enter)="onEnter($event)"></textarea>
              <button class="btn" type="submit" [disabled]="!draft.trim()">Send</button>
            </form>
            @if (error()) {
              <p class="error">{{ error() }}</p>
            }
          } @else {
            <p class="muted pad">Choose a conversation.</p>
          }
        </div>
      </div>
    </div>
  `,
})
export class MessagesPage {
  readonly id = input<string>();
  private readonly api = inject(Api);
  private readonly unread = inject(Unread);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  protected readonly conversations = signal<Conversation[]>([]);
  protected readonly messages = signal<Message[]>([]);
  protected readonly current = signal<Conversation | null>(null);
  protected readonly error = signal<string | null>(null);
  protected draft = '';

  constructor() {
    effect(() => {
      const id = this.id();
      this.loadConversations(id);
      this.messages.set([]);
      if (id) this.loadMessages(id);
    });
    effect(() => {
      this.messages();
      const el = this.scroller()?.nativeElement;
      if (el) setTimeout(() => (el.scrollTop = el.scrollHeight));
    });
    // Pick up replies while the page is open.
    const timer = setInterval(() => this.poll(), 15_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  private poll() {
    if (document.hidden) return;
    const id = this.id();
    this.api.conversations().subscribe((list) => {
      const before = this.conversations().find((c) => c.id === id)?.lastMessageAt;
      this.conversations.set(list);
      const now = list.find((c) => c.id === id);
      if (id && now && now.lastMessageAt !== before) this.loadMessages(id);
    });
  }

  protected eur(n: number) {
    return formatEur(n);
  }

  /** The first line of a booking message repeats the card above it. */
  protected cv(id: string, fileName: string) {
    this.api.downloadCv(id, fileName).subscribe({ error: (e) => this.error.set(errorMessage(e)) });
  }

  protected stripSummary(body: string) {
    return body.replace(/^Booking request:[^\n]*\n*/, '');
  }

  protected onEnter(event: Event) {
    const e = event as KeyboardEvent;
    if (!e.shiftKey) {
      e.preventDefault();
      this.send();
    }
  }

  protected send() {
    const id = this.id();
    const body = this.draft.trim();
    if (!id || !body) return;
    this.api.reply(id, body).subscribe({
      next: (m) => {
        this.messages.set([...this.messages(), m]);
        this.draft = '';
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  private loadConversations(selectedId?: string) {
    this.api.conversations().subscribe((list) => {
      this.conversations.set(list);
      this.current.set(list.find((c) => c.id === selectedId) ?? null);
    });
  }

  private loadMessages(id: string) {
    this.api.messages(id).subscribe({
      next: (m) => {
        this.messages.set(m);
        // Opening a conversation marks it read.
        this.unread.refresh();
        this.conversations.set(this.conversations().map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
  }
}
