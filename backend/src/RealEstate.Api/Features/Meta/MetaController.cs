using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RealEstate.Api.Data;
using RealEstate.Api.Domain;

namespace RealEstate.Api.Features.Meta;

public record DealCountDto(DealType Deal, int Count);

public record CategoryDto(
    string Key, string Name, string Vertical, string Icon,
    IReadOnlyList<DealType> Deals, IReadOnlyList<FieldDef> Fields, IReadOnlyList<DealCountDto> Live);

[ApiController]
[Route("api/meta")]
public class MetaController(AppDbContext db) : ControllerBase
{
    /// <summary>Every category with its fields (drives the post form, filters and spec lists) and live ad counts.</summary>
    [HttpGet("categories")]
    [ResponseCache(Duration = 60)]
    public async Task<IReadOnlyList<CategoryDto>> CategoryList(CancellationToken ct)
    {
        var counts = await db.Listings.AsNoTracking()
            .Where(l => l.Status == ListingStatus.Active)
            .GroupBy(l => new { l.Category, l.DealType })
            .Select(g => new { g.Key.Category, g.Key.DealType, Count = g.Count() })
            .ToListAsync(ct);
        return Categories.All.Select(c => new CategoryDto(
            c.Key, c.Name, c.Vertical, c.Icon, c.Deals, c.Fields,
            c.Deals.Select(d => new DealCountDto(d, counts.FirstOrDefault(x => x.Category == c.Key && x.DealType == d)?.Count ?? 0)).ToList()
        )).ToList();
    }

    /// <summary>All 38 municipalities with their neighbourhoods and villages.</summary>
    [HttpGet("locations")]
    [ResponseCache(Duration = 3600)]
    public IReadOnlyList<Municipality> LocationList() => Locations.All;
}
