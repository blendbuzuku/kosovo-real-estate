namespace RealEstate.Api.Domain;

public enum FieldType
{
    Number,
    Integer,
    Year,
    Select,
    Boolean,
    Text
}

/// <summary>How a field shows up in search filters.</summary>
public enum FilterKind
{
    None,
    /// <summary>From / to inputs.</summary>
    Range,
    /// <summary>"At least" input, e.g. 2+ rooms.</summary>
    Min,
    /// <summary>One value, e.g. a yes/no toggle or a single choice.</summary>
    Exact,
    /// <summary>Any of several values, e.g. Diesel or Hybrid.</summary>
    Multi,
    /// <summary>Text contains, e.g. model "Golf".</summary>
    Contains
}

public record FieldOption(string Value, string Label);

public record FieldDef(string Key, string Label, FieldType Type)
{
    public string? Unit { get; init; }
    public bool Required { get; init; }
    public FilterKind Filter { get; init; }
    /// <summary>Shown as a key fact on result cards.</summary>
    public bool OnCard { get; init; }
    public string Group { get; init; } = "Details";
    public IReadOnlyList<FieldOption>? Options { get; init; }
    /// <summary>Only asked for these deal types, e.g. "max guests" only for per-night stays.</summary>
    public IReadOnlyList<DealType>? OnlyFor { get; init; }
    public decimal? Min { get; init; }
    public decimal? Max { get; init; }
    public string? Help { get; init; }

    public bool AppliesTo(DealType deal) => OnlyFor is null || OnlyFor.Contains(deal);
}

public record CategoryDef(
    string Key,
    string Name,
    string Vertical,
    string Icon,
    IReadOnlyList<DealType> Deals,
    IReadOnlyList<FieldDef> Fields)
{
    /// <summary>Property categories get €/m², the legal status panel and a map pin by default.</summary>
    public bool IsProperty => Vertical == Categories.Property;

    /// <summary>Most ads need a photo before review; a job ad can go without one.</summary>
    public bool PhotosRequired { get; init; } = true;

    public FieldDef? Field(string key) => Fields.FirstOrDefault(f => f.Key == key);
}

/// <summary>
/// Every category the site supports and the fields each one asks for. The frontend builds the
/// posting form, the filters and the spec list from this, so adding a category is a change here only.
/// </summary>
public static class Categories
{
    public const string Property = "property";
    public const string Vehicles = "vehicles";
    public const string Goods = "goods";
    public const string Jobs = "jobs";

    private static FieldOption[] Opts(params (string Value, string Label)[] o) => o.Select(x => new FieldOption(x.Value, x.Label)).ToArray();
    private static FieldOption[] Same(params string[] values) => values.Select(v => new FieldOption(v, v)).ToArray();

    private static readonly DealType[] Nightly = [DealType.RentNightly];
    private static readonly DealType[] Monthly = [DealType.RentMonthly];
    private static readonly DealType[] Daily = [DealType.RentDaily];
    private static readonly DealType[] Rentals = [DealType.RentMonthly, DealType.RentNightly];

    // ---------- Property ----------

    private static FieldDef Area(string label = "Living area") =>
        new("areaM2", label, FieldType.Number) { Unit = "m²", Required = true, Filter = FilterKind.Range, OnCard = true, Min = 1, Max = 1_000_000 };

    private static readonly FieldDef Rooms = new("rooms", "Rooms", FieldType.Integer)
        { Filter = FilterKind.Min, OnCard = true, Min = 0, Max = 50, Help = "Bedrooms plus living room, as usually counted in Kosovo (e.g. 2+1 = 3)." };
    private static readonly FieldDef Bathrooms = new("bathrooms", "Bathrooms", FieldType.Integer) { Min = 0, Max = 20, Filter = FilterKind.Min };
    private static readonly FieldDef Floor = new("floor", "Floor", FieldType.Integer) { Filter = FilterKind.Range, OnCard = true, Min = -3, Max = 100, Help = "0 = ground floor" };
    private static readonly FieldDef TotalFloors = new("totalFloors", "Floors in building", FieldType.Integer) { Min = 1, Max = 100 };
    private static readonly FieldDef YearBuilt = new("yearBuilt", "Year built", FieldType.Year) { Filter = FilterKind.Min, Min = 1800, Max = 2100 };

    private static readonly FieldDef Heating = new("heating", "Heating", FieldType.Select)
    {
        Filter = FilterKind.Multi,
        Options = Opts(("District", "District heating (Termokos)"), ("Central", "Central heating"), ("Electric", "Electric"),
            ("HeatPump", "Heat pump"), ("AirConditioning", "Air conditioning"), ("Wood", "Wood / pellet stove"), ("None", "None"), ("Other", "Other"))
    };

    private static FieldDef Feature(string key, string label, IReadOnlyList<DealType>? onlyFor = null) =>
        new(key, label, FieldType.Boolean) { Filter = FilterKind.Exact, Group = "Features", OnlyFor = onlyFor };

    private static readonly FieldDef[] Legal =
    [
        new("legalization", "Building legalization", FieldType.Select)
        {
            Group = "Legal status",
            Filter = FilterKind.Multi,
            Options = Opts(("Legalized", "Legalized"), ("NotRequired", "Built with permit (no legalization needed)"),
                ("InProcess", "Legalization in process"), ("NotLegalized", "Not legalized"), ("Unknown", "Not sure")),
            Help = "Whether the building went through Kosovo's legalization process."
        },
        new("hasCadastreCertificate", "Cadastre certificate (certifikata e pronësisë)", FieldType.Boolean)
            { Group = "Legal status", Filter = FilterKind.Exact, Help = "Ownership certificate from the cadastre, in the seller's name." },
        new("hasConstructionPermit", "Construction permit (leje ndërtimi)", FieldType.Boolean) { Group = "Legal status", Filter = FilterKind.Exact },
        new("legalNotes", "Notes on paperwork", FieldType.Text) { Group = "Legal status" }
    ];

    private static readonly FieldDef[] Stay =
    [
        new("maxGuests", "Guests", FieldType.Integer) { Group = "Stay", Required = true, Filter = FilterKind.Min, OnCard = true, Min = 1, Max = 50, OnlyFor = Nightly },
        new("beds", "Beds", FieldType.Integer) { Group = "Stay", Min = 1, Max = 50, OnlyFor = Nightly, OnCard = true },
        new("minNights", "Minimum nights", FieldType.Integer) { Group = "Stay", Min = 1, Max = 90, OnlyFor = Nightly },
        Feature("wifi", "Wi-Fi", Nightly),
        Feature("airConditioning", "Air conditioning", Nightly),
        Feature("pool", "Pool", Nightly),
        Feature("petsAllowed", "Pets allowed", Rentals)
    ];

    private static readonly FieldDef Deposit = new("depositEur", "Deposit", FieldType.Number) { Unit = "€", Group = "Rental terms", Min = 0, Max = 1_000_000, OnlyFor = [DealType.RentMonthly, DealType.RentDaily] };

    private static readonly CategoryDef Apartment = new("apartments", "Apartments", Property, "apartment",
        [DealType.Sale, DealType.RentMonthly, DealType.RentNightly],
        [
            Area(), Rooms, Bathrooms, Floor, TotalFloors, YearBuilt, Heating,
            Feature("furnished", "Furnished"), Feature("parking", "Parking"), Feature("elevator", "Elevator"), Feature("balcony", "Balcony"),
            .. Stay, Deposit, .. Legal
        ]);

    private static readonly CategoryDef House = new("houses", "Houses & villas", Property, "house",
        [DealType.Sale, DealType.RentMonthly, DealType.RentNightly],
        [
            Area(), new("plotAreaM2", "Plot area", FieldType.Number) { Unit = "m²", Filter = FilterKind.Range, Min = 1, Max = 10_000_000 },
            Rooms, Bathrooms, TotalFloors with { Label = "Floors" }, YearBuilt, Heating,
            Feature("furnished", "Furnished"), Feature("parking", "Parking / garage"), Feature("garden", "Garden"),
            .. Stay, Deposit, .. Legal
        ]);

    private static readonly CategoryDef Land = new("land", "Land", Property, "land",
        [DealType.Sale, DealType.RentMonthly],
        [
            Area("Plot area"),
            new("landType", "Land type", FieldType.Select)
            {
                Required = true, Filter = FilterKind.Multi, OnCard = true,
                Options = Opts(("BuildingPlot", "Building plot"), ("Agricultural", "Agricultural"), ("Forest", "Forest"), ("Industrial", "Industrial / commercial"), ("Other", "Other"))
            },
            Feature("roadAccess", "Road access"), Feature("electricity", "Electricity"), Feature("water", "Water"),
            Legal[1], Legal[2] with { Label = "Building permit / urban conditions" }, Legal[3]
        ]);

    private static readonly CategoryDef Commercial = new("commercial", "Commercial", Property, "store",
        [DealType.Sale, DealType.RentMonthly],
        [
            new("commercialType", "Type", FieldType.Select)
            {
                Required = true, Filter = FilterKind.Multi, OnCard = true,
                Options = Opts(("Shop", "Shop"), ("Office", "Office"), ("Warehouse", "Warehouse"), ("Restaurant", "Restaurant / bar"), ("Hotel", "Hotel"), ("Industrial", "Industrial"), ("Other", "Other"))
            },
            Area("Area"), Floor, YearBuilt, Heating, Feature("parking", "Parking"), Deposit, .. Legal
        ]);

    // ---------- Vehicles ----------

    private static readonly string[] CarMakes =
    [
        "Audi", "BMW", "Mercedes-Benz", "Volkswagen", "Opel", "Škoda", "Seat", "Cupra", "Renault", "Peugeot", "Citroën", "Dacia",
        "Fiat", "Alfa Romeo", "Ford", "Toyota", "Lexus", "Hyundai", "Kia", "Nissan", "Mazda", "Honda", "Mitsubishi", "Suzuki",
        "Subaru", "Volvo", "Land Rover", "Jeep", "Porsche", "Mini", "Tesla", "BYD", "Chevrolet", "Jaguar", "Smart", "Other"
    ];

    private static readonly FieldDef Year = new("year", "Year", FieldType.Year) { Required = true, Filter = FilterKind.Range, OnCard = true, Min = 1950, Max = 2100, Group = "Vehicle" };
    private static readonly FieldDef Mileage = new("mileageKm", "Mileage", FieldType.Number) { Unit = "km", Filter = FilterKind.Range, OnCard = true, Min = 0, Max = 3_000_000, Group = "Vehicle" };
    private static readonly FieldDef Model = new("model", "Model", FieldType.Text) { Required = true, Filter = FilterKind.Contains, Group = "Vehicle" };

    private static readonly FieldDef Fuel = new("fuel", "Fuel", FieldType.Select)
    {
        Required = true, Filter = FilterKind.Multi, OnCard = true, Group = "Vehicle",
        Options = Same("Diesel", "Petrol", "Hybrid", "Plug-in hybrid", "Electric", "LPG")
    };

    private static readonly FieldDef Transmission = new("transmission", "Gearbox", FieldType.Select)
    {
        Filter = FilterKind.Exact, OnCard = true, Group = "Vehicle", Options = Same("Manual", "Automatic")
    };

    private static readonly FieldDef CustomsCleared = new("customsCleared", "Customs cleared (doganuar)", FieldType.Boolean)
        { Filter = FilterKind.Exact, Group = "Vehicle", Help = "Already cleared through Kosovo customs and ready for RKS plates." };

    private static readonly FieldDef[] CarRental =
    [
        Deposit,
        new("minDriverAge", "Minimum driver age", FieldType.Integer) { Group = "Rental terms", Min = 18, Max = 99, OnlyFor = Daily },
        Feature("unlimitedKm", "Unlimited kilometres", Daily) with { Group = "Rental terms" },
        Feature("airportDelivery", "Delivery to Prishtina airport", Daily) with { Group = "Rental terms" },
        Feature("withDriver", "Available with driver", Daily) with { Group = "Rental terms" }
    ];

    private static readonly CategoryDef Cars = new("cars", "Cars", Vehicles, "car",
        [DealType.Sale, DealType.RentDaily],
        [
            new("make", "Make", FieldType.Select) { Required = true, Filter = FilterKind.Multi, Group = "Vehicle", Options = Same(CarMakes) },
            Model, Year, Mileage, Fuel, Transmission,
            new("bodyType", "Body type", FieldType.Select)
            {
                Filter = FilterKind.Multi, Group = "Vehicle",
                Options = Same("Sedan", "Hatchback", "Estate", "SUV", "Coupé", "Convertible", "Minivan", "Pickup")
            },
            new("powerHp", "Power", FieldType.Integer) { Unit = "HP", Filter = FilterKind.Range, Min = 1, Max = 2000, Group = "Vehicle" },
            new("engineCc", "Engine size", FieldType.Integer) { Unit = "cc", Min = 50, Max = 10_000, Group = "Vehicle" },
            new("seats", "Seats", FieldType.Integer) { Filter = FilterKind.Min, Min = 1, Max = 60, Group = "Vehicle" },
            new("color", "Colour", FieldType.Select)
                { Group = "Vehicle", Options = Same("Black", "White", "Grey", "Silver", "Blue", "Red", "Green", "Brown", "Beige", "Yellow", "Other") },
            CustomsCleared,
            Feature("accidentFree", "Accident-free", [DealType.Sale]),
            Feature("serviceHistory", "Full service history", [DealType.Sale]),
            .. CarRental
        ]);

    private static readonly CategoryDef Motorcycles = new("motorcycles", "Motorcycles", Vehicles, "motorcycle",
        [DealType.Sale, DealType.RentDaily],
        [
            new("make", "Make", FieldType.Text) { Required = true, Filter = FilterKind.Contains, Group = "Vehicle" },
            Model with { Required = false }, Year, Mileage,
            new("engineCc", "Engine size", FieldType.Integer) { Unit = "cc", Filter = FilterKind.Range, OnCard = true, Min = 49, Max = 3000, Group = "Vehicle" },
            new("motoType", "Type", FieldType.Select)
                { Filter = FilterKind.Multi, Group = "Vehicle", Options = Same("Scooter", "Naked", "Sport", "Touring", "Enduro / cross", "Chopper", "Other") },
            CustomsCleared, Deposit,
            new("minDriverAge", "Minimum rider age", FieldType.Integer) { Group = "Rental terms", Min = 16, Max = 99, OnlyFor = Daily }
        ]);

    private static readonly CategoryDef Vans = new("vans-trucks", "Vans & trucks", Vehicles, "truck",
        [DealType.Sale, DealType.RentDaily],
        [
            new("make", "Make", FieldType.Select)
            {
                Required = true, Filter = FilterKind.Multi, Group = "Vehicle",
                Options = Same("Mercedes-Benz", "Volkswagen", "Ford", "Renault", "Iveco", "Fiat", "Opel", "Peugeot", "Citroën", "Toyota", "MAN", "DAF", "Scania", "Volvo", "Other")
            },
            Model, Year, Mileage, Fuel, Transmission,
            new("vanType", "Type", FieldType.Select)
                { Filter = FilterKind.Multi, OnCard = true, Group = "Vehicle", Options = Same("Van", "Minibus", "Pickup", "Box truck", "Truck", "Tractor unit", "Other") },
            new("payloadKg", "Payload", FieldType.Integer) { Unit = "kg", Filter = FilterKind.Range, Min = 0, Max = 60_000, Group = "Vehicle" },
            new("seats", "Seats", FieldType.Integer) { Filter = FilterKind.Min, Min = 1, Max = 60, Group = "Vehicle" },
            CustomsCleared, .. CarRental
        ]);


    // ---------- Goods: everything else people sell from home ----------

    private static readonly DealType[] SaleOnly = [DealType.Sale];

    private static readonly FieldDef Condition = new("condition", "Condition", FieldType.Select)
    {
        Required = true, Filter = FilterKind.Multi, OnCard = true, Group = "Item",
        Options = Opts(("New", "New, unused"), ("LikeNew", "Like new"), ("Good", "Used, good"), ("Fair", "Used, visible wear"), ("ForParts", "For parts / not working"))
    };

    private static readonly FieldDef Brand = new("brand", "Brand", FieldType.Text) { Filter = FilterKind.Contains, OnCard = true, Group = "Item" };

    private static readonly FieldDef Delivery = Feature("delivery", "Can deliver or ship within Kosovo") with { Group = "Handover" };
    private static readonly FieldDef Warranty = Feature("warranty", "Still under warranty") with { Group = "Item" };

    private static FieldDef ItemType(string key, string label, params string[] options) =>
        new(key, label, FieldType.Select) { Required = true, Filter = FilterKind.Multi, OnCard = true, Group = "Item", Options = Same(options) };

    private static readonly FieldDef Colour = new("color", "Colour", FieldType.Select)
    {
        Filter = FilterKind.Multi, Group = "Item",
        Options = Same("Black", "White", "Grey", "Blue", "Red", "Green", "Brown", "Beige", "Pink", "Yellow", "Multicolour", "Other")
    };

    private static readonly CategoryDef Clothing = new("clothing", "Clothing & shoes", Goods, "shirt", SaleOnly,
    [
        new("gender", "For", FieldType.Select)
            { Required = true, Filter = FilterKind.Multi, OnCard = true, Group = "Item", Options = Same("Women", "Men", "Girls", "Boys", "Baby", "Unisex") },
        ItemType("clothingType", "Type", "Tops & T-shirts", "Shirts & blouses", "Sweaters & hoodies", "Trousers & jeans", "Dresses & skirts",
            "Jackets & coats", "Suits & formal wear", "Wedding & evening wear", "Traditional wear", "Sportswear", "Shoes", "Bags", "Accessories & jewellery", "Other"),
        new("size", "Size", FieldType.Text) { Filter = FilterKind.Contains, OnCard = true, Group = "Item", Help = "As on the label, e.g. M, 38 or 42." },
        Condition, Brand with { OnCard = false }, Colour, Delivery
    ]);

    private static readonly CategoryDef Electronics = new("electronics", "Phones & electronics", Goods, "smartphone", SaleOnly,
    [
        ItemType("electronicsType", "Type", "Mobile phones", "Tablets", "Laptops", "Desktop computers", "Monitors", "TVs", "Audio & headphones",
            "Cameras", "Gaming consoles & games", "Smartwatches", "Accessories & parts", "Other"),
        Condition, Brand, new("model", "Model", FieldType.Text) { Filter = FilterKind.Contains, Group = "Item" },
        new("storageGb", "Storage", FieldType.Integer) { Unit = "GB", Filter = FilterKind.Min, Min = 1, Max = 100_000, Group = "Item" },
        Warranty, Delivery
    ]);

    private static readonly CategoryDef Furniture = new("furniture", "Furniture & home", Goods, "sofa", SaleOnly,
    [
        ItemType("homeType", "Type", "Sofas & armchairs", "Tables & chairs", "Beds & mattresses", "Wardrobes & storage", "Kitchen & dining",
            "Office furniture", "Lighting", "Carpets & textiles", "Decor", "Garden & balcony", "Other"),
        Condition,
        new("material", "Material", FieldType.Select)
            { Filter = FilterKind.Multi, Group = "Item", Options = Same("Wood", "Metal", "Glass", "Fabric", "Leather", "Plastic", "Stone", "Other") },
        Colour, Feature("pickupOnly", "Buyer collects") with { Group = "Handover" }, Delivery
    ]);

    private static readonly CategoryDef Appliances = new("appliances", "Home appliances", Goods, "fridge", SaleOnly,
    [
        ItemType("applianceType", "Type", "Fridges & freezers", "Washing machines", "Dryers", "Dishwashers", "Cookers & ovens", "Microwaves",
            "Air conditioners", "Heaters & stoves", "Water heaters", "Vacuum cleaners", "Small kitchen appliances", "Other"),
        Condition, Brand,
        new("energyClass", "Energy class", FieldType.Select) { Filter = FilterKind.Multi, Group = "Item", Options = Same("A+++", "A++", "A+", "A", "B", "C", "D or lower") },
        Warranty, Delivery
    ]);

    private static readonly CategoryDef Kids = new("kids", "Baby & kids", Goods, "stroller", SaleOnly,
    [
        ItemType("kidsType", "Type", "Prams & strollers", "Car seats", "Cots & nursery", "Toys", "Kids' clothes", "Feeding & care", "School supplies", "Other"),
        new("ageGroup", "Age", FieldType.Select)
            { Filter = FilterKind.Multi, OnCard = true, Group = "Item", Options = Same("0–12 months", "1–3 years", "3–6 years", "6–12 years", "12+ years") },
        Condition, Brand with { OnCard = false }, Delivery
    ]);

    private static readonly CategoryDef Sports = new("sports", "Sports & outdoors", Goods, "ball", SaleOnly,
    [
        ItemType("sportsType", "Type", "Bicycles & e-bikes", "Fitness & gym", "Football", "Basketball", "Ski & snowboard", "Camping & hiking",
            "Fishing & hunting", "Water sports", "Other"),
        Condition, Brand, new("size", "Size", FieldType.Text) { Group = "Item", Help = "Frame size, shoe size or similar, if it matters." }, Delivery
    ]);

    private static readonly CategoryDef Hobbies = new("hobbies", "Books, music & hobbies", Goods, "book", SaleOnly,
    [
        ItemType("hobbyType", "Type", "Books", "Textbooks", "Musical instruments", "Records, CDs & films", "Art", "Collectibles & antiques",
            "Board games & puzzles", "Crafts", "Other"),
        Condition, Delivery
    ]);

    private static readonly CategoryDef Tools = new("tools", "Tools & building", Goods, "wrench", SaleOnly,
    [
        ItemType("toolType", "Type", "Power tools", "Hand tools", "Garden tools & machines", "Building materials", "Doors & windows",
            "Plumbing & heating", "Electrical", "Generators & compressors", "Other"),
        Condition, Brand, Delivery
    ]);

    private static readonly CategoryDef OtherGoods = new("other-goods", "Everything else", Goods, "box", SaleOnly,
        [Condition, Brand, Delivery]);

    // ---------- Jobs ----------

    private static readonly CategoryDef JobAds = new("jobs", "Jobs", Jobs, "briefcase", [DealType.Job],
    [
        new("sector", "Field", FieldType.Select)
        {
            Required = true, Filter = FilterKind.Multi, Group = "Job",
            Options = Same("IT & software", "Sales & retail", "Hospitality & tourism", "Construction & trades", "Health & care", "Education",
                "Finance & accounting", "Office & administration", "Customer service & call centre", "Transport & logistics", "Manufacturing",
                "Marketing & media", "Engineering", "Beauty & wellness", "Cleaning & household", "Security", "Agriculture", "Other")
        },
        new("employmentType", "Type of work", FieldType.Select)
        {
            Required = true, Filter = FilterKind.Multi, OnCard = true, Group = "Job",
            Options = Opts(("FullTime", "Full-time"), ("PartTime", "Part-time"), ("Seasonal", "Temporary / seasonal"), ("Internship", "Internship"), ("Freelance", "Freelance"))
        },
        new("workplace", "Workplace", FieldType.Select)
            { Filter = FilterKind.Multi, OnCard = true, Group = "Job", Options = Opts(("OnSite", "On site"), ("Hybrid", "Hybrid"), ("Remote", "Remote")) },
        new("experience", "Experience", FieldType.Select)
        {
            Filter = FilterKind.Multi, OnCard = true, Group = "Job",
            Options = Opts(("None", "No experience needed"), ("1-2", "1–2 years"), ("3-5", "3–5 years"), ("5+", "5+ years"))
        },
        new("education", "Education", FieldType.Select)
            { Filter = FilterKind.Multi, Group = "Job", Options = Opts(("None", "None required"), ("HighSchool", "High school"), ("Bachelor", "Bachelor's degree"), ("Master", "Master's or higher")) },
        new("company", "Company", FieldType.Text) { Filter = FilterKind.Contains, Group = "Job", Help = "Leave empty if you post as a business; your business name is shown." },
        new("languages", "Languages", FieldType.Text) { Filter = FilterKind.Contains, Group = "Job", Help = "e.g. Albanian, English, German" },
        new("positions", "Open positions", FieldType.Integer) { Min = 1, Max = 500, Group = "Job" },
        Feature("transport", "Transport paid") with { Group = "Benefits" },
        Feature("meals", "Meals provided") with { Group = "Benefits" },
        Feature("accommodation", "Accommodation provided") with { Group = "Benefits" },
        Feature("training", "Training provided") with { Group = "Benefits" },
        Feature("cvRequired", "CV required to apply") with { Group = "Applying", Filter = FilterKind.None }
    ]) { PhotosRequired = false };

    public static readonly IReadOnlyList<CategoryDef> All =
    [
        Apartment, House, Land, Commercial, Cars, Motorcycles, Vans,
        Clothing, Electronics, Furniture, Appliances, Kids, Sports, Hobbies, Tools, OtherGoods,
        JobAds
    ];

    public static CategoryDef? Find(string? key) => All.FirstOrDefault(c => c.Key == key);

    public static IEnumerable<CategoryDef> InVertical(string? vertical) =>
        string.IsNullOrEmpty(vertical) ? All : All.Where(c => c.Vertical == vertical);
}
