using System.Net;
using System.Net.Http.Json;
using RealEstate.Api.Domain;
using RealEstate.Api.Features.Accounts;
using RealEstate.Api.Features.Listings;
using RealEstate.Api.Features.Messaging;
using RealEstate.Api.Features.Moderation;

namespace RealEstate.Api.Tests;

public class ListingFlowTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Listing_goes_live_only_after_photos_submit_and_admin_approval()
    {
        var (owner, _) = await factory.Register();
        var listing = await TestData.CreateListing(owner);
        Assert.Equal(ListingStatus.Draft, listing.Status);

        // Drafts are invisible to the public.
        var anon = factory.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await anon.GetAsync($"/api/listings/{listing.Id}")).StatusCode);

        // Can't submit without a photo.
        var noPhoto = await owner.PostAsync($"/api/listings/{listing.Id}/submit", null);
        Assert.Equal(HttpStatusCode.Conflict, noPhoto.StatusCode);

        var photos = await (await TestData.UploadPhoto(owner, listing.Id)).Read<List<PhotoDto>>();
        var photo = Assert.Single(photos);
        Assert.Equal(1600, photo.Width); // resized from 2400 wide
        Assert.Equal(HttpStatusCode.OK, (await anon.GetAsync(photo.ThumbnailUrl)).StatusCode);

        var submitted = await (await owner.PostAsync($"/api/listings/{listing.Id}/submit", null)).Read<ListingDetailDto>();
        Assert.Equal(ListingStatus.PendingReview, submitted.Status);

        var admin = await factory.ClientFor(ApiFactory.AdminEmail, ApiFactory.AdminPassword);
        var queue = await (await admin.GetAsync("/api/admin/listings")).Read<PagedResult<ListingSummaryDto>>();
        Assert.Contains(queue.Items, i => i.Id == listing.Id);

        // Owners can't approve their own listings.
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.PostAsync($"/api/admin/listings/{listing.Id}/approve", null)).StatusCode);
        (await admin.PostAsync($"/api/admin/listings/{listing.Id}/approve", null)).EnsureSuccessStatusCode();

        var live = await (await anon.GetAsync($"/api/listings/{listing.Id}")).Read<ListingDetailDto>();
        Assert.Equal(ListingStatus.Active, live.Status);
        Assert.Equal(factory.Clock.GetUtcNow() + Listing.Lifetime, live.ExpiresAt);
        Assert.True(live.Attributes.GetProperty("hasCadastreCertificate").GetBoolean());
        Assert.Equal("Legalized", live.Attributes.GetProperty("legalization").GetString());
        Assert.Equal(1214.29m, live.PricePerM2); // 85,000 / 70 m²
        Assert.Contains(factory.Email.Sent, e => e.Subject.Contains("is live"));

        // A live ad keeps at least one photo.
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.DeleteAsync($"/api/listings/{listing.Id}/photos/{photo.Id}")).StatusCode);
    }

    [Fact]
    public async Task Rejected_listing_carries_the_reason_and_can_be_resubmitted()
    {
        var (owner, _) = await factory.Register();
        var listing = await TestData.CreateListing(owner);
        await TestData.UploadPhoto(owner, listing.Id);
        await owner.PostAsync($"/api/listings/{listing.Id}/submit", null);

        var admin = await factory.ClientFor(ApiFactory.AdminEmail, ApiFactory.AdminPassword);
        (await admin.PostAsJsonAsync($"/api/admin/listings/{listing.Id}/reject", new RejectRequest("Photos show a different flat"))).EnsureSuccessStatusCode();

        var mine = await (await owner.GetAsync($"/api/listings/{listing.Id}")).Read<ListingDetailDto>();
        Assert.Equal(ListingStatus.Rejected, mine.Status);
        Assert.Equal("Photos show a different flat", mine.ModerationNote);

        var resubmitted = await (await owner.PostAsync($"/api/listings/{listing.Id}/submit", null)).Read<ListingDetailDto>();
        Assert.Equal(ListingStatus.PendingReview, resubmitted.Status);
    }

    [Fact]
    public async Task Editing_a_live_listing_sends_it_back_to_review()
    {
        var (owner, _) = await factory.Register();
        var listing = await TestData.CreateLiveListing(factory, owner);

        var edited = await (await owner.PutAsJsonAsync($"/api/listings/{listing.Id}", TestData.Apartment(price: 79_000), ApiFactory.Json))
            .Read<ListingDetailDto>();
        Assert.Equal(ListingStatus.PendingReview, edited.Status);
        Assert.Equal(79_000, edited.PriceEur);
    }

    [Fact]
    public async Task Anonymous_users_cannot_post_and_others_cannot_edit()
    {
        var res = await factory.CreateClient().PostAsJsonAsync("/api/listings", TestData.Apartment(), ApiFactory.Json);
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);

        var (owner, _) = await factory.Register();
        var (otherOwner, _) = await factory.Register();
        var listing = await TestData.CreateListing(owner);
        var edit = await otherOwner.PutAsJsonAsync($"/api/listings/{listing.Id}", TestData.Apartment(), ApiFactory.Json);
        Assert.Equal(HttpStatusCode.NotFound, edit.StatusCode);
    }

    [Fact]
    public async Task Rejects_coordinates_outside_Kosovo_and_non_images()
    {
        var (owner, _) = await factory.Register();
        // lat/lng swapped
        var bad = await owner.PostAsJsonAsync("/api/listings", TestData.Apartment(lat: 21.16, lng: 42.66), ApiFactory.Json);
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);

        var listing = await TestData.CreateListing(owner);
        var notImage = await TestData.UploadPhoto(owner, listing.Id, "not an image"u8.ToArray());
        Assert.Equal(HttpStatusCode.BadRequest, notImage.StatusCode);
    }

    [Fact]
    public async Task Listings_expire_after_60_days_and_can_be_renewed_near_the_end()
    {
        var (owner, _) = await factory.Register();
        var listing = await TestData.CreateLiveListing(factory, owner);

        // Too early to renew.
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PostAsync($"/api/listings/{listing.Id}/renew", null)).StatusCode);

        factory.Clock.Advance(TimeSpan.FromDays(58));
        await factory.WithScope(sp => sp.GetRequiredService<ListingMaintenance>().SendExpiryRemindersAsync(default));
        Assert.Contains(factory.Email.Sent, e => e.Subject.Contains("expires on") && e.Subject.Contains(listing.Title));

        factory.Clock.Advance(TimeSpan.FromDays(3));
        await factory.WithScope(sp => sp.GetRequiredService<ListingMaintenance>().ExpireAsync(default));

        var anon = factory.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await anon.GetAsync($"/api/listings/{listing.Id}")).StatusCode);

        var renewed = await (await owner.PostAsync($"/api/listings/{listing.Id}/renew", null)).Read<ListingDetailDto>();
        Assert.Equal(ListingStatus.Active, renewed.Status);
        Assert.Equal(factory.Clock.GetUtcNow() + Listing.Lifetime, renewed.ExpiresAt);
    }

    [Fact]
    public async Task Expired_listing_can_be_edited_and_sent_back_for_review()
    {
        var (owner, _) = await factory.Register();
        var listing = await TestData.CreateLiveListing(factory, owner);
        await factory.WithDb(async db =>
        {
            var l = await db.Listings.FindAsync(listing.Id);
            l!.Expire();
            return await db.SaveChangesAsync();
        });

        (await owner.PutAsJsonAsync($"/api/listings/{listing.Id}", TestData.Apartment(price: 70_000), ApiFactory.Json)).EnsureSuccessStatusCode();
        var submitted = await (await owner.PostAsync($"/api/listings/{listing.Id}/submit", null)).Read<ListingDetailDto>();
        Assert.Equal(ListingStatus.PendingReview, submitted.Status);
    }

    [Fact]
    public async Task Seeker_can_favorite_message_owner_and_owner_replies()
    {
        var (owner, ownerUser) = await factory.Register(BusinessKind.RealEstateAgency, "Test Agency Prishtina");
        Assert.Equal(UserRole.Business, ownerUser.Role);
        Assert.Equal("test-agency-prishtina", ownerUser.Business!.Slug);
        var listing = await TestData.CreateLiveListing(factory, owner);

        var (seeker, _) = await factory.Register();
        (await seeker.PutAsync($"/api/me/favorites/{listing.Id}", null)).EnsureSuccessStatusCode();
        var favorites = await (await seeker.GetAsync("/api/me/favorites")).Read<List<ListingSummaryDto>>();
        Assert.Equal(listing.Id, Assert.Single(favorites).Id);
        Assert.Equal(new SellerSummaryDto("Test Agency Prishtina", true, BusinessKind.RealEstateAgency, "test-agency-prishtina"), favorites[0].Seller);

        var detail = await (await seeker.GetAsync($"/api/listings/{listing.Id}")).Read<ListingDetailDto>();
        Assert.True(detail.IsFavorite);

        var phone = await (await seeker.GetAsync($"/api/listings/{listing.Id}/phone")).Read<PhoneDto>();
        Assert.Equal("+383 44 000 111", phone.Phone);

        var conversation = await (await seeker.PostAsJsonAsync($"/api/listings/{listing.Id}/messages", new SendMessageRequest("Is it still available?")))
            .Read<ConversationDto>();
        Assert.Contains(factory.Email.Sent, e => e.To == ownerUser.Email && e.Subject.Contains("New message"));

        Assert.Equal(1, await (await owner.GetAsync("/api/me/conversations/unread")).Read<int>());
        var inbox = await (await owner.GetAsync("/api/me/conversations")).Read<List<ConversationDto>>();
        Assert.True(Assert.Single(inbox).IAmOwner);

        var thread = await (await owner.GetAsync($"/api/conversations/{conversation.Id}/messages")).Read<List<MessageDto>>();
        Assert.Equal("Is it still available?", Assert.Single(thread).Body);
        Assert.Equal(0, await (await owner.GetAsync("/api/me/conversations/unread")).Read<int>());

        (await owner.PostAsJsonAsync($"/api/conversations/{conversation.Id}/messages", new SendMessageRequest("Yes, come Saturday."))).EnsureSuccessStatusCode();
        var seekerThread = await (await seeker.GetAsync($"/api/conversations/{conversation.Id}/messages")).Read<List<MessageDto>>();
        Assert.Equal(2, seekerThread.Count);

        // A stranger can't read it.
        var (stranger, _) = await factory.Register();
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/conversations/{conversation.Id}/messages")).StatusCode);
    }

    [Fact]
    public async Task Report_and_takedown_removes_listing_from_search()
    {
        var (owner, _) = await factory.Register();
        var listing = await TestData.CreateLiveListing(factory, owner, TestData.Apartment(municipality: "Gjilan", lat: 42.4635, lng: 21.4694));

        var (seeker, _) = await factory.Register();
        Assert.Equal(HttpStatusCode.Accepted,
            (await seeker.PostAsJsonAsync($"/api/listings/{listing.Id}/reports", new ReportListingRequest(ReportReason.Fraud, "Asked for a deposit by wire"), ApiFactory.Json)).StatusCode);

        var admin = await factory.ClientFor(ApiFactory.AdminEmail, ApiFactory.AdminPassword);
        var reports = await (await admin.GetAsync("/api/admin/reports")).Read<List<ReportDto>>();
        var report = Assert.Single(reports, r => r.ListingId == listing.Id);

        // Owners can't report their own ads.
        Assert.Equal(HttpStatusCode.BadRequest,
            (await owner.PostAsJsonAsync($"/api/listings/{listing.Id}/reports", new ReportListingRequest(ReportReason.Spam, null), ApiFactory.Json)).StatusCode);

        (await admin.PostAsJsonAsync($"/api/admin/reports/{report.Id}/resolve", new ResolveReportRequest(true, null))).EnsureSuccessStatusCode();

        var anon = factory.CreateClient();
        var results = await (await anon.GetAsync("/api/listings?municipality=Gjilan")).Read<PagedResult<ListingSummaryDto>>();
        Assert.DoesNotContain(results.Items, i => i.Id == listing.Id);
        var mine = await (await owner.GetAsync($"/api/listings/{listing.Id}")).Read<ListingDetailDto>();
        Assert.Equal(ListingStatus.Rejected, mine.Status);
    }

    [Fact]
    public async Task Ads_are_checked_against_their_category_and_the_location_list()
    {
        var (owner, _) = await factory.Register();

        var wrongDeal = await owner.PostAsJsonAsync("/api/listings", TestData.Car(deal: DealType.RentNightly), ApiFactory.Json);
        Assert.Equal(HttpStatusCode.BadRequest, wrongDeal.StatusCode);
        Assert.Contains("dealType", await wrongDeal.Content.ReadAsStringAsync());

        var badFields = await owner.PostAsJsonAsync("/api/listings", TestData.Car() with
        {
            Attributes = TestData.Attrs(new { make = "Trabant", model = "601", year = 1800, fuel = "Diesel", rooms = 3 })
        }, ApiFactory.Json);
        var errors = (await badFields.Content.ReadFromJsonAsync<ValidationErrors>(ApiFactory.Json))!.Errors;
        Assert.Contains("attributes.make", errors.Keys);  // not in the list of makes
        Assert.Contains("attributes.year", errors.Keys);  // below 1950
        Assert.Contains("attributes.rooms", errors.Keys); // cars don't have rooms

        var unknownPlace = await owner.PostAsJsonAsync("/api/listings", TestData.Apartment(place: "Atlantis"), ApiFactory.Json);
        Assert.Contains("place", (await unknownPlace.Content.ReadFromJsonAsync<ValidationErrors>(ApiFactory.Json))!.Errors.Keys);

        // Names typed without ë/ç or in another case are matched to the list and stored as listed.
        var folded = await TestData.CreateListing(owner, TestData.Apartment(municipality: "peje", place: "karagac", lat: null, lng: null));
        Assert.Equal("Pejë", folded.Municipality);
        Assert.Equal("Karagaç", folded.Place);

        // No pin: the ad sits at the municipality centre. Strings from forms are normalised to numbers and booleans.
        var noPin = await TestData.CreateListing(owner, TestData.Apartment(municipality: "Pejë", place: "Karagaç", lat: null, lng: null) with
        {
            Attributes = TestData.Attrs(new { areaM2 = "64.5", rooms = "3", parking = "true" })
        });
        Assert.Equal(42.66, noPin.Lat, 1);
        Assert.Equal(64.5m, noPin.Attributes.GetProperty("areaM2").GetDecimal());
        Assert.True(noPin.Attributes.GetProperty("parking").GetBoolean());
    }

    [Fact]
    public async Task Nightly_stays_take_booking_requests_within_their_rules()
    {
        var (host, hostUser) = await factory.Register();
        var stay = await TestData.CreateLiveListing(factory, host, TestData.Stay(pricePerNight: 45, maxGuests: 4, minNights: 2));
        var (guest, _) = await factory.Register();
        var url = $"/api/listings/{stay.Id}/booking-requests";
        // Other tests in this class move the shared clock, so dates are relative to it.
        var today = DateOnly.FromDateTime(factory.Clock.GetUtcNow().UtcDateTime);
        DateOnly Day(int offset) => today.AddDays(offset);

        Assert.Equal(HttpStatusCode.BadRequest, (await guest.PostAsJsonAsync(url, new BookingRequestBody(Day(9), Day(10), 2, null))).StatusCode); // 1 night < 2
        Assert.Equal(HttpStatusCode.BadRequest, (await guest.PostAsJsonAsync(url, new BookingRequestBody(Day(9), Day(12), 6, null))).StatusCode); // too many guests
        Assert.Equal(HttpStatusCode.BadRequest, (await guest.PostAsJsonAsync(url, new BookingRequestBody(Day(-21), Day(-18), 2, null))).StatusCode); // in the past

        var conversation = await (await guest.PostAsJsonAsync(url, new BookingRequestBody(Day(9), Day(12), 3, "We arrive late"))).Read<ConversationDto>();
        Assert.Contains(factory.Email.Sent, e => e.To == hostUser.Email && e.Subject.Contains("New message"));

        var thread = await (await host.GetAsync($"/api/conversations/{conversation.Id}/messages")).Read<List<MessageDto>>();
        var request = Assert.Single(thread);
        Assert.Equal(new BookingDto(Day(9), Day(12), 3, 3, 135), request.Booking);
        Assert.Contains("We arrive late", request.Body);

        // Sales don't take bookings.
        var car = await TestData.CreateLiveListing(factory, host, TestData.Car());
        var notRental = await guest.PostAsJsonAsync($"/api/listings/{car.Id}/booking-requests", new BookingRequestBody(Day(9), Day(12), null, null));
        Assert.Equal(HttpStatusCode.BadRequest, notRental.StatusCode);
    }

    [Fact]
    public async Task Business_page_lists_the_business_ads()
    {
        var (rental, user) = await factory.Register(BusinessKind.RentACar, "Rent Test Pejë");
        var ad = await TestData.CreateLiveListing(factory, rental, TestData.Car(deal: DealType.RentDaily, price: 25));

        var anon = factory.CreateClient();
        var page = await (await anon.GetAsync($"/api/businesses/{user.Business!.Slug}")).Read<BusinessProfileDto>();
        Assert.Equal(BusinessKind.RentACar, page.Kind);
        Assert.Equal(1, page.ActiveListings);
        var ads = await (await anon.GetAsync($"/api/businesses/{user.Business.Slug}/listings")).Read<PagedResult<ListingSummaryDto>>();
        Assert.Equal(ad.Id, Assert.Single(ads.Items).Id);
        Assert.Contains(await (await anon.GetAsync("/api/businesses?kind=RentACar")).Read<List<BusinessProfileDto>>(), b => b.Slug == user.Business.Slug);
    }

    private record ValidationErrors(Dictionary<string, string[]> Errors);
}
