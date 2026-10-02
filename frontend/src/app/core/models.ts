// Mirrors the API's DTOs (backend/src/RealEstate.Api/Features/**).

export type UserRole = 'Member' | 'Business' | 'Admin';
export type BusinessKind = 'RealEstateAgency' | 'Developer' | 'CarDealer' | 'RentACar' | 'Shop' | 'Company' | 'Other';
export type DealType = 'Sale' | 'RentMonthly' | 'RentNightly' | 'RentDaily' | 'Job';
export type ListingStatus = 'Draft' | 'PendingReview' | 'Active' | 'Rejected' | 'Expired' | 'Archived';
export type SellerType = 'Private' | 'Business';
export type ListingSort = 'Newest' | 'PriceAsc' | 'PriceDesc' | 'PricePerM2Asc' | 'YearDesc' | 'MileageAsc';
export type Vertical = 'property' | 'vehicles' | 'goods' | 'jobs';
export type ReportReason =
  | 'Spam'
  | 'Fraud'
  | 'WrongInformation'
  | 'NoLongerAvailable'
  | 'Duplicate'
  | 'Offensive'
  | 'Other';
export type ReportStatus = 'Open' | 'Dismissed' | 'ListingRemoved';

// ---------- Categories (from /api/meta/categories) ----------

export type FieldType = 'Number' | 'Integer' | 'Year' | 'Select' | 'Boolean' | 'Text';
export type FilterKind = 'None' | 'Range' | 'Min' | 'Exact' | 'Multi' | 'Contains';

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  unit?: string | null;
  required: boolean;
  filter: FilterKind;
  onCard: boolean;
  group: string;
  options?: FieldOption[] | null;
  onlyFor?: DealType[] | null;
  min?: number | null;
  max?: number | null;
  help?: string | null;
}

export interface Category {
  key: string;
  name: string;
  vertical: Vertical;
  icon: string;
  deals: DealType[];
  fields: FieldDef[];
  live: { deal: DealType; count: number }[];
}

export type AttributeValue = string | number | boolean;
export type Attributes = Record<string, AttributeValue>;

// ---------- Locations (from /api/meta/locations) ----------

export interface Place {
  name: string;
  kind: 'neighbourhood' | 'village';
}

export interface Municipality {
  name: string;
  lat: number;
  lng: number;
  places: Place[];
}

// ---------- Accounts ----------

export interface Business {
  id: string;
  slug: string;
  name: string;
  kind: BusinessKind;
  description?: string | null;
  website?: string | null;
  municipality?: string | null;
  address?: string | null;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  phone?: string | null;
  role: UserRole;
  business?: Business | null;
}

export interface AuthResponse {
  token: string;
  expiresAt: string;
  user: User;
}

export interface BusinessProfile extends Business {
  phone?: string | null;
  activeListings: number;
  memberSince: string;
}

// ---------- Listings ----------

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface SearchCriteria {
  vertical?: Vertical | null;
  category?: string | null;
  dealType?: DealType | null;
  municipality?: string | null;
  place?: string | null;
  q?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  seller?: SellerType | null;
  lat?: number | null;
  lng?: number | null;
  radiusKm?: number | null;
  bbox?: string | null;
  sort?: ListingSort | null;
  /** Category field filters keyed like the query string: "rooms.min", "fuel", "parking". */
  f?: Record<string, string> | null;
}

export interface Seller {
  name: string;
  isBusiness: boolean;
  kind?: BusinessKind | null;
  slug?: string | null;
}

export interface ListingSummary {
  id: string;
  category: string;
  dealType: DealType;
  title: string;
  priceEur: number;
  negotiable: boolean;
  pricePerM2?: number | null;
  municipality: string;
  place?: string | null;
  lat: number;
  lng: number;
  thumbnailUrl?: string | null;
  photoCount: number;
  attributes: Attributes;
  seller: Seller;
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
  category: string;
}

export interface Photo {
  id: string;
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
}

export interface ListingOwner {
  id: string;
  displayName: string;
  hasPhone: boolean;
  memberSince: string;
  businessSlug?: string | null;
  businessName?: string | null;
  businessKind?: BusinessKind | null;
}

export interface ListingDetail {
  id: string;
  category: string;
  dealType: DealType;
  title: string;
  description: string;
  priceEur: number;
  negotiable: boolean;
  pricePerM2?: number | null;
  attributes: Attributes;
  municipality: string;
  place?: string | null;
  address?: string | null;
  lat: number;
  lng: number;
  photos: Photo[];
  owner: ListingOwner;
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
  category: string;
  dealType: DealType;
  title: string;
  description: string;
  priceEur: number;
  negotiable: boolean;
  municipality: string;
  place?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  attributes: Attributes;
}

export interface SavedSearch {
  id: string;
  name: string;
  criteria: SearchCriteria;
  emailAlerts: boolean;
  createdAt: string;
}

// ---------- Messaging ----------

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

export interface Booking {
  from: string;
  to: string;
  guests?: number | null;
  units: number;
  totalEur: number;
}

export interface Message {
  id: string;
  senderId: string;
  body: string;
  sentAt: string;
  isMine: boolean;
  readAt?: string | null;
  booking?: Booking | null;
  application?: { id: string; cvFileName?: string | null; status: ApplicationStatus } | null;
}

// ---------- Jobs ----------

export type ApplicationStatus = 'New' | 'Shortlisted' | 'Rejected';

/** An application as the person who applied sees it. */
export interface MyApplication {
  id: string;
  listingId: string;
  listingTitle: string;
  employer: string;
  municipality: string;
  listingStatus: ListingStatus;
  status: ApplicationStatus;
  cvFileName?: string | null;
  conversationId: string;
  createdAt: string;
}

/** An applicant as the employer sees them. */
export interface Applicant {
  id: string;
  applicantId: string;
  name: string;
  email: string;
  phone?: string | null;
  coverLetter: string;
  cvFileName?: string | null;
  status: ApplicationStatus;
  conversationId: string;
  createdAt: string;
}

export interface JobApplicants {
  listingId: string;
  listingTitle: string;
  applicants: Applicant[];
}

// ---------- Moderation ----------

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
  businesses: number;
}

/** RFC 7807 problem details as returned by the API. */
export interface Problem {
  title?: string;
  detail?: string;
  status?: number;
  errors?: Record<string, string[]>;
}
