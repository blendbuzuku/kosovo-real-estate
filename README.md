# Prona: real estate listings for Kosovo

A listings marketplace where private owners and agencies post apartments, houses, land and commercial space for sale or rent, and people search, save and contact them.

What sets it apart from existing portals is the **legal status** on every listing: whether the building is legalized, whether there is a cadastre certificate (*certifikata e pronësisë*) and a construction permit (*leje ndërtimi*). Buyers can filter on it.

## What's in the MVP

| Area | Features |
| --- | --- |
| Listings | Apartment / house / land / commercial; sale, monthly rent or short-term rent. Price in EUR, m², €/m², rooms, bathrooms, floor, year built, heating (incl. district heating), parking, furnished, elevator, balcony, city + neighbourhood, map pin, photos, description, legal status. |
| Search | Filters on all of the above, sort by newest / price / €/m², map view with price pins, radius search (`lat`, `lng`, `radiusKm`) and map-viewport search (`bbox`) on PostGIS. Filters live in the URL so searches can be shared. |
| Accounts | Seeker, private owner, agency (with a public profile page listing all its listings), admin. JWT auth. |
| Contact | In-app messaging with unread counts and email notifications, "show phone number" (rate limited and counted), favorites, saved searches that email new matches. |
| Trust | Every listing is reviewed by an admin before going live, edits to a live listing send it back to review, "report listing" with an admin takedown flow, listings expire after 60 days with a reminder email and can be renewed in the last week. |

## Stack

- **Backend:** ASP.NET Core 10 Web API, EF Core 10, PostgreSQL 16 + PostGIS (NetTopologySuite, `geography` column with a GiST index), ImageSharp for photo resizing, MailKit for SMTP, built-in rate limiting.
- **Frontend:** Angular 22 (standalone components, signals, zoneless), Leaflet + OpenStreetMap, responsive down to phone width.
- **Photos:** local disk in development, any S3-compatible store in production (AWS S3, Cloudflare R2, MinIO). Each upload becomes a 1600 px large image and a 480×360 thumbnail, with EXIF (including GPS) stripped.

```
backend/
  src/RealEstate.Api/
    Domain/          entities, enums, listing lifecycle rules
    Data/            DbContext, migrations, demo seed
    Features/        one folder per area: Listings, Accounts, Favorites, SavedSearches, Messaging, Moderation, Meta
    Infrastructure/  JWT, photo storage + processing, email
  tests/RealEstate.Api.Tests/   integration tests against a real PostGIS database
frontend/
  src/app/core/      API client, auth, models, labels
  src/app/shared/    listing card, map
  src/app/pages/     search, listing detail, editor, my listings, favorites, alerts, messages, agencies, admin
```

## Running it locally

Prerequisites: .NET 10 SDK, Node 22.22+ or 24, Docker (or a local PostgreSQL 16 with PostGIS).

```bash
docker compose up -d                      # PostGIS on localhost:5433 (5433 so it doesn't clash with a local PostgreSQL)

cd backend/src/RealEstate.Api
dotnet run                                # http://localhost:5102, API docs at /scalar

cd frontend
npm install
npm start                                 # http://localhost:4200, proxies /api and /media to the backend
```

In Development the API migrates the database on startup and seeds demo data:

| Account | Email | Password |
| --- | --- | --- |
| Admin | admin@demo.local | Admin1234! |
| Agency | agency@demo.local | Demo1234! |
| Owner | owner@demo.local | Demo1234! |
| Seeker | seeker@demo.local | Demo1234! |

## Tests

```bash
cd backend && dotnet test                  # needs PostGIS; set TEST_DATABASE_URL to use another server
cd frontend && npx ng test --watch=false
```

The backend tests spin up the real API in memory against a throwaway database per test class and cover the full listing lifecycle (draft, photos, review, approval, edit re-review, expiry and renewal), search filters including radius and bounding-box queries and €/m² sorting, the legal-status filter, messaging and its access rules, favorites, reporting and takedown, and saved-search email alerts.

## Configuration

| Key | Purpose |
| --- | --- |
| `ConnectionStrings:Default` | PostgreSQL connection string |
| `Jwt:SigningKey` | At least 32 characters; required |
| `Admin:Email`, `Admin:Password` | Admin account created on startup if missing |
| `Storage:Provider` | `Local` or `S3`; with S3 also `S3Bucket`, `S3ServiceUrl`, `S3AccessKey`, `S3SecretKey`, `PublicBaseUrl` |
| `Email:SmtpHost` (+ `SmtpPort`, `SmtpUser`, `SmtpPassword`, `From`) | Without a host, emails are written to the log |
| `Email:AppBaseUrl` | Public URL of the web app, used in email links |
| `Cors:Origins` | Allowed frontend origins |
| `Database:MigrateOnStartup`, `Database:SeedDemoData` | On in Development only |
| `Maintenance:IntervalMinutes` | How often expiry, reminders and saved-search alerts run (default 15) |

## Next steps

Paid "featured" listings for agencies, price history, viewing bookings, a mortgage calculator, and an Albanian / English / German UI for diaspora buyers.
