using Microsoft.AspNetCore.Identity;
using System.Text.Json;
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

    /// <summary>Demo accounts and ads in every category for local development. Runs only on an empty listings table.</summary>
    public static async Task SeedDemoDataAsync(AppDbContext db, IPasswordHasher<User> hasher, TimeProvider clock)
    {
        if (await db.Listings.AnyAsync()) return;
        var now = clock.GetUtcNow();
        var rnd = new Random(42);

        User NewUser(string email, string name, string? phone, Business? business = null)
        {
            var u = new User
            {
                Email = email, DisplayName = name, Phone = phone, CreatedAt = now.AddMonths(-rnd.Next(3, 30)),
                Role = business is null ? UserRole.Member : UserRole.Business, Business = business
            };
            u.PasswordHash = hasher.HashPassword(u, DemoPassword);
            return u;
        }

        var member = NewUser("owner@demo.local", "Arben Krasniqi", "+383 44 123 456");
        var host = NewUser("host@demo.local", "Vjosa Gashi", "+383 45 777 210");
        var seeker = NewUser("seeker@demo.local", "Drita Berisha", null);
        var agency = NewUser("agency@demo.local", "Dardania Estate", "+383 49 555 010", new Business
        {
            Name = "Dardania Estate", Slug = "dardania-estate", Kind = BusinessKind.RealEstateAgency, Municipality = "Prishtinë",
            Address = "Rr. Agim Ramadani 15",
            Description = "Apartments, houses and land across Prishtinë and Fushë Kosovë since 2012. Every listing comes with its cadastre paperwork checked.",
            Website = "https://example.com"
        });
        var developer = NewUser("developer@demo.local", "Kodra Residence", "+383 44 300 300", new Business
        {
            Name = "Kodra Residence", Slug = "kodra-residence", Kind = BusinessKind.Developer, Municipality = "Prishtinë",
            Description = "New-build residential complexes with permits and bank financing available."
        });
        var dealer = NewUser("dealer@demo.local", "Auto Kosova", "+383 49 222 333", new Business
        {
            Name = "Auto Kosova", Slug = "auto-kosova", Kind = BusinessKind.CarDealer, Municipality = "Ferizaj",
            Address = "Magjistralja Prishtinë–Ferizaj, km 12",
            Description = "Imported cars from Germany and Switzerland, customs cleared, with 6-month warranty."
        });
        var rentACar = NewUser("rentacar@demo.local", "Drive Prishtina Rent a Car", "+383 45 100 200", new Business
        {
            Name = "Drive Prishtina Rent a Car", Slug = "drive-prishtina", Kind = BusinessKind.RentACar, Municipality = "Prishtinë",
            Address = "Prishtina International Airport",
            Description = "Cars from €18 a day with free delivery to the airport. Diaspora discounts in summer."
        });
        var shop = NewUser("shop@demo.local", "TechZone Prishtina", "+383 49 808 808", new Business
        {
            Name = "TechZone Prishtina", Slug = "techzone", Kind = BusinessKind.Shop, Municipality = "Prishtinë",
            Address = "Rr. Nëna Terezë 22",
            Description = "Phones, laptops and home appliances, new and certified refurbished, with warranty and delivery across Kosovo."
        });
        var seller = NewUser("seller@demo.local", "Lirie Hoxha", "+383 44 909 110");
        db.Users.AddRange(member, host, seeker, agency, developer, dealer, rentACar, shop, seller);

        void Add(User owner, string category, DealType deal, string title, string description, decimal price,
                 string municipality, string? place, object attributes, bool negotiable = false)
        {
            var m = Locations.Find(municipality)!;
            if (place is not null) place = Locations.FindPlace(m, place)?.Name ?? throw new InvalidOperationException($"Seed place {place} is not in {municipality}.");
            var input = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(JsonSerializer.Serialize(attributes))!;
            var (json, errors) = AttributeValidator.Normalize(Categories.Find(category)!, deal, input);
            if (errors.Count > 0)
                throw new InvalidOperationException($"Seed ad '{title}' is invalid: {string.Join("; ", errors.SelectMany(e => e.Value))}");

            var published = now.AddDays(-rnd.Next(0, 40)).AddHours(-rnd.Next(0, 24));
            db.Listings.Add(new Listing
            {
                Owner = owner, Category = category, DealType = deal, Title = title, Description = description,
                PriceEur = price, Negotiable = negotiable, Attributes = json,
                Municipality = m.Name, Place = place,
                Location = ListingQuery.PointAt(m.Lat + (rnd.NextDouble() - 0.5) * 0.03, m.Lng + (rnd.NextDouble() - 0.5) * 0.04),
                Status = ListingStatus.Active,
                CreatedAt = published.AddDays(-1), UpdatedAt = published, SubmittedAt = published.AddDays(-1),
                PublishedAt = published, ExpiresAt = published + Listing.Lifetime,
                ViewCount = rnd.Next(5, 400)
            });
        }

        string PlaceIn(string municipality)
        {
            var places = Locations.Find(municipality)!.Places.Where(p => p.Kind == "neighbourhood").ToList();
            return places[rnd.Next(places.Count)].Name;
        }

        string[] legal = ["Legalized", "NotRequired", "NotRequired", "InProcess", "Unknown"];
        string[] heating = ["District", "Central", "Electric", "HeatPump", "AirConditioning"];
        const string Nearby = "Close to schools, shops and public transport. Viewings can be arranged on short notice.";

        // Apartments for sale and monthly rent, mostly in Prishtinë.
        string[] aptCities = ["Prishtinë", "Prishtinë", "Prishtinë", "Prizren", "Pejë", "Ferizaj", "Gjilan", "Fushë Kosovë", "Gjakovë"];
        for (var i = 0; i < 16; i++)
        {
            var city = aptCities[i % aptCities.Length];
            var place = PlaceIn(city);
            var rooms = rnd.Next(1, 5);
            var area = 30 + rooms * rnd.Next(18, 28);
            var sale = i % 3 != 0;
            var newBuild = sale && i % 4 == 1;
            var owner = newBuild ? developer : i % 2 == 0 ? agency : member;
            var perM2 = city == "Prishtinë" ? rnd.Next(1200, 2100) : rnd.Next(650, 1200);
            Add(owner, "apartments", sale ? DealType.Sale : DealType.RentMonthly,
                newBuild ? $"New-build {rooms + 1}-room apartment in {place}" : sale ? $"Bright {rooms + 1}-room apartment in {place}" : $"Furnished {rooms + 1}-room flat for rent in {place}",
                $"{(sale ? "Apartment" : "Flat")} of {area} m² in {place}, {city}. {Nearby}" + (newBuild ? " Keys handed over this year; bank financing available." : ""),
                sale ? Math.Round(area * perM2 / 1000m) * 1000 : Math.Round(area * (city == "Prishtinë" ? 6.5m : 4m) / 10) * 10,
                city, place,
                new Dictionary<string, object?>
                {
                    ["areaM2"] = area, ["rooms"] = rooms + 1, ["bathrooms"] = Math.Max(1, rooms / 2), ["floor"] = rnd.Next(0, 12), ["totalFloors"] = 12,
                    ["yearBuilt"] = newBuild ? now.Year : rnd.Next(1978, 2024), ["heating"] = heating[rnd.Next(heating.Length)],
                    ["furnished"] = !sale || rnd.Next(3) == 0, ["parking"] = rnd.Next(2) == 0, ["elevator"] = rnd.Next(4) > 0, ["balcony"] = rnd.Next(3) > 0,
                    ["depositEur"] = sale ? null : 300,
                    ["legalization"] = sale ? (newBuild ? "NotRequired" : legal[rnd.Next(legal.Length)]) : null,
                    ["hasCadastreCertificate"] = sale ? (newBuild || rnd.Next(5) > 0) : null,
                    ["hasConstructionPermit"] = sale ? (newBuild || rnd.Next(4) > 0) : null
                }, negotiable: sale && rnd.Next(2) == 0);
        }

        // Houses.
        foreach (var (city, deal, price, area, plot) in new[]
                 {
                     ("Prishtinë", DealType.Sale, 265000m, 240, 450), ("Prizren", DealType.Sale, 189000m, 210, 600), ("Pejë", DealType.Sale, 145000m, 180, 800),
                     ("Gjakovë", DealType.RentMonthly, 450m, 160, 300), ("Lipjan", DealType.Sale, 98000m, 150, 1200), ("Fushë Kosovë", DealType.Sale, 155000m, 220, 500)
                 })
        {
            var place = PlaceIn(city);
            Add(deal == DealType.Sale && city == "Prishtinë" ? agency : member, "houses", deal,
                deal == DealType.Sale ? $"Family house with garden in {place}" : $"House for rent with yard in {place}",
                $"Two-storey house of {area} m² on a {plot} m² plot in {place}, {city}. Garage, garden and quiet street. {Nearby}",
                price, city, place,
                new Dictionary<string, object?>
                {
                    ["areaM2"] = area, ["plotAreaM2"] = plot, ["rooms"] = rnd.Next(4, 8), ["bathrooms"] = 2, ["totalFloors"] = 2,
                    ["yearBuilt"] = rnd.Next(1995, 2022), ["heating"] = "Central", ["parking"] = true, ["garden"] = true,
                    ["furnished"] = deal != DealType.Sale,
                    ["depositEur"] = deal == DealType.Sale ? null : 450,
                    ["legalization"] = deal == DealType.Sale ? legal[rnd.Next(legal.Length)] : null,
                    ["hasCadastreCertificate"] = deal == DealType.Sale ? true : null
                }, negotiable: true);
        }

        // Per-night stays: Prishtinë, Prizren old town, Pejë / Rugova, Brezovica.
        foreach (var (city, title, price, guests, beds, pool) in new[]
                 {
                     ("Prishtinë", "Modern studio by the Newborn monument", 35m, 2, 1, false),
                     ("Prishtinë", "Family apartment near Germia park", 55m, 5, 3, false),
                     ("Prizren", "Stone house in the old town under the fortress", 70m, 6, 4, false),
                     ("Prizren", "Apartment with Shadërvan view", 45m, 4, 2, false),
                     ("Pejë", "Cabin at the entrance of Rugova canyon", 60m, 4, 3, false),
                     ("Shtërpcë", "Chalet near the Brezovica ski lifts", 90m, 8, 5, false),
                     ("Gjakovë", "Guesthouse next to the Grand Bazaar", 40m, 3, 2, false),
                     ("Prishtinë", "Villa with pool for summer visits", 150m, 10, 6, true)
                 })
        {
            var place = city == "Shtërpcë" ? null : PlaceIn(city);
            Add(rnd.Next(2) == 0 ? host : member, title.Contains("Villa") || title.Contains("house") || title.Contains("Chalet") || title.Contains("Cabin") ? "houses" : "apartments",
                DealType.RentNightly, title,
                $"{title}. Self check-in, fresh linen and towels, fully equipped kitchen. Free parking on site. Perfect for diaspora visits and weekend trips.",
                price, city, place,
                new Dictionary<string, object?>
                {
                    ["areaM2"] = 30 + guests * 15, ["rooms"] = beds + 1, ["bathrooms"] = Math.Max(1, beds / 2),
                    ["maxGuests"] = guests, ["beds"] = beds, ["minNights"] = guests > 6 ? 2 : 1,
                    ["wifi"] = true, ["airConditioning"] = rnd.Next(3) > 0, ["pool"] = pool, ["parking"] = true, ["furnished"] = true,
                    ["petsAllowed"] = rnd.Next(3) == 0
                });
        }

        // Land.
        foreach (var (city, type, area, perM2) in new[]
                 {
                     ("Prishtinë", "BuildingPlot", 650, 180), ("Fushë Kosovë", "BuildingPlot", 1000, 95), ("Prizren", "Agricultural", 4500, 12),
                     ("Ferizaj", "Industrial", 8000, 40), ("Pejë", "Forest", 12000, 3), ("Gjilan", "BuildingPlot", 800, 60), ("Rahovec", "Agricultural", 9000, 8)
                 })
        {
            var label = type switch { "BuildingPlot" => "Building plot", "Agricultural" => "Agricultural land", "Industrial" => "Industrial land", _ => "Forest land" };
            Add(rnd.Next(2) == 0 ? agency : member, "land", DealType.Sale,
                $"{label}, {area:N0} m² in {city}",
                $"{label} of {area:N0} m² in {city}. Asphalt road to the plot, electricity nearby. Cadastre certificate in the seller's name.",
                Math.Round(area * (decimal)perM2 / 1000m) * 1000, city, null,
                new Dictionary<string, object?>
                {
                    ["areaM2"] = area, ["landType"] = type, ["roadAccess"] = true, ["electricity"] = type != "Forest", ["water"] = type == "BuildingPlot",
                    ["hasCadastreCertificate"] = true, ["hasConstructionPermit"] = type == "BuildingPlot" && rnd.Next(2) == 0
                }, negotiable: true);
        }

        // Commercial.
        foreach (var (city, type, deal, area, price) in new[]
                 {
                     ("Prishtinë", "Shop", DealType.RentMonthly, 85, 1400m), ("Prishtinë", "Office", DealType.RentMonthly, 120, 1300m),
                     ("Ferizaj", "Warehouse", DealType.RentMonthly, 600, 2200m), ("Prizren", "Restaurant", DealType.Sale, 180, 320000m)
                 })
        {
            var place = PlaceIn(city);
            Add(agency, "commercial", deal, $"{type} of {area} m² in {place}, {city}",
                $"{type} space of {area} m² in {place}, {city}. Good visibility, parking in front.",
                price, city, place,
                new Dictionary<string, object?>
                {
                    ["commercialType"] = type, ["areaM2"] = area, ["floor"] = 0, ["parking"] = true,
                    ["depositEur"] = deal == DealType.RentMonthly ? price : null,
                    ["legalization"] = "Legalized", ["hasCadastreCertificate"] = true
                });
        }

        // Cars for sale.
        foreach (var (make, model, year, km, fuel, gearbox, body, hp, price) in new[]
                 {
                     ("Volkswagen", "Golf 7 1.6 TDI", 2016, 168000, "Diesel", "Manual", "Hatchback", 110, 11900m),
                     ("Audi", "A4 2.0 TDI S-line", 2018, 142000, "Diesel", "Automatic", "Sedan", 150, 21500m),
                     ("BMW", "320d Touring", 2017, 185000, "Diesel", "Automatic", "Estate", 190, 17800m),
                     ("Mercedes-Benz", "C 220d AMG Line", 2019, 98000, "Diesel", "Automatic", "Sedan", 194, 28900m),
                     ("Škoda", "Octavia 2.0 TDI", 2020, 120000, "Diesel", "Manual", "Estate", 150, 16900m),
                     ("Toyota", "C-HR Hybrid", 2021, 45000, "Hybrid", "Automatic", "SUV", 122, 23500m),
                     ("Opel", "Astra K 1.4", 2017, 110000, "Petrol", "Manual", "Hatchback", 125, 9800m),
                     ("Tesla", "Model 3 Long Range", 2022, 38000, "Electric", "Automatic", "Sedan", 440, 33500m),
                     ("Dacia", "Duster 1.5 dCi 4x4", 2019, 89000, "Diesel", "Manual", "SUV", 115, 13200m),
                     ("Volkswagen", "Passat B8 2.0 TDI", 2016, 210000, "Diesel", "Automatic", "Estate", 150, 13900m)
                 })
        {
            var byDealer = rnd.Next(3) > 0;
            Add(byDealer ? dealer : member, "cars", DealType.Sale,
                $"{make} {model} {year}",
                $"{make} {model} from {year}, {km:N0} km. {(byDealer ? "Imported from Germany, customs cleared, 6-month warranty. Trade-in possible." : "First owner in Kosovo, regularly serviced. Reason for selling: bought a bigger car.")}",
                price, byDealer ? "Ferizaj" : "Prishtinë", null,
                new Dictionary<string, object?>
                {
                    ["make"] = make, ["model"] = model, ["year"] = year, ["mileageKm"] = km, ["fuel"] = fuel, ["transmission"] = gearbox,
                    ["bodyType"] = body, ["powerHp"] = hp, ["seats"] = 5, ["color"] = new[] { "Black", "White", "Grey", "Silver", "Blue" }[rnd.Next(5)],
                    ["customsCleared"] = true, ["accidentFree"] = rnd.Next(4) > 0, ["serviceHistory"] = byDealer
                }, negotiable: true);
        }

        // Rent a car.
        foreach (var (make, model, year, fuel, gearbox, body, seats, price) in new[]
                 {
                     ("Volkswagen", "Polo", 2021, "Petrol", "Manual", "Hatchback", 5, 18m),
                     ("Škoda", "Octavia", 2022, "Diesel", "Automatic", "Estate", 5, 30m),
                     ("Mercedes-Benz", "E 220d", 2021, "Diesel", "Automatic", "Sedan", 5, 65m),
                     ("Volkswagen", "Tiguan", 2022, "Diesel", "Automatic", "SUV", 5, 45m),
                     ("Mercedes-Benz", "Vito 9-seater", 2020, "Diesel", "Automatic", "Minivan", 9, 70m),
                     ("Renault", "Clio", 2020, "Petrol", "Manual", "Hatchback", 5, 16m)
                 })
        {
            Add(rentACar, "cars", DealType.RentDaily, $"Rent {make} {model} {year} ({gearbox.ToLowerInvariant()})",
                $"{make} {model} for rent from €{price}/day. Full insurance included, free delivery to Prishtina airport, unlimited kilometres.",
                price, "Prishtinë", null,
                new Dictionary<string, object?>
                {
                    ["make"] = make, ["model"] = model, ["year"] = year, ["fuel"] = fuel, ["transmission"] = gearbox, ["bodyType"] = body,
                    ["seats"] = seats, ["customsCleared"] = true, ["depositEur"] = price > 50 ? 500 : 200, ["minDriverAge"] = price > 50 ? 25 : 21,
                    ["unlimitedKm"] = true, ["airportDelivery"] = true, ["withDriver"] = seats > 5
                });
        }

        // Motorcycles and vans.
        Add(member, "motorcycles", DealType.Sale, "Yamaha MT-07 2019", "Yamaha MT-07, 22,000 km, new tyres, always garaged.", 6200m, "Prizren", null,
            new Dictionary<string, object?> { ["make"] = "Yamaha", ["model"] = "MT-07", ["year"] = 2019, ["mileageKm"] = 22000, ["engineCc"] = 689, ["motoType"] = "Naked", ["customsCleared"] = true }, negotiable: true);
        Add(member, "motorcycles", DealType.Sale, "Piaggio Liberty 125 scooter", "City scooter, 9,000 km, ideal for Prishtinë traffic.", 1500m, "Prishtinë", "Ulpiana",
            new Dictionary<string, object?> { ["make"] = "Piaggio", ["model"] = "Liberty 125", ["year"] = 2020, ["mileageKm"] = 9000, ["engineCc"] = 125, ["motoType"] = "Scooter", ["customsCleared"] = true });
        Add(dealer, "vans-trucks", DealType.Sale, "Mercedes-Benz Sprinter 316 CDI box van", "Sprinter with box body and tail lift, ready for work.", 18500m, "Ferizaj", null,
            new Dictionary<string, object?> { ["make"] = "Mercedes-Benz", ["model"] = "Sprinter 316 CDI", ["year"] = 2017, ["mileageKm"] = 240000, ["fuel"] = "Diesel", ["transmission"] = "Manual", ["vanType"] = "Box truck", ["payloadKg"] = 1200, ["seats"] = 3, ["customsCleared"] = true });
        Add(rentACar, "vans-trucks", DealType.RentDaily, "Rent a Ford Transit van for moving", "Ford Transit cargo van for moves and deliveries, by the day.", 45m, "Prishtinë", null,
            new Dictionary<string, object?> { ["make"] = "Ford", ["model"] = "Transit", ["year"] = 2021, ["fuel"] = "Diesel", ["transmission"] = "Manual", ["vanType"] = "Van", ["payloadKg"] = 1100, ["seats"] = 3, ["customsCleared"] = true, ["depositEur"] = 300, ["minDriverAge"] = 23 });

        // Things from around the house: clothes, electronics, furniture and the rest.
        void Item(User owner, string category, string title, string description, decimal price, string municipality, string? place,
                  Dictionary<string, object?> attributes, bool negotiable = false) =>
            Add(owner, category, DealType.Sale, title, description, price, municipality, place, attributes, negotiable);

        Item(seller, "clothing", "Zara wool coat, women's M", "Camel wool-blend coat, worn one winter, dry-cleaned.", 45m, "Prishtinë", "Dardania",
            new() { ["gender"] = "Women", ["clothingType"] = "Jackets & coats", ["size"] = "M", ["condition"] = "LikeNew", ["brand"] = "Zara", ["color"] = "Beige" }, negotiable: true);
        Item(seller, "clothing", "Nike Air Max 90, size 42", "Original Nike Air Max 90, worn a few times, with box.", 70m, "Prishtinë", "Ulpiana",
            new() { ["gender"] = "Men", ["clothingType"] = "Shoes", ["size"] = "42", ["condition"] = "Good", ["brand"] = "Nike", ["color"] = "White", ["delivery"] = true });
        Item(member, "clothing", "Wedding dress with veil, size 38", "Ivory lace wedding dress, worn once, professionally cleaned.", 350m, "Prizren", null,
            new() { ["gender"] = "Women", ["clothingType"] = "Wedding & evening wear", ["size"] = "38", ["condition"] = "LikeNew", ["color"] = "White" }, negotiable: true);
        Item(seller, "clothing", "Kids' winter jackets, 3 pieces, age 6–8", "Three warm jackets, boys, size 122–128. Sold together.", 30m, "Ferizaj", null,
            new() { ["gender"] = "Boys", ["clothingType"] = "Jackets & coats", ["size"] = "122–128", ["condition"] = "Good", ["color"] = "Blue" });
        Item(member, "clothing", "Traditional Albanian xhubleta, handmade", "Handmade xhubleta for festivals and weddings, new.", 280m, "Gjakovë", null,
            new() { ["gender"] = "Women", ["clothingType"] = "Traditional wear", ["size"] = "S", ["condition"] = "New", ["color"] = "Multicolour" });
        Item(seller, "clothing", "Men's suit, navy, 50", "Slim-fit navy suit, jacket and trousers, worn twice.", 60m, "Gjilan", null,
            new() { ["gender"] = "Men", ["clothingType"] = "Suits & formal wear", ["size"] = "50", ["condition"] = "LikeNew", ["color"] = "Blue" });

        Item(shop, "electronics", "iPhone 14 128 GB, refurbished", "Certified refurbished iPhone 14, battery 92%, 12-month warranty.", 520m, "Prishtinë", null,
            new() { ["electronicsType"] = "Mobile phones", ["condition"] = "LikeNew", ["brand"] = "Apple", ["model"] = "iPhone 14", ["storageGb"] = 128, ["warranty"] = true, ["delivery"] = true });
        Item(shop, "electronics", "Samsung Galaxy S24, new in box", "Sealed Samsung Galaxy S24 256 GB, two-year warranty.", 780m, "Prishtinë", null,
            new() { ["electronicsType"] = "Mobile phones", ["condition"] = "New", ["brand"] = "Samsung", ["model"] = "Galaxy S24", ["storageGb"] = 256, ["warranty"] = true, ["delivery"] = true });
        Item(member, "electronics", "Lenovo ThinkPad T14 laptop", "ThinkPad T14, 16 GB RAM, 512 GB SSD, great for students.", 430m, "Pejë", null,
            new() { ["electronicsType"] = "Laptops", ["condition"] = "Good", ["brand"] = "Lenovo", ["model"] = "ThinkPad T14", ["storageGb"] = 512 }, negotiable: true);
        Item(seller, "electronics", "PlayStation 5 with two controllers", "PS5 disc edition, two controllers and three games.", 390m, "Prishtinë", "Kodra e Diellit",
            new() { ["electronicsType"] = "Gaming consoles & games", ["condition"] = "Good", ["brand"] = "Sony", ["model"] = "PlayStation 5", ["storageGb"] = 825 });
        Item(member, "electronics", "LG 55\" 4K smart TV", "LG 55 inch 4K TV with remote and wall bracket.", 260m, "Mitrovicë", null,
            new() { ["electronicsType"] = "TVs", ["condition"] = "Good", ["brand"] = "LG" });

        Item(seller, "furniture", "Corner sofa with bed function", "Grey corner sofa, pulls out into a double bed, with storage.", 220m, "Prishtinë", "Arbëria (Dragodan)",
            new() { ["homeType"] = "Sofas & armchairs", ["condition"] = "Good", ["material"] = "Fabric", ["color"] = "Grey", ["pickupOnly"] = true }, negotiable: true);
        Item(member, "furniture", "Solid oak dining table with 6 chairs", "Handmade oak table, 180 × 90 cm, six chairs.", 450m, "Pejë", null,
            new() { ["homeType"] = "Tables & chairs", ["condition"] = "LikeNew", ["material"] = "Wood", ["color"] = "Brown" });
        Item(seller, "furniture", "Wardrobe with sliding mirror doors", "White wardrobe, 200 cm wide, disassembled and ready to collect.", 120m, "Fushë Kosovë", null,
            new() { ["homeType"] = "Wardrobes & storage", ["condition"] = "Good", ["material"] = "Wood", ["color"] = "White", ["pickupOnly"] = true });
        Item(member, "furniture", "Hand-knotted wool carpet, 2 × 3 m", "Traditional red wool carpet from Gjakova, well kept.", 300m, "Gjakovë", null,
            new() { ["homeType"] = "Carpets & textiles", ["condition"] = "Good", ["material"] = "Fabric", ["color"] = "Red" }, negotiable: true);

        Item(shop, "appliances", "Bosch washing machine 8 kg, new", "Bosch Serie 4, 8 kg, 1400 rpm, delivery and installation included.", 499m, "Prishtinë", null,
            new() { ["applianceType"] = "Washing machines", ["condition"] = "New", ["brand"] = "Bosch", ["energyClass"] = "A+++", ["warranty"] = true, ["delivery"] = true });
        Item(member, "appliances", "Gorenje fridge freezer", "Gorenje combined fridge freezer, 185 cm, works perfectly.", 150m, "Ferizaj", null,
            new() { ["applianceType"] = "Fridges & freezers", ["condition"] = "Good", ["brand"] = "Gorenje", ["energyClass"] = "A+" });
        Item(seller, "appliances", "Wood-burning stove (sobë me dru)", "Cast-iron stove with oven, heats 60 m². Used two winters.", 180m, "Podujevë", null,
            new() { ["applianceType"] = "Heaters & stoves", ["condition"] = "Good" });
        Item(shop, "appliances", "Gree inverter air conditioner 12000 BTU", "Gree inverter split AC, heating and cooling, installation available.", 420m, "Prishtinë", null,
            new() { ["applianceType"] = "Air conditioners", ["condition"] = "New", ["brand"] = "Gree", ["energyClass"] = "A++", ["warranty"] = true, ["delivery"] = true });

        Item(seller, "kids", "Cybex stroller with car seat", "Cybex travel system, stroller plus infant car seat.", 240m, "Prishtinë", "Bregu i Diellit",
            new() { ["kidsType"] = "Prams & strollers", ["ageGroup"] = "0–12 months", ["condition"] = "Good", ["brand"] = "Cybex" }, negotiable: true);
        Item(member, "kids", "LEGO bundle, 4 kg", "Mixed LEGO bricks and three complete City sets.", 55m, "Prizren", null,
            new() { ["kidsType"] = "Toys", ["ageGroup"] = "6–12 years", ["condition"] = "Good", ["brand"] = "LEGO", ["delivery"] = true });

        Item(member, "sports", "Trek mountain bike, size L", "Trek Marlin 5, 29\" wheels, recently serviced.", 380m, "Prishtinë", null,
            new() { ["sportsType"] = "Bicycles & e-bikes", ["condition"] = "Good", ["brand"] = "Trek", ["size"] = "L" });
        Item(seller, "sports", "Ski set for Brezovica, boots 27.5", "Rossignol skis 170 cm with boots and poles.", 150m, "Shtërpcë", null,
            new() { ["sportsType"] = "Ski & snowboard", ["condition"] = "Good", ["brand"] = "Rossignol", ["size"] = "170 cm" });
        Item(member, "sports", "Home gym dumbbells and bench", "Adjustable bench and 2 × 20 kg dumbbells.", 90m, "Gjilan", null,
            new() { ["sportsType"] = "Fitness & gym", ["condition"] = "Good" });

        Item(seller, "hobbies", "Yamaha acoustic guitar with case", "Yamaha F310 acoustic guitar, soft case and tuner.", 110m, "Prishtinë", null,
            new() { ["hobbyType"] = "Musical instruments", ["condition"] = "Good", ["delivery"] = true });
        Item(member, "hobbies", "Ismail Kadare books, 12 volumes", "Twelve Kadare novels in Albanian, good condition.", 40m, "Pejë", null,
            new() { ["hobbyType"] = "Books", ["condition"] = "Good", ["delivery"] = true });

        Item(member, "tools", "Makita cordless drill set", "Makita 18 V drill with two batteries and charger.", 95m, "Ferizaj", null,
            new() { ["toolType"] = "Power tools", ["condition"] = "Good", ["brand"] = "Makita" });
        Item(seller, "tools", "Petrol generator 5.5 kW", "Honda-engine generator, used for power cuts only.", 350m, "Vushtrri", null,
            new() { ["toolType"] = "Generators & compressors", ["condition"] = "LikeNew", ["brand"] = "Honda" }, negotiable: true);

        Item(member, "other-goods", "Coffee machine for a café, 2 groups", "Two-group espresso machine from a closed café, works.", 650m, "Prishtinë", null,
            new() { ["condition"] = "Good", ["brand"] = "La Spaziale" }, negotiable: true);

        await db.SaveChangesAsync();
    }
}
