import { Routes } from '@angular/router';
import { requireAuth } from './core/auth';

export const routes: Routes = [
  {
    path: '',
    title: 'Tregu · Buy, rent and book anything in Kosovo',
    loadComponent: () => import('./pages/home').then((m) => m.HomePage),
  },
  { path: 'search', title: 'Search · Tregu', loadComponent: () => import('./pages/search').then((m) => m.SearchPage) },
  {
    path: 'listings/:id',
    title: 'Ad · Tregu',
    loadComponent: () => import('./pages/listing-detail').then((m) => m.ListingDetailPage),
  },
  { path: 'login', title: 'Log in · Tregu', loadComponent: () => import('./pages/auth-pages').then((m) => m.LoginPage) },
  {
    path: 'register',
    title: 'Create account · Tregu',
    loadComponent: () => import('./pages/auth-pages').then((m) => m.RegisterPage),
  },
  {
    path: 'businesses',
    title: 'Businesses · Tregu',
    loadComponent: () => import('./pages/businesses').then((m) => m.BusinessesPage),
  },
  {
    path: 'businesses/:slug',
    title: 'Business · Tregu',
    loadComponent: () => import('./pages/businesses').then((m) => m.BusinessPage),
  },
  {
    path: 'post',
    title: 'Post an ad · Tregu',
    canActivate: [requireAuth()],
    loadComponent: () => import('./pages/post-wizard').then((m) => m.PostWizardPage),
  },
  {
    path: 'my-ads',
    title: 'My ads · Tregu',
    canActivate: [requireAuth()],
    loadComponent: () => import('./pages/my-pages').then((m) => m.MyListingsPage),
  },
  {
    path: 'my-ads/:id/edit',
    title: 'Edit ad · Tregu',
    canActivate: [requireAuth()],
    loadComponent: () => import('./pages/post-wizard').then((m) => m.PostWizardPage),
  },
  {
    path: 'my-ads/:id/applicants',
    title: 'Applicants · Tregu',
    canActivate: [requireAuth()],
    loadComponent: () => import('./pages/jobs').then((m) => m.ApplicantsPage),
  },
  {
    path: 'my-applications',
    title: 'My applications · Tregu',
    canActivate: [requireAuth()],
    loadComponent: () => import('./pages/jobs').then((m) => m.MyApplicationsPage),
  },
  {
    path: 'favorites',
    title: 'Favorites · Tregu',
    canActivate: [requireAuth()],
    loadComponent: () => import('./pages/my-pages').then((m) => m.FavoritesPage),
  },
  {
    path: 'saved-searches',
    title: 'Saved searches · Tregu',
    canActivate: [requireAuth()],
    loadComponent: () => import('./pages/my-pages').then((m) => m.SavedSearchesPage),
  },
  {
    path: 'messages',
    title: 'Messages · Tregu',
    canActivate: [requireAuth()],
    loadComponent: () => import('./pages/messages').then((m) => m.MessagesPage),
  },
  {
    path: 'messages/:id',
    title: 'Messages · Tregu',
    canActivate: [requireAuth()],
    loadComponent: () => import('./pages/messages').then((m) => m.MessagesPage),
  },
  {
    path: 'profile',
    title: 'Profile · Tregu',
    canActivate: [requireAuth()],
    loadComponent: () => import('./pages/my-pages').then((m) => m.ProfilePage),
  },
  {
    path: 'admin',
    title: 'Moderation · Tregu',
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
