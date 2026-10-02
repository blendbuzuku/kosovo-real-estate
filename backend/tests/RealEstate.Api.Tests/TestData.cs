using System.Net.Http.Headers;
using System.Net.Http.Json;
using RealEstate.Api.Domain;
using RealEstate.Api.Features.Listings;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace RealEstate.Api.Tests;

public static class TestData
{
    public static ListingUpsertRequest Apartment(
        string city = "Prishtinë", decimal price = 85_000, decimal area = 70, double lat = 42.6629, double lng = 21.1655,
        DealType deal = DealType.Sale, LegalizationStatus legalization = LegalizationStatus.Legalized, int rooms = 2) => new()
    {
        Title = $"Apartment {rooms} rooms in {city}",
        Description = "Sunny apartment close to the centre, recently renovated, with a view over the park.",
        PropertyType = PropertyType.Apartment,
        DealType = deal,
        PriceEur = price,
        AreaM2 = area,
        Rooms = rooms,
        Floor = 3,
        TotalFloors = 8,
        YearBuilt = 2015,
        Heating = HeatingType.District,
        HasParking = true,
        HasElevator = true,
        City = city,
        Neighborhood = "Qendra",
        Lat = lat,
        Lng = lng,
        Legal = new LegalStatusDto(true, true, legalization, null)
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
