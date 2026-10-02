using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RealEstate.Api.Data;
using RealEstate.Api.Domain;
using RealEstate.Api.Features.Listings;
using RealEstate.Api.Infrastructure;

namespace RealEstate.Api.Features.Accounts;

public record AgencyProfileDto(
    Guid Id, string Slug, string Name, string? Description, string? Website, string? City,
    string? Phone, int ActiveListings, DateTimeOffset MemberSince);

public record UpdateAgencyRequest(
    [Required, StringLength(120, MinimumLength = 2)] string Name,
    [MaxLength(2000)] string? Description,
    [Url, MaxLength(200)] string? Website,
    [MaxLength(64)] string? City);

[ApiController]
[Route("api/agencies")]
public class AgenciesController(AppDbContext db, IFileStorage storage) : ControllerBase
{
    [HttpGet]
    public async Task<IReadOnlyList<AgencyProfileDto>> List(CancellationToken ct) =>
        (await Profiles(db.Agencies.OrderBy(a => a.Name)).ToListAsync(ct))
            .OrderByDescending(a => a.ActiveListings).ToList();

    [HttpGet("{slug}")]
    public async Task<ActionResult<AgencyProfileDto>> Get(string slug, CancellationToken ct)
    {
        var agency = await Profiles(db.Agencies.Where(a => a.Slug == slug)).FirstOrDefaultAsync(ct);
        return agency is null ? NotFound() : agency;
    }

    [HttpGet("{slug}/listings")]
    public async Task<ActionResult<PagedResult<ListingSummaryDto>>> Listings(
        string slug, [FromQuery] ListingSearchCriteria criteria, int page = 1, int pageSize = 20, CancellationToken ct = default)
    {
        var agencyId = await db.Agencies.Where(a => a.Slug == slug).Select(a => (Guid?)a.Id).FirstOrDefaultAsync(ct);
        if (agencyId is null) return NotFound();
        return await db.Listings.AsNoTracking()
            .Where(l => l.Status == ListingStatus.Active)
            .Filter(criteria with { AgencyId = agencyId })
            .Sort(criteria.Sort)
            .ToPageAsync(page, pageSize, storage, ct);
    }

    [HttpPut("~/api/me/agency")]
    [Authorize(Roles = nameof(UserRole.Agency))]
    public async Task<ActionResult<AgencyProfileDto>> UpdateMine(UpdateAgencyRequest request, CancellationToken ct)
    {
        var userId = User.UserId();
        var agency = await db.Agencies.FirstOrDefaultAsync(a => a.UserId == userId, ct);
        if (agency is null) return NotFound();
        agency.Name = request.Name.Trim();
        agency.Description = request.Description?.Trim();
        agency.Website = request.Website?.Trim();
        agency.City = request.City?.Trim();
        await db.SaveChangesAsync(ct);
        return (await Profiles(db.Agencies.Where(a => a.Id == agency.Id)).FirstAsync(ct));
    }

    private IQueryable<AgencyProfileDto> Profiles(IQueryable<Agency> q) =>
        q.Select(a => new AgencyProfileDto(
            a.Id, a.Slug, a.Name, a.Description, a.Website, a.City, a.User.Phone,
            db.Listings.Count(l => l.OwnerId == a.UserId && l.Status == ListingStatus.Active),
            a.User.CreatedAt));
}
