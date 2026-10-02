import { Routes } from '@angular/router';
import { requireAuth } from './core/auth';

export const routes: Routes = [
  {
    path: '',
    title: 'Prona · Buy, rent and book anything in Kosovo',
    loadComponent: () => import('./pages/home').then((m) => m.HomePage),
  },
  { path: 'search', title: 'Search · Prona', loadComponent: () => import('./pages/search').then((m) => m.SearchPage) },
  {
    path: 'listings/:id',
    title: 'Ad · Prona',
    loadComponent: () => import('./pages/listing-detail').then((m) => m.ListingDetailPage),
  },
  { path: 'login', title: 'Log in · Prona', loadComponent: () => import('./pages/auth-pages').then((m) => m.LoginPage) },
  {
    path: 'register',
    title: 'Create account · Prona',
    loadComponent: () => import('./pages/auth-pages').then((m) => m.RegisterPage),
  },
  {
    path: 'businesses',
    title: 'Businesses · Prona',
    loadComponent: () => import('./pages/businesses').then((m) => m.BusinessesPage),
  },
  {
    path: 'businesses/:slug',
    title: 'Business · Prona',
    loadComponent: () => import('./pages/businesses').then((m) => m.BusinessPage),
  },
  {
    path: 'post',
    title: 'Post an ad · Prona',
    canActivate: [requireAuth()],
    loadComponent: () => import('./pages/post-wizard').then((m) => m.PostWizardPage),
  },
  {
    path: 'my-ads',
    title: 'My ads · Prona',
    canActivate: [requireAuth()],
    loadComponent: () => import('./pages/my-pages').then((m) => m.MyListingsPage),
  },
  {
    path: 'my-ads/:id/edit',
    title: 'Edit ad · Prona',
    canActivate: [requireAuth()],
    loadComponent: () => import('./pages/post-wizard').then((m) => m.PostWizardPage),
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
  // Old addresses from the first version.
  { path: 'agencies', redirectTo: 'businesses' },
  { path: 'agencies/:slug', redirectTo: 'businesses/:slug' },
  { path: 'my-listings', redirectTo: 'my-ads' },
  { path: 'my-listings/new', redirectTo: 'post' },
  { path: '**', redirectTo: '' },
];
