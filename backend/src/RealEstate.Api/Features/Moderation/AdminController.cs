using System.ComponentModel.DataAnnotations;
using System.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using RealEstate.Api.Data;
using RealEstate.Api.Domain;
using RealEstate.Api.Features.Listings;
using RealEstate.Api.Infrastructure;

namespace RealEstate.Api.Features.Moderation;

public record RejectRequest([Required, StringLength(1000, MinimumLength = 3)] string Reason);

public record ResolveReportRequest(bool RemoveListing, [MaxLength(1000)] string? Note);

public record ReportDto(
    Guid Id, Guid ListingId, string ListingTitle, ListingStatus ListingStatus, ReportReason Reason,
    string? Comment, string ReporterEmail, ReportStatus Status, DateTimeOffset CreatedAt, int OpenReportsOnListing);

public record AdminStatsDto(int PendingReview, int Active, int OpenReports, int Users, int Agencies);

[ApiController]
[Authorize(Roles = Roles.Admin)]
[Route("api/admin")]
public class AdminController(
    AppDbContext db, IFileStorage storage, TimeProvider clock, IEmailSender email, IOptions<EmailOptions> emailOptions) : ControllerBase
{
    [HttpGet("stats")]
    public async Task<AdminStatsDto> Stats(CancellationToken ct) => new(
        await db.Listings.CountAsync(l => l.Status == ListingStatus.PendingReview, ct),
        await db.Listings.CountAsync(l => l.Status == ListingStatus.Active, ct),
        await db.ListingReports.CountAsync(r => r.Status == ReportStatus.Open, ct),
        await db.Users.CountAsync(ct),
        await db.Agencies.CountAsync(ct));

    /// <summary>The review queue, oldest submission first.</summary>
    [HttpGet("listings")]
    public Task<PagedResult<ListingSummaryDto>> Listings(
        ListingStatus status = ListingStatus.PendingReview, int page = 1, int pageSize = 50, CancellationToken ct = default) =>
        db.Listings.AsNoTracking()
            .Where(l => l.Status == status)
            .OrderBy(l => l.SubmittedAt).ThenBy(l => l.CreatedAt)
            .ToPageAsync(page, pageSize, storage, ct);

    [HttpPost("listings/{id:guid}/approve")]
    public async Task<IActionResult> Approve(Guid id, CancellationToken ct)
    {
        var listing = await db.Listings.Include(l => l.Owner).FirstOrDefaultAsync(l => l.Id == id, ct);
        if (listing is null) return NotFound();
        listing.Approve(clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        await email.SendAsync(listing.Owner.Email, $"Your listing \"{listing.Title}\" is live",
            $"<p>Your listing <a href=\"{Link(listing.Id)}\">{WebUtility.HtmlEncode(listing.Title)}</a> was approved and is now visible. " +
            $"It stays up until {listing.ExpiresAt:dd.MM.yyyy}; you can renew it in the last week.</p>", ct);
        return NoContent();
    }

    [HttpPost("listings/{id:guid}/reject")]
    public async Task<IActionResult> Reject(Guid id, RejectRequest request, CancellationToken ct)
    {
        var listing = await db.Listings.Include(l => l.Owner).FirstOrDefaultAsync(l => l.Id == id, ct);
        if (listing is null) return NotFound();
        listing.Reject(request.Reason.Trim());
        await db.SaveChangesAsync(ct);
        await NotifyRejected(listing, ct);
        return NoContent();
    }

    [HttpGet("reports")]
    public async Task<IReadOnlyList<ReportDto>> Reports(ReportStatus status = ReportStatus.Open, CancellationToken ct = default) =>
        await db.ListingReports.AsNoTracking()
            .Where(r => r.Status == status)
            .OrderByDescending(r => r.CreatedAt)
            .Take(200)
            .Select(r => new ReportDto(
                r.Id, r.ListingId, r.Listing.Title, r.Listing.Status, r.Reason, r.Comment,
                db.Users.Where(u => u.Id == r.ReporterId).Select(u => u.Email).First(),
                r.Status, r.CreatedAt,
                db.ListingReports.Count(o => o.ListingId == r.ListingId && o.Status == ReportStatus.Open)))
            .ToListAsync(ct);

    /// <summary>Resolves the report. With RemoveListing, the listing is taken down and every open report on it is closed.</summary>
    [HttpPost("reports/{id:guid}/resolve")]
    public async Task<IActionResult> Resolve(Guid id, ResolveReportRequest request, CancellationToken ct)
    {
        var report = await db.ListingReports.Include(r => r.Listing).ThenInclude(l => l.Owner)
            .FirstOrDefaultAsync(r => r.Id == id, ct);
        if (report is null) return NotFound();
        var now = clock.GetUtcNow();

        if (request.RemoveListing)
        {
            var listing = report.Listing;
            if (listing.Status is ListingStatus.Active or ListingStatus.PendingReview)
            {
                listing.Reject(string.IsNullOrWhiteSpace(request.Note) ? $"Removed after a report: {report.Reason}" : request.Note.Trim());
                await NotifyRejected(listing, ct);
            }
            var open = await db.ListingReports.Where(r => r.ListingId == listing.Id && r.Status == ReportStatus.Open).ToListAsync(ct);
            foreach (var r in open)
            {
                r.Status = ReportStatus.ListingRemoved;
                r.ResolvedAt = now;
            }
        }
        else
        {
            report.Status = ReportStatus.Dismissed;
            report.ResolvedAt = now;
        }

        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    private string Link(Guid listingId) => $"{emailOptions.Value.AppBaseUrl.TrimEnd('/')}/listings/{listingId}";

    private Task NotifyRejected(Listing listing, CancellationToken ct) =>
        email.SendAsync(listing.Owner.Email, $"Your listing \"{listing.Title}\" needs changes",
            $"<p>Your listing <a href=\"{Link(listing.Id)}\">{WebUtility.HtmlEncode(listing.Title)}</a> was not approved.</p>" +
            $"<p>Reason: {WebUtility.HtmlEncode(listing.ModerationNote)}</p><p>You can edit it and submit it again.</p>", ct);
}
