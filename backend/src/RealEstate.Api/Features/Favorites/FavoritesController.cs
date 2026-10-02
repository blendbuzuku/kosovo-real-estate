using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RealEstate.Api.Data;
using RealEstate.Api.Domain;
using RealEstate.Api.Features.Listings;
using RealEstate.Api.Infrastructure;

namespace RealEstate.Api.Features.Favorites;

[ApiController]
[Authorize]
[Route("api/me/favorites")]
public class FavoritesController(AppDbContext db, IFileStorage storage) : ControllerBase
{
    /// <summary>Saved listings, newest first. Includes ones that have since expired, so the user sees what happened.</summary>
    [HttpGet]
    public async Task<IReadOnlyList<ListingSummaryDto>> List(CancellationToken ct)
    {
        var userId = User.UserId();
        var rows = await db.Favorites.AsNoTracking()
            .Where(f => f.UserId == userId)
            .OrderByDescending(f => f.CreatedAt)
            .Select(f => f.Listing)
            .Where(l => l.Status == ListingStatus.Active || l.Status == ListingStatus.Expired || l.Status == ListingStatus.Archived)
            .SelectSummaryRows()
            .ToListAsync(ct);
        return rows.Select(r => r.ToSummary(storage)).ToList();
    }

    [HttpGet("ids")]
    public async Task<IReadOnlyList<Guid>> Ids(CancellationToken ct)
    {
        var userId = User.UserId();
        return await db.Favorites.Where(f => f.UserId == userId).Select(f => f.ListingId).ToListAsync(ct);
    }

    [HttpPut("{listingId:guid}")]
    public async Task<IActionResult> Add(Guid listingId, CancellationToken ct)
    {
        var userId = User.UserId();
        if (!await db.Listings.AnyAsync(l => l.Id == listingId && l.Status == ListingStatus.Active, ct)) return NotFound();
        if (!await db.Favorites.AnyAsync(f => f.UserId == userId && f.ListingId == listingId, ct))
        {
            db.Favorites.Add(new Favorite { UserId = userId, ListingId = listingId });
            await db.SaveChangesAsync(ct);
        }
        return NoContent();
    }

    [HttpDelete("{listingId:guid}")]
    public async Task<IActionResult> Remove(Guid listingId, CancellationToken ct)
    {
        var userId = User.UserId();
        await db.Favorites.Where(f => f.UserId == userId && f.ListingId == listingId).ExecuteDeleteAsync(ct);
        return NoContent();
    }
}
