using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using RealEstate.Api.Domain;
using RealEstate.Api.Features.Listings;
using RealEstate.Api.Features.Meta;

namespace RealEstate.Api.Data;

public static class Seeder
{
    public const string DemoPassword = "Demo1234!";

    /// <summary>Creates the admin account from configuration (Admin:Email / Admin:Password) if it doesn't exist.</summary>
    public static async Task EnsureAdminAsync(AppDbContext db, IConfiguration config, IPasswordHasher<User> hasher)
    {
        var email = config["Admin:Email"]?.Trim().ToLowerInvariant();
        var password = config["Admin:Password"];
        if (string.IsNullOrEmpty(email) || string.IsNullOrEmpty(password)) return;
        if (await db.Users.AnyAsync(u => u.Email == email)) return;

        var admin = new User { Email = email, DisplayName = "Admin", Role = UserRole.Admin };
        admin.PasswordHash = hasher.HashPassword(admin, password);
        db.Users.Add(admin);
        await db.SaveChangesAsync();
    }

    /// <summary>Demo accounts and listings for local development. Runs only on an empty listings table.</summary>
    public static async Task SeedDemoDataAsync(AppDbContext db, IPasswordHasher<User> hasher, TimeProvider clock)
    {
        if (await db.Listings.AnyAsync()) return;
        var now = clock.GetUtcNow();

        User NewUser(string email, string name, UserRole role, string? phone)
        {
            var u = new User { Email = email, DisplayName = name, Role = role, Phone = phone, CreatedAt = now.AddMonths(-6) };
            u.PasswordHash = hasher.HashPassword(u, DemoPassword);
            return u;
        }

        var owner = NewUser("owner@demo.local", "Arben Krasniqi", UserRole.Owner, "+383 44 123 456");
        var agencyUser = NewUser("agency@demo.local", "Dardania Estate", UserRole.Agency, "+383 49 555 010");
        agencyUser.Agency = new Agency
        {
            Name = "Dardania Estate",
            Slug = "dardania-estate",
            City = "Prishtinë",
            Description = "Apartments and houses across Prishtinë and Fushë Kosovë since 2012. Every listing comes with its cadastre paperwork checked.",
            Website = "https://example.com"
        };
        var seeker = NewUser("seeker@demo.local", "Drita Berisha", UserRole.Seeker, null);
        db.Users.AddRange(owner, agencyUser, seeker);

        var rnd = new Random(42);
        var titles = new Dictionary<(PropertyType, DealType), string[]>
        {
            [(PropertyType.Apartment, DealType.Sale)] = ["Bright {0}-room apartment", "Renovated {0}-room flat with balcony", "New-build {0}-room apartment"],
            [(PropertyType.Apartment, DealType.RentMonthly)] = ["Furnished {0}-room apartment for rent", "{0}-room flat near the centre"],
            [(PropertyType.Apartment, DealType.RentShortTerm)] = ["Cosy studio for short stays", "{0}-room apartment for diaspora summer visits"],
            [(PropertyType.House, DealType.Sale)] = ["Family house with garden", "Two-storey house with {0} rooms", "House with yard and garage"],
            [(PropertyType.House, DealType.RentMonthly)] = ["House for rent with garden"],
            [(PropertyType.Land, DealType.Sale)] = ["Building plot with permit potential", "Agricultural land near the road"],
            [(PropertyType.Commercial, DealType.RentMonthly)] = ["Ground-floor shop on a busy street", "Office space in the centre"],
            [(PropertyType.Commercial, DealType.Sale)] = ["Commercial space for sale"]
        };
        var combos = titles.Keys.ToArray();
        var cities = KosovoLocations.Cities.Take(8).ToArray();

        for (var i = 0; i < 36; i++)
        {
            var (type, deal) = i < 14 ? (PropertyType.Apartment, i % 3 == 0 ? DealType.RentMonthly : DealType.Sale) : combos[rnd.Next(combos.Length)];
            var city = i < 18 ? cities[0] : cities[rnd.Next(cities.Length)];
            var neighborhood = city.Neighborhoods[rnd.Next(city.Neighborhoods.Count)];
            var rooms = type is PropertyType.Land ? (int?)null : rnd.Next(1, type == PropertyType.House ? 7 : 5);
            var area = type switch
            {
                PropertyType.Land => rnd.Next(300, 3000),
                PropertyType.House => rnd.Next(120, 350),
                PropertyType.Commercial => rnd.Next(40, 400),
                _ => 30 + (rooms ?? 1) * rnd.Next(18, 28)
            };
            var perM2 = city.Name == "Prishtinë" ? rnd.Next(1100, 2100) : rnd.Next(550, 1200);
            if (type == PropertyType.Land) perM2 = rnd.Next(25, 150);
            var price = deal switch
            {
                DealType.Sale => Math.Round(area * perM2 / 1000m) * 1000,
                DealType.RentMonthly => Math.Round(area * (city.Name == "Prishtinë" ? 6.5m : 4m) / 10) * 10,
                _ => rnd.Next(30, 80)
            };
            var template = titles[(type, deal)][rnd.Next(titles[(type, deal)].Length)];
            var legalization = (LegalizationStatus)rnd.Next(0, 5);
            var published = now.AddDays(-rnd.Next(0, 50)).AddHours(-rnd.Next(0, 24));

            var listing = new Listing
            {
                Owner = i % 2 == 0 ? agencyUser : owner,
                Title = string.Format(template, rooms ?? 1) + $" in {neighborhood}, {city.Name}",
                Description = $"{string.Format(template, rooms ?? 1)} located in {neighborhood}, {city.Name}. " +
                              "Close to schools, shops and public transport. Viewings can be arranged on short notice. " +
                              "Documents are available on request.",
                PropertyType = type,
                DealType = deal,
                PriceEur = price,
                AreaM2 = area,
                Rooms = rooms,
                Bathrooms = rooms is null ? null : Math.Max(1, rooms.Value / 2),
                Floor = type == PropertyType.Apartment ? rnd.Next(0, 12) : null,
                TotalFloors = type == PropertyType.Apartment ? 12 : type == PropertyType.House ? 2 : null,
                YearBuilt = type == PropertyType.Land ? null : rnd.Next(1975, 2026),
                Heating = type == PropertyType.Land ? HeatingType.None : (HeatingType)rnd.Next(1, 7),
                HasParking = rnd.Next(2) == 0,
                IsFurnished = deal != DealType.Sale && rnd.Next(3) > 0,
                HasElevator = type == PropertyType.Apartment && rnd.Next(4) > 0,
                HasBalcony = type is PropertyType.Apartment or PropertyType.House && rnd.Next(3) > 0,
                City = city.Name,
                Neighborhood = neighborhood,
                Location = ListingQuery.PointAt(city.Lat + (rnd.NextDouble() - 0.5) * 0.03, city.Lng + (rnd.NextDouble() - 0.5) * 0.04),
                Legal = new LegalStatus
                {
                    HasConstructionPermit = type == PropertyType.Land ? null : rnd.Next(4) > 0,
                    HasCadastreCertificate = rnd.Next(5) > 0,
                    Legalization = legalization
                },
                Status = ListingStatus.Active,
                CreatedAt = published.AddDays(-1),
                UpdatedAt = published,
                SubmittedAt = published.AddDays(-1),
                PublishedAt = published,
                ExpiresAt = published + Listing.Lifetime,
                ViewCount = rnd.Next(5, 400)
            };
            db.Listings.Add(listing);
        }

        await db.SaveChangesAsync();
    }
}
