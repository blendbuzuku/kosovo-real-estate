using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RealEstate.Api.Data;
using RealEstate.Api.Domain;
using RealEstate.Api.Features.Listings;
using RealEstate.Api.Infrastructure;

namespace RealEstate.Api.Features.Accounts;

public record BusinessProfileDto(
    Guid Id, string Slug, string Name, BusinessKind Kind, string? Description, string? Website,
    string? Municipality, string? Address, string? Phone, int ActiveListings, DateTimeOffset MemberSince);

public record UpdateBusinessRequest(
    [Required, StringLength(120, MinimumLength = 2)] string Name,
    BusinessKind Kind,
    [MaxLength(2000)] string? Description,
    [Url, MaxLength(200)] string? Website,
    [MaxLength(64)] string? Municipality,
    [MaxLength(200)] string? Address);

/// <summary>Agencies, developers, car dealers and rent-a-car companies, each with a public page.</summary>
[ApiController]
[Route("api/businesses")]
public class BusinessesController(AppDbContext db, IFileStorage storage) : ControllerBase
{
    [HttpGet]
    public async Task<IReadOnlyList<BusinessProfileDto>> List(BusinessKind? kind, string? municipality, CancellationToken ct)
    {
        var q = db.Businesses.AsQueryable();
        if (kind is { } k) q = q.Where(b => b.Kind == k);
        if (!string.IsNullOrWhiteSpace(municipality)) q = q.Where(b => b.Municipality == municipality);
        return (await Profiles(q.OrderBy(b => b.Name)).ToListAsync(ct))
            .OrderByDescending(b => b.ActiveListings).ToList();
    }

    [HttpGet("{slug}")]
    public async Task<ActionResult<BusinessProfileDto>> Get(string slug, CancellationToken ct)
    {
        var business = await Profiles(db.Businesses.Where(b => b.Slug == slug)).FirstOrDefaultAsync(ct);
        return business is null ? NotFound() : business;
    }

    [HttpGet("{slug}/listings")]
    public async Task<ActionResult<PagedResult<ListingSummaryDto>>> Listings(
        string slug, [FromQuery] ListingSearchCriteria criteria, int page = 1, int pageSize = 20, CancellationToken ct = default)
    {
        var businessId = await db.Businesses.Where(b => b.Slug == slug).Select(b => (Guid?)b.Id).FirstOrDefaultAsync(ct);
        if (businessId is null) return NotFound();
        return await db.Listings.AsNoTracking()
            .Where(l => l.Status == ListingStatus.Active)
            .Filter(criteria.WithFieldFilters(Request.Query) with { BusinessId = businessId })
            .Sort(criteria.Sort)
            .ToPageAsync(page, pageSize, storage, ct);
    }

    [HttpPut("~/api/me/business")]
    [Authorize]
    public async Task<ActionResult<BusinessProfileDto>> UpdateMine(UpdateBusinessRequest request, CancellationToken ct)
    {
        var userId = User.UserId();
        var business = await db.Businesses.FirstOrDefaultAsync(b => b.UserId == userId, ct);
        if (business is null) return NotFound();
        business.Name = request.Name.Trim();
        business.Kind = request.Kind;
        business.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
        business.Website = string.IsNullOrWhiteSpace(request.Website) ? null : request.Website.Trim();
        business.Municipality = Meta.Locations.Find(request.Municipality)?.Name;
        business.Address = string.IsNullOrWhiteSpace(request.Address) ? null : request.Address.Trim();
        await db.SaveChangesAsync(ct);
        return await Profiles(db.Businesses.Where(b => b.Id == business.Id)).FirstAsync(ct);
    }

    private IQueryable<BusinessProfileDto> Profiles(IQueryable<Business> q) =>
        q.Select(b => new BusinessProfileDto(
            b.Id, b.Slug, b.Name, b.Kind, b.Description, b.Website, b.Municipality, b.Address, b.User.Phone,
            db.Listings.Count(l => l.OwnerId == b.UserId && l.Status == ListingStatus.Active),
            b.User.CreatedAt));
}
