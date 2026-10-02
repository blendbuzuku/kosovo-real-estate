import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  AdminStats,
  AgencyProfile,
  AuthResponse,
  City,
  Conversation,
  ListingDetail,
  ListingStatus,
  ListingSummary,
  ListingUpsert,
  MapPin,
  Message,
  Paged,
  Photo,
  Problem,
  Report,
  ReportReason,
  SavedSearch,
  SearchCriteria,
  User,
  UserRole,
} from './models';

/** Drops empty values so the query string only carries filters that are set. */
export function toParams(values: object): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === '') continue;
    params = params.set(key, String(value));
  }
  return params;
}

/** Turns an API error into one readable sentence. */
export function errorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const p = err.error as Problem | null;
    if (p?.errors) return Object.values(p.errors).flat().join(' ');
    if (p?.detail) return p.detail;
    if (p?.title) return p.title;
    if (err.status === 0) return 'Can’t reach the server. Check your connection.';
    if (err.status === 429) return 'Too many requests. Please wait a bit and try again.';
  }
  return 'Something went wrong. Please try again.';
}

@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);

  // Accounts
  register(body: {
    email: string;
    password: string;
    displayName: string;
    phone?: string | null;
    role: UserRole;
    agencyName?: string | null;
  }) {
    return this.http.post<AuthResponse>('/api/auth/register', body);
  }
  login(email: string, password: string) {
    return this.http.post<AuthResponse>('/api/auth/login', { email, password });
  }
  me() {
    return this.http.get<User>('/api/auth/me');
  }
  updateMe(body: { displayName: string; phone?: string | null }) {
    return this.http.put<User>('/api/auth/me', body);
  }
  updateMyAgency(body: { name: string; description?: string | null; website?: string | null; city?: string | null }) {
    return this.http.put<AgencyProfile>('/api/me/agency', body);
  }

  // Listings
  search(criteria: SearchCriteria, page = 1, pageSize = 20) {
    return this.http.get<Paged<ListingSummary>>('/api/listings', {
      params: toParams({ ...criteria, page, pageSize }),
    });
  }
  mapPins(criteria: SearchCriteria) {
    return this.http.get<MapPin[]>('/api/listings/map', { params: toParams(criteria) });
  }
  listing(id: string) {
    return this.http.get<ListingDetail>(`/api/listings/${id}`);
  }
  phone(id: string) {
    return this.http.get<{ phone: string }>(`/api/listings/${id}/phone`);
  }
  myListings(status?: ListingStatus) {
    return this.http.get<Paged<ListingSummary>>('/api/me/listings', { params: toParams({ status, pageSize: 100 }) });
  }
  createListing(body: ListingUpsert) {
    return this.http.post<ListingDetail>('/api/listings', body);
  }
  updateListing(id: string, body: ListingUpsert) {
    return this.http.put<ListingDetail>(`/api/listings/${id}`, body);
  }
  submitListing(id: string) {
    return this.http.post<ListingDetail>(`/api/listings/${id}/submit`, null);
  }
  renewListing(id: string) {
    return this.http.post<ListingDetail>(`/api/listings/${id}/renew`, null);
  }
  archiveListing(id: string) {
    return this.http.post<ListingDetail>(`/api/listings/${id}/archive`, null);
  }
  deleteListing(id: string) {
    return this.http.delete<void>(`/api/listings/${id}`);
  }
  uploadPhotos(id: string, files: File[]): Observable<Photo[]> {
    const form = new FormData();
    for (const f of files) form.append('files', f, f.name);
    return this.http.post<Photo[]>(`/api/listings/${id}/photos`, form);
  }
  reorderPhotos(id: string, photoIds: string[]) {
    return this.http.put<Photo[]>(`/api/listings/${id}/photos/order`, { photoIds });
  }
  deletePhoto(id: string, photoId: string) {
    return this.http.delete<void>(`/api/listings/${id}/photos/${photoId}`);
  }
  report(id: string, reason: ReportReason, comment?: string | null) {
    return this.http.post<void>(`/api/listings/${id}/reports`, { reason, comment });
  }

  // Favorites & saved searches
  favorites() {
    return this.http.get<ListingSummary[]>('/api/me/favorites');
  }
  favoriteIds() {
    return this.http.get<string[]>('/api/me/favorites/ids');
  }
  addFavorite(id: string) {
    return this.http.put<void>(`/api/me/favorites/${id}`, null);
  }
  removeFavorite(id: string) {
    return this.http.delete<void>(`/api/me/favorites/${id}`);
  }
  savedSearches() {
    return this.http.get<SavedSearch[]>('/api/me/saved-searches');
  }
  saveSearch(name: string, criteria: SearchCriteria, emailAlerts = true) {
    return this.http.post<SavedSearch>('/api/me/saved-searches', { name, criteria, emailAlerts });
  }
  setSearchAlerts(id: string, emailAlerts: boolean) {
    return this.http.patch<SavedSearch>(`/api/me/saved-searches/${id}`, null, { params: toParams({ emailAlerts }) });
  }
  deleteSavedSearch(id: string) {
    return this.http.delete<void>(`/api/me/saved-searches/${id}`);
  }

  // Messaging
  sendFirstMessage(listingId: string, body: string) {
    return this.http.post<Conversation>(`/api/listings/${listingId}/messages`, { body });
  }
  conversations() {
    return this.http.get<Conversation[]>('/api/me/conversations');
  }
  unreadCount() {
    return this.http.get<number>('/api/me/conversations/unread');
  }
  messages(conversationId: string) {
    return this.http.get<Message[]>(`/api/conversations/${conversationId}/messages`);
  }
  reply(conversationId: string, body: string) {
    return this.http.post<Message>(`/api/conversations/${conversationId}/messages`, { body });
  }

  // Agencies & meta
  agencies() {
    return this.http.get<AgencyProfile[]>('/api/agencies');
  }
  agency(slug: string) {
    return this.http.get<AgencyProfile>(`/api/agencies/${slug}`);
  }
  agencyListings(slug: string, page = 1) {
    return this.http.get<Paged<ListingSummary>>(`/api/agencies/${slug}/listings`, { params: toParams({ page }) });
  }
  cities() {
    return this.http.get<City[]>('/api/meta/cities');
  }

  // Admin
  adminStats() {
    return this.http.get<AdminStats>('/api/admin/stats');
  }
  adminListings(status: ListingStatus = 'PendingReview') {
    return this.http.get<Paged<ListingSummary>>('/api/admin/listings', { params: toParams({ status }) });
  }
  approve(id: string) {
    return this.http.post<void>(`/api/admin/listings/${id}/approve`, null);
  }
  reject(id: string, reason: string) {
    return this.http.post<void>(`/api/admin/listings/${id}/reject`, { reason });
  }
  reports() {
    return this.http.get<Report[]>('/api/admin/reports');
  }
  resolveReport(id: string, removeListing: boolean, note?: string | null) {
    return this.http.post<void>(`/api/admin/reports/${id}/resolve`, { removeListing, note });
  }
}
