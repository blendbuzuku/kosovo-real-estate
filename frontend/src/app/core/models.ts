// Mirrors the API's DTOs (backend/src/RealEstate.Api/Features/**/…Dtos.cs).

export type UserRole = 'Seeker' | 'Owner' | 'Agency' | 'Admin';
export type PropertyType = 'Apartment' | 'House' | 'Land' | 'Commercial';
export type DealType = 'Sale' | 'RentMonthly' | 'RentShortTerm';
export type HeatingType =
  | 'None'
  | 'District'
  | 'Central'
  | 'Electric'
  | 'HeatPump'
  | 'AirConditioning'
  | 'Wood'
  | 'Other';
export type ListingStatus = 'Draft' | 'PendingReview' | 'Active' | 'Rejected' | 'Expired' | 'Archived';
export type LegalizationStatus = 'Unknown' | 'Legalized' | 'InProcess' | 'NotLegalized' | 'NotRequired';
export type ListingSort = 'Newest' | 'PriceAsc' | 'PriceDesc' | 'PricePerM2Asc' | 'PricePerM2Desc';
export type ReportReason =
  | 'Spam'
  | 'Fraud'
  | 'WrongInformation'
  | 'NoLongerAvailable'
  | 'Duplicate'
  | 'Offensive'
  | 'Other';
export type ReportStatus = 'Open' | 'Dismissed' | 'ListingRemoved';

export interface Agency {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  website?: string | null;
  city?: string | null;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  phone?: string | null;
  role: UserRole;
  agency?: Agency | null;
}

export interface AuthResponse {
  token: string;
  expiresAt: string;
  user: User;
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface SearchCriteria {
  dealType?: DealType | null;
  propertyType?: PropertyType | null;
  city?: string | null;
  neighborhood?: string | null;
  q?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  minArea?: number | null;
  maxArea?: number | null;
  minRooms?: number | null;
  maxRooms?: number | null;
  minFloor?: number | null;
  maxFloor?: number | null;
  minYearBuilt?: number | null;
  heating?: HeatingType | null;
  hasParking?: boolean | null;
  isFurnished?: boolean | null;
  hasElevator?: boolean | null;
  legalizedOnly?: boolean | null;
  hasCadastreCertificate?: boolean | null;
  hasConstructionPermit?: boolean | null;
  lat?: number | null;
  lng?: number | null;
  radiusKm?: number | null;
  bbox?: string | null;
  sort?: ListingSort;
}

export interface ListingSummary {
  id: string;
  title: string;
  propertyType: PropertyType;
  dealType: DealType;
  priceEur: number;
  areaM2: number;
  pricePerM2?: number | null;
  rooms?: number | null;
  floor?: number | null;
  city: string;
  neighborhood?: string | null;
  lat: number;
  lng: number;
  thumbnailUrl?: string | null;
  photoCount: number;
  legalization: LegalizationStatus;
  hasCadastreCertificate?: boolean | null;
  agencyName?: string | null;
  status: ListingStatus;
  publishedAt?: string | null;
  expiresAt?: string | null;
}

export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  priceEur: number;
  dealType: DealType;
  propertyType: PropertyType;
}

export interface Photo {
  id: string;
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
}

export interface LegalStatus {
  hasConstructionPermit?: boolean | null;
  hasCadastreCertificate?: boolean | null;
  legalization: LegalizationStatus;
  notes?: string | null;
}

export interface ListingDetail {
  id: string;
  title: string;
  description: string;
  propertyType: PropertyType;
  dealType: DealType;
  priceEur: number;
  areaM2: number;
  pricePerM2?: number | null;
  rooms?: number | null;
  bathrooms?: number | null;
  floor?: number | null;
  totalFloors?: number | null;
  yearBuilt?: number | null;
  heating: HeatingType;
  hasParking: boolean;
  isFurnished: boolean;
  hasElevator: boolean;
  hasBalcony: boolean;
  city: string;
  neighborhood?: string | null;
  address?: string | null;
  lat: number;
  lng: number;
  legal: LegalStatus;
  photos: Photo[];
  owner: {
    id: string;
    displayName: string;
    isAgency: boolean;
    agencySlug?: string | null;
    agencyName?: string | null;
    hasPhone: boolean;
  };
  status: ListingStatus;
  moderationNote?: string | null;
  createdAt: string;
  publishedAt?: string | null;
  expiresAt?: string | null;
  canRenew: boolean;
  viewCount: number;
  isFavorite: boolean;
  isMine: boolean;
}

export interface ListingUpsert {
  title: string;
  description: string;
  propertyType: PropertyType;
  dealType: DealType;
  priceEur: number;
  areaM2: number;
  rooms?: number | null;
  bathrooms?: number | null;
  floor?: number | null;
  totalFloors?: number | null;
  yearBuilt?: number | null;
  heating: HeatingType;
  hasParking: boolean;
  isFurnished: boolean;
  hasElevator: boolean;
  hasBalcony: boolean;
  city: string;
  neighborhood?: string | null;
  address?: string | null;
  lat: number;
  lng: number;
  legal: LegalStatus;
}

export interface City {
  name: string;
  lat: number;
  lng: number;
  neighborhoods: string[];
}

export interface SavedSearch {
  id: string;
  name: string;
  criteria: SearchCriteria;
  emailAlerts: boolean;
  createdAt: string;
}

export interface Conversation {
  id: string;
  listingId: string;
  listingTitle: string;
  otherPartyName: string;
  lastMessage?: string | null;
  lastMessageAt: string;
  unreadCount: number;
  iAmOwner: boolean;
}

export interface Message {
  id: string;
  senderId: string;
  body: string;
  sentAt: string;
  isMine: boolean;
  readAt?: string | null;
}

export interface AgencyProfile {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  website?: string | null;
  city?: string | null;
  phone?: string | null;
  activeListings: number;
  memberSince: string;
}

export interface Report {
  id: string;
  listingId: string;
  listingTitle: string;
  listingStatus: ListingStatus;
  reason: ReportReason;
  comment?: string | null;
  reporterEmail: string;
  status: ReportStatus;
  createdAt: string;
  openReportsOnListing: number;
}

export interface AdminStats {
  pendingReview: number;
  active: number;
  openReports: number;
  users: number;
  agencies: number;
}

/** RFC 7807 problem details as returned by the API. */
export interface Problem {
  title?: string;
  detail?: string;
  status?: number;
  errors?: Record<string, string[]>;
}
