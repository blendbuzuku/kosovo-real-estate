using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RealEstate.Api.Data;
using RealEstate.Api.Domain;
using RealEstate.Api.Infrastructure;

namespace RealEstate.Api.Features.Moderation;

public record ReportListingRequest(ReportReason Reason, [MaxLength(1000)] string? Comment);

[ApiController]
[Authorize]
public class ReportsController(AppDbContext db, TimeProvider clock) : ControllerBase
{
    [HttpPost("api/listings/{listingId:guid}/reports")]
    public async Task<IActionResult> Report(Guid listingId, ReportListingRequest request, CancellationToken ct)
    {
        var userId = User.UserId();
        var ownerId = await db.Listings.Where(l => l.Id == listingId && l.Status == ListingStatus.Active)
            .Select(l => (Guid?)l.OwnerId).FirstOrDefaultAsync(ct);
        if (ownerId is null) return NotFound();
        if (ownerId == userId) return Problem("You can't report your own ad.", statusCode: 400);

        // One open report per user and listing; reporting again just updates it.
        var existing = await db.ListingReports.FirstOrDefaultAsync(
            r => r.ListingId == listingId && r.ReporterId == userId && r.Status == ReportStatus.Open, ct);
        if (existing is null)
        {
            db.ListingReports.Add(new ListingReport
            {
                ListingId = listingId,
                ReporterId = userId,
                Reason = request.Reason,
                Comment = request.Comment?.Trim(),
                CreatedAt = clock.GetUtcNow()
            });
        }
        else
        {
            existing.Reason = request.Reason;
            existing.Comment = request.Comment?.Trim();
        }
        await db.SaveChangesAsync(ct);
        return Accepted();
    }
}
