import { Routes } from '@angular/router';
import { requireAuth } from './core/auth';

export const routes: Routes = [
  { path: '', title: 'Prona · Homes in Kosovo', loadComponent: () => import('./pages/search').then((m) => m.SearchPage) },
  {
    path: 'listings/:id',
    title: 'Listing · Prona',
    loadComponent: () => import('./pages/listing-detail').then((m) => m.ListingDetailPage),
  },
  { path: 'login', title: 'Log in · Prona', loadComponent: () => import('./pages/auth-pages').then((m) => m.LoginPage) },
  {
    path: 'register',
    title: 'Create account · Prona',
    loadComponent: () => import('./pages/auth-pages').then((m) => m.RegisterPage),
  },
  { path: 'agencies', title: 'Agencies · Prona', loadComponent: () => import('./pages/agency').then((m) => m.AgenciesPage) },
  { path: 'agencies/:slug', title: 'Agency · Prona', loadComponent: () => import('./pages/agency').then((m) => m.AgencyPage) },
  {
    path: 'my-listings',
    title: 'My listings · Prona',
    canActivate: [requireAuth('Owner', 'Agency', 'Admin')],
    loadComponent: () => import('./pages/my-pages').then((m) => m.MyListingsPage),
  },
  {
    path: 'my-listings/new',
    title: 'Post a property · Prona',
    canActivate: [requireAuth('Owner', 'Agency', 'Admin')],
    loadComponent: () => import('./pages/listing-editor').then((m) => m.ListingEditorPage),
  },
  {
    path: 'my-listings/:id/edit',
    title: 'Edit listing · Prona',
    canActivate: [requireAuth('Owner', 'Agency', 'Admin')],
    loadComponent: () => import('./pages/listing-editor').then((m) => m.ListingEditorPage),
  },
  {
    path: 'favorites',
    title: 'Favorites · Prona',
    canActivate: [requireAuth()],
    loadComponent: () => import('./pages/my-pages').then((m) => m.FavoritesPage),
  },
  {
    path: 'saved-searches',
    title: 'Saved searches · Prona',
    canActivate: [requireAuth()],
    loadComponent: () => import('./pages/my-pages').then((m) => m.SavedSearchesPage),
  },
  {
    path: 'messages',
    title: 'Messages · Prona',
    canActivate: [requireAuth()],
    loadComponent: () => import('./pages/messages').then((m) => m.MessagesPage),
  },
  {
    path: 'messages/:id',
    title: 'Messages · Prona',
    canActivate: [requireAuth()],
    loadComponent: () => import('./pages/messages').then((m) => m.MessagesPage),
  },
  {
    path: 'profile',
    title: 'Profile · Prona',
    canActivate: [requireAuth()],
    loadComponent: () => import('./pages/my-pages').then((m) => m.ProfilePage),
  },
  {
    path: 'admin',
    title: 'Moderation · Prona',
    canActivate: [requireAuth('Admin')],
    loadComponent: () => import('./pages/admin').then((m) => m.AdminPage),
  },
  { path: '**', redirectTo: '' },
];
