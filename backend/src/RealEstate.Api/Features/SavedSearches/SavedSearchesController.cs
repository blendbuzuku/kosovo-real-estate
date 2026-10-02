using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RealEstate.Api.Data;
using RealEstate.Api.Domain;
using RealEstate.Api.Infrastructure;

namespace RealEstate.Api.Features.SavedSearches;

public record SavedSearchDto(Guid Id, string Name, ListingSearchCriteria Criteria, bool EmailAlerts, DateTimeOffset CreatedAt);

public record SaveSearchRequest(
    [Required, StringLength(120, MinimumLength = 1)] string Name,
    [Required] ListingSearchCriteria Criteria,
    bool EmailAlerts = true);

[ApiController]
[Authorize]
[Route("api/me/saved-searches")]
public class SavedSearchesController(AppDbContext db, TimeProvider clock) : ControllerBase
{
    public const int MaxPerUser = 20;

    [HttpGet]
    public async Task<IReadOnlyList<SavedSearchDto>> List(CancellationToken ct)
    {
        var userId = User.UserId();
        return await db.SavedSearches.AsNoTracking()
            .Where(s => s.UserId == userId)
            .OrderByDescending(s => s.CreatedAt)
            .Select(s => new SavedSearchDto(s.Id, s.Name, s.Criteria, s.EmailAlerts, s.CreatedAt))
            .ToListAsync(ct);
    }

    [HttpPost]
    public async Task<ActionResult<SavedSearchDto>> Create(SaveSearchRequest request, CancellationToken ct)
    {
        var userId = User.UserId();
        if (await db.SavedSearches.CountAsync(s => s.UserId == userId, ct) >= MaxPerUser)
            return Problem($"You can keep up to {MaxPerUser} saved searches.", statusCode: 400);

        var now = clock.GetUtcNow();
        var search = new SavedSearch
        {
            UserId = userId,
            Name = request.Name.Trim(),
            Criteria = request.Criteria,
            EmailAlerts = request.EmailAlerts,
            CreatedAt = now,
            LastAlertedAt = now
        };
        db.SavedSearches.Add(search);
        await db.SaveChangesAsync(ct);
        return new SavedSearchDto(search.Id, search.Name, search.Criteria, search.EmailAlerts, search.CreatedAt);
    }

    [HttpPatch("{id:guid}")]
    public async Task<ActionResult<SavedSearchDto>> SetAlerts(Guid id, [FromQuery] bool emailAlerts, CancellationToken ct)
    {
        var userId = User.UserId();
        var search = await db.SavedSearches.FirstOrDefaultAsync(s => s.Id == id && s.UserId == userId, ct);
        if (search is null) return NotFound();
        search.EmailAlerts = emailAlerts;
        // Don't flood the user with everything that appeared while alerts were off.
        if (emailAlerts) search.LastAlertedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(ct);
        return new SavedSearchDto(search.Id, search.Name, search.Criteria, search.EmailAlerts, search.CreatedAt);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var userId = User.UserId();
        await db.SavedSearches.Where(s => s.Id == id && s.UserId == userId).ExecuteDeleteAsync(ct);
        return NoContent();
    }
}
