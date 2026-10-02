using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using RealEstate.Api.Domain;
using RealEstate.Api.Features.Listings;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace RealEstate.Api.Tests;

public static class TestData
{
    public static Dictionary<string, JsonElement> Attrs(object values) =>
        JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(JsonSerializer.Serialize(values))!;

    public static ListingUpsertRequest Apartment(
        string municipality = "Prishtinë", decimal price = 85_000, decimal area = 70, double? lat = 42.6629, double? lng = 21.1655,
        DealType deal = DealType.Sale, string legalization = "Legalized", int rooms = 2, string? place = "Qendra") => new()
    {
        Category = "apartments",
        DealType = deal,
        Title = $"Apartment {rooms} rooms in {municipality}",
        Description = "Sunny apartment close to the centre, recently renovated, with a view over the park.",
        PriceEur = price,
        Municipality = municipality,
        Place = place,
        Lat = lat,
        Lng = lng,
        Attributes = Attrs(new
        {
            areaM2 = area, rooms, floor = 3, totalFloors = 8, yearBuilt = 2015, heating = "District",
            parking = true, elevator = true, legalization, hasCadastreCertificate = true, hasConstructionPermit = true
        })
    };

    public static ListingUpsertRequest Stay(decimal pricePerNight = 50, int maxGuests = 4, int minNights = 2) => new()
    {
        Category = "apartments",
        DealType = DealType.RentNightly,
        Title = "Old town apartment for short stays",
        Description = "Two bedrooms under the fortress, self check-in and free parking.",
        PriceEur = pricePerNight,
        Municipality = "Prizren",
        Place = "Marash",
        Attributes = Attrs(new { areaM2 = 65, rooms = 3, maxGuests, beds = 3, minNights, wifi = true })
    };

    public static ListingUpsertRequest Car(
        string make = "Volkswagen", string model = "Golf 7 1.6 TDI", int year = 2016, int mileageKm = 160_000,
        string fuel = "Diesel", decimal price = 11_500, DealType deal = DealType.Sale) => new()
    {
        Category = "cars",
        DealType = deal,
        Title = $"{make} {model} {year}",
        Description = "Imported from Germany, customs cleared, full service history.",
        PriceEur = price,
        Municipality = "Ferizaj",
        Attributes = Attrs(new { make, model, year, mileageKm, fuel, transmission = "Manual", customsCleared = true })
    };

    public static byte[] Jpeg(int width = 2400, int height = 1600)
    {
        using var image = new Image<Rgb24>(width, height, new Rgb24(120, 160, 200));
        using var ms = new MemoryStream();
        image.SaveAsJpeg(ms);
        return ms.ToArray();
    }

    public static async Task<ListingDetailDto> CreateListing(HttpClient owner, ListingUpsertRequest? request = null)
    {
        var res = await owner.PostAsJsonAsync("/api/listings", request ?? Apartment(), ApiFactory.Json);
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<ListingDetailDto>(ApiFactory.Json))!;
    }

    public static async Task<HttpResponseMessage> UploadPhoto(HttpClient owner, Guid listingId, byte[]? bytes = null, string contentType = "image/jpeg")
    {
        using var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes ?? Jpeg());
        file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        form.Add(file, "files", "photo.jpg");
        return await owner.PostAsync($"/api/listings/{listingId}/photos", form);
    }

    /// <summary>Creates a listing, adds a photo, submits it and approves it as admin.</summary>
    public static async Task<ListingDetailDto> CreateLiveListing(ApiFactory factory, HttpClient owner, ListingUpsertRequest? request = null)
    {
        var listing = await CreateListing(owner, request);
        (await UploadPhoto(owner, listing.Id)).EnsureSuccessStatusCode();
        (await owner.PostAsync($"/api/listings/{listing.Id}/submit", null)).EnsureSuccessStatusCode();
        var admin = await factory.ClientFor(ApiFactory.AdminEmail, ApiFactory.AdminPassword);
        (await admin.PostAsync($"/api/admin/listings/{listing.Id}/approve", null)).EnsureSuccessStatusCode();
        return listing;
    }

    public static async Task<T> Read<T>(this HttpResponseMessage res)
    {
        if (!res.IsSuccessStatusCode)
            throw new HttpRequestException($"{(int)res.StatusCode}: {await res.Content.ReadAsStringAsync()}");
        return (await res.Content.ReadFromJsonAsync<T>(ApiFactory.Json))!;
    }
}
