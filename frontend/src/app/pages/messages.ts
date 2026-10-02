import { DatePipe } from '@angular/common';
import { Component, ElementRef, effect, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../core/api.service';
import { Conversation, Message } from '../core/models';
import { Unread } from '../core/stores';

@Component({
  selector: 'app-messages',
  imports: [RouterLink, DatePipe, FormsModule],
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
                <div class="small">{{ c.iAmOwner ? 'About your listing: ' : '' }}{{ c.listingTitle }}</div>
                <div class="muted small ellipsis">{{ c.lastMessage }}</div>
                @if (c.unreadCount) {
                  <span class="unread">{{ c.unreadCount }}</span>
                }
              </a>
            </li>
          } @empty {
            <li class="muted pad">No conversations yet. Message an owner from any listing page.</li>
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
                <div class="bubble" [class.mine]="m.isMine">
                  <p>{{ m.body }}</p>
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
