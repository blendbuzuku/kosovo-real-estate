using System.Net;
using System.Net.Http.Json;
using RealEstate.Api.Domain;
using RealEstate.Api.Features.Listings;
using RealEstate.Api.Features.Messaging;
using RealEstate.Api.Features.Moderation;

namespace RealEstate.Api.Tests;

public class ListingFlowTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Listing_goes_live_only_after_photos_submit_and_admin_approval()
    {
        var (owner, _) = await factory.Register("Owner");
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
        Assert.True(live.Legal.HasCadastreCertificate);
        Assert.Contains(factory.Email.Sent, e => e.Subject.Contains("is live"));
    }

    [Fact]
    public async Task Rejected_listing_carries_the_reason_and_can_be_resubmitted()
    {
        var (owner, _) = await factory.Register("Owner");
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
        var (owner, _) = await factory.Register("Owner");
        var listing = await TestData.CreateLiveListing(factory, owner);

        var edited = await (await owner.PutAsJsonAsync($"/api/listings/{listing.Id}", TestData.Apartment(price: 79_000), ApiFactory.Json))
            .Read<ListingDetailDto>();
        Assert.Equal(ListingStatus.PendingReview, edited.Status);
        Assert.Equal(79_000, edited.PriceEur);
    }

    [Fact]
    public async Task Seekers_cannot_post_and_others_cannot_edit()
    {
        var (seeker, _) = await factory.Register("Seeker");
        var res = await seeker.PostAsJsonAsync("/api/listings", TestData.Apartment(), ApiFactory.Json);
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);

        var (owner, _) = await factory.Register("Owner");
        var (otherOwner, _) = await factory.Register("Owner");
        var listing = await TestData.CreateListing(owner);
        var edit = await otherOwner.PutAsJsonAsync($"/api/listings/{listing.Id}", TestData.Apartment(), ApiFactory.Json);
        Assert.Equal(HttpStatusCode.NotFound, edit.StatusCode);
    }

    [Fact]
    public async Task Rejects_coordinates_outside_Kosovo_and_non_images()
    {
        var (owner, _) = await factory.Register("Owner");
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
        var (owner, _) = await factory.Register("Owner");
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
    public async Task Seeker_can_favorite_message_owner_and_owner_replies()
    {
        var (owner, ownerUser) = await factory.Register("Agency", agencyName: "Test Agency Prishtina");
        Assert.NotNull(ownerUser.Agency);
        var listing = await TestData.CreateLiveListing(factory, owner);

        var (seeker, _) = await factory.Register("Seeker");
        (await seeker.PutAsync($"/api/me/favorites/{listing.Id}", null)).EnsureSuccessStatusCode();
        var favorites = await (await seeker.GetAsync("/api/me/favorites")).Read<List<ListingSummaryDto>>();
        Assert.Equal(listing.Id, Assert.Single(favorites).Id);
        Assert.Equal("Test Agency Prishtina", favorites[0].AgencyName);

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
        var (stranger, _) = await factory.Register("Seeker");
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/conversations/{conversation.Id}/messages")).StatusCode);
    }

    [Fact]
    public async Task Report_and_takedown_removes_listing_from_search()
    {
        var (owner, _) = await factory.Register("Owner");
        var listing = await TestData.CreateLiveListing(factory, owner, TestData.Apartment(city: "Gjilan", lat: 42.4635, lng: 21.4694));

        var (seeker, _) = await factory.Register("Seeker");
        Assert.Equal(HttpStatusCode.Accepted,
            (await seeker.PostAsJsonAsync($"/api/listings/{listing.Id}/reports", new ReportListingRequest(ReportReason.Fraud, "Asked for a deposit by wire"), ApiFactory.Json)).StatusCode);

        var admin = await factory.ClientFor(ApiFactory.AdminEmail, ApiFactory.AdminPassword);
        var reports = await (await admin.GetAsync("/api/admin/reports")).Read<List<ReportDto>>();
        var report = Assert.Single(reports, r => r.ListingId == listing.Id);

        (await admin.PostAsJsonAsync($"/api/admin/reports/{report.Id}/resolve", new ResolveReportRequest(true, null))).EnsureSuccessStatusCode();

        var anon = factory.CreateClient();
        var results = await (await anon.GetAsync("/api/listings?city=Gjilan")).Read<PagedResult<ListingSummaryDto>>();
        Assert.DoesNotContain(results.Items, i => i.Id == listing.Id);
        var mine = await (await owner.GetAsync($"/api/listings/{listing.Id}")).Read<ListingDetailDto>();
        Assert.Equal(ListingStatus.Rejected, mine.Status);
    }
}
