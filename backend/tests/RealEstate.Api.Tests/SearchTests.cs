using System.Net.Http.Json;
using RealEstate.Api.Domain;
using RealEstate.Api.Features.Listings;
using RealEstate.Api.Features.SavedSearches;

namespace RealEstate.Api.Tests;

/// <summary>Each test gets a fresh database so result counts are exact.</summary>
public class SearchTests : IAsyncLifetime
{
    private readonly ApiFactory _factory = new();
    private HttpClient _anon = null!;
    private ListingDetailDto _prishtinaCentre = null!, _prishtinaSuburb = null!, _prizren = null!, _rental = null!;
    private ListingDetailDto _golf = null!, _hybrid = null!, _rentalCar = null!;

    public async Task InitializeAsync()
    {
        var (owner, _) = await _factory.Register();
        _prishtinaCentre = await TestData.CreateLiveListing(_factory, owner,
            TestData.Apartment(price: 140_000, area: 80, lat: 42.6629, lng: 21.1655));
        _prishtinaSuburb = await TestData.CreateLiveListing(_factory, owner,
            TestData.Apartment(price: 90_000, area: 90, lat: 42.6300, lng: 21.1200, legalization: "NotLegalized", rooms: 3, place: "Arbëria (Dragodan)"));
        _prizren = await TestData.CreateLiveListing(_factory, owner,
            TestData.Apartment(municipality: "Prizren", price: 70_000, area: 75, lat: 42.2139, lng: 20.7397));
        _rental = await TestData.CreateLiveListing(_factory, owner,
            TestData.Apartment(price: 450, area: 60, lat: 42.6650, lng: 21.1700, deal: DealType.RentMonthly));
        var (dealer, _) = await _factory.Register(BusinessKind.CarDealer);
        _golf = await TestData.CreateLiveListing(_factory, dealer, TestData.Car(mileageKm: 160_000, year: 2016));
        _hybrid = await TestData.CreateLiveListing(_factory, dealer,
            TestData.Car(make: "Toyota", model: "C-HR Hybrid", year: 2021, mileageKm: 45_000, fuel: "Hybrid", price: 23_500));
        _rentalCar = await TestData.CreateLiveListing(_factory, dealer, TestData.Car(model: "Polo", year: 2022, price: 20, deal: DealType.RentDaily));
        _anon = _factory.CreateClient();
    }

    public Task DisposeAsync() => _factory.DisposeAsync();

    private async Task<List<Guid>> Search(string query) =>
        (await (await _anon.GetAsync($"/api/listings?{query}")).Read<PagedResult<ListingSummaryDto>>()).Items.Select(i => i.Id).ToList();

    [Fact]
    public async Task Filters_by_category_deal_location_and_price()
    {
        Assert.Equal([_prishtinaCentre.Id, _prishtinaSuburb.Id, _prizren.Id], await Search("category=apartments&dealType=Sale&sort=PriceDesc"));
        Assert.Equal([_rental.Id], await Search("dealType=RentMonthly"));
        Assert.Equal([_rentalCar.Id], await Search("dealType=RentDaily"));
        Assert.Equal(4, (await Search("vertical=property")).Count);
        Assert.Equal([_prizren.Id], await Search("municipality=Prizren"));
        Assert.Equal([_prishtinaSuburb.Id], await Search("place=Arbëria (Dragodan)"));
        Assert.Equal([_prishtinaSuburb.Id], await Search("category=apartments&dealType=Sale&minPrice=80000&maxPrice=100000"));
        Assert.Equal([_prishtinaSuburb.Id], await Search("category=apartments&f.rooms.min=3"));
        Assert.Equal(3, (await Search("seller=Business")).Count);
    }

    [Fact]
    public async Task Car_filters_use_the_category_fields()
    {
        Assert.Equal([_hybrid.Id], await Search("category=cars&dealType=Sale&f.mileageKm.max=100000"));
        Assert.Equal([_hybrid.Id], await Search("category=cars&f.fuel=Hybrid,Electric"));
        Assert.Equal([_golf.Id], await Search("category=cars&dealType=Sale&f.year.max=2018"));
        Assert.Equal([_golf.Id, _rentalCar.Id], (await Search("category=cars&f.model=golf")).Concat(await Search("category=cars&f.model=POLO")).ToList());
        Assert.Equal([_hybrid.Id, _golf.Id], await Search("category=cars&dealType=Sale&sort=MileageAsc"));
        Assert.Equal(3, (await Search("category=cars&f.customsCleared=true")).Count);
        // Fields from another category are ignored rather than matching nothing.
        Assert.Equal(3, (await Search("category=cars&f.rooms.min=3")).Count);
    }

    [Fact]
    public async Task Sorts_by_price_per_square_metre()
    {
        // 70k/75 = 933, 90k/90 = 1000, 140k/80 = 1750
        Assert.Equal([_prizren.Id, _prishtinaSuburb.Id, _prishtinaCentre.Id], await Search("category=apartments&dealType=Sale&sort=PricePerM2Asc"));
    }

    [Fact]
    public async Task Legal_status_filter_hides_unlegalized_buildings()
    {
        var ids = await Search("dealType=Sale&f.legalization=Legalized,NotRequired");
        Assert.DoesNotContain(_prishtinaSuburb.Id, ids);
        Assert.Contains(_prishtinaCentre.Id, ids);
    }

    [Fact]
    public async Task Radius_and_bounding_box_searches_use_real_distances()
    {
        // The suburb listing is ~5 km from the centre.
        var within2Km = await Search("lat=42.6629&lng=21.1655&radiusKm=2");
        Assert.Contains(_prishtinaCentre.Id, within2Km);
        Assert.Contains(_rental.Id, within2Km);
        Assert.DoesNotContain(_prishtinaSuburb.Id, within2Km);

        var within10Km = await Search("lat=42.6629&lng=21.1655&radiusKm=10");
        Assert.Contains(_prishtinaSuburb.Id, within10Km);
        Assert.DoesNotContain(_prizren.Id, within10Km);

        var prizrenBox = await Search("bbox=20.6,42.1,20.9,42.3");
        Assert.Equal([_prizren.Id], prizrenBox);

        var pins = await (await _anon.GetAsync("/api/listings/map?bbox=20.6,42.1,20.9,42.3")).Read<List<MapPinDto>>();
        var pin = Assert.Single(pins);
        Assert.Equal(42.2139, pin.Lat, 4);
        Assert.Equal(20.7397, pin.Lng, 4);
    }

    [Fact]
    public async Task Saved_search_emails_only_new_matching_listings()
    {
        var (seeker, seekerUser) = await _factory.Register();
        var criteria = new ListingSearchCriteria
        {
            Category = "apartments", Municipality = "Prizren", DealType = DealType.Sale, MaxPrice = 100_000,
            F = new() { ["rooms.min"] = "2" }
        };
        (await seeker.PostAsJsonAsync("/api/me/saved-searches", new SaveSearchRequest("Prizren under 100k", criteria), ApiFactory.Json))
            .EnsureSuccessStatusCode();

        _factory.Clock.Advance(TimeSpan.FromHours(1));
        var (owner, _) = await _factory.Register();
        var match = await TestData.CreateLiveListing(_factory, owner,
            TestData.Apartment(municipality: "Prizren", price: 65_000, lat: 42.21, lng: 20.74));
        await TestData.CreateLiveListing(_factory, owner,
            TestData.Apartment(municipality: "Prizren", price: 250_000, lat: 42.21, lng: 20.74)); // too expensive
        await TestData.CreateLiveListing(_factory, owner,
            TestData.Apartment(municipality: "Prizren", price: 45_000, rooms: 1, lat: 42.21, lng: 20.74)); // too small
        _factory.Clock.Advance(TimeSpan.FromMinutes(15));

        await _factory.WithScope(sp => sp.GetRequiredService<ListingMaintenance>().SendSavedSearchAlertsAsync(default));
        var alert = Assert.Single(_factory.Email.Sent, e => e.To == seekerUser.Email);
        Assert.Contains(match.Id.ToString(), alert.Body);
        Assert.StartsWith("<p>1 new listing match", alert.Body);

        // Nothing new: no second email.
        _factory.Clock.Advance(TimeSpan.FromMinutes(15));
        await _factory.WithScope(sp => sp.GetRequiredService<ListingMaintenance>().SendSavedSearchAlertsAsync(default));
        Assert.Single(_factory.Email.Sent, e => e.To == seekerUser.Email);
    }
}
