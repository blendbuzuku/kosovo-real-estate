using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using RealEstate.Api.Domain;
using RealEstate.Api.Infrastructure;

namespace RealEstate.Api.Features.Listings;

public record PagedResult<T>(IReadOnlyList<T> Items, int Page, int PageSize, int Total);

public record SellerSummaryDto(string Name, bool IsBusiness, BusinessKind? Kind, string? Slug);

public record ListingSummaryDto(
    Guid Id,
    string Category,
    DealType DealType,
    string Title,
    decimal PriceEur,
    bool Negotiable,
    decimal? PricePerM2,
    string Municipality,
    string? Place,
    double Lat,
    double Lng,
    string? ThumbnailUrl,
    int PhotoCount,
    JsonElement Attributes,
    SellerSummaryDto Seller,
    ListingStatus Status,
    DateTimeOffset? PublishedAt,
    DateTimeOffset? ExpiresAt);

public record MapPinDto(Guid Id, double Lat, double Lng, decimal PriceEur, DealType DealType, string Category);

public record PhotoDto(Guid Id, string Url, string ThumbnailUrl, int Width, int Height);

public record ListingOwnerDto(
    Guid Id, string DisplayName, bool HasPhone, DateTimeOffset MemberSince,
    string? BusinessSlug, string? BusinessName, BusinessKind? BusinessKind);

public record ListingDetailDto(
    Guid Id,
    string Category,
    DealType DealType,
    string Title,
    string Description,
    decimal PriceEur,
    bool Negotiable,
    decimal? PricePerM2,
    JsonElement Attributes,
    string Municipality,
    string? Place,
    string? Address,
    double Lat,
    double Lng,
    IReadOnlyList<PhotoDto> Photos,
    ListingOwnerDto Owner,
    ListingStatus Status,
    string? ModerationNote,
    DateTimeOffset CreatedAt,
    DateTimeOffset? PublishedAt,
    DateTimeOffset? ExpiresAt,
    bool CanRenew,
    int ViewCount,
    bool IsFavorite,
    bool IsMine);

public record ListingUpsertRequest
{
    [Required, MaxLength(40)] public string Category { get; init; } = "";
    public DealType DealType { get; init; }
    [Required, StringLength(140, MinimumLength = 5)] public string Title { get; init; } = "";
    [Required, StringLength(5000, MinimumLength = 20)] public string Description { get; init; } = "";
    [Range(1, 100_000_000)] public decimal PriceEur { get; init; }
    public bool Negotiable { get; init; }
    [Required, MaxLength(64)] public string Municipality { get; init; } = "";
    [MaxLength(80)] public string? Place { get; init; }
    [MaxLength(200)] public string? Address { get; init; }
    /// <summary>Exact pin. Optional: without it the ad is placed at the municipality's centre.</summary>
    [Range(41.5, 43.5)] public double? Lat { get; init; }
    [Range(19.8, 21.9)] public double? Lng { get; init; }
    public Dictionary<string, JsonElement>? Attributes { get; init; }
}

public record ReorderPhotosRequest([Required] IReadOnlyList<Guid> PhotoIds);

public record PhoneDto(string Phone);

public static class ListingMapping
{
    public static JsonElement ParseAttributes(string json)
    {
        using var doc = JsonDocument.Parse(string.IsNullOrEmpty(json) ? "{}" : json);
        return doc.RootElement.Clone();
    }

    /// <summary>Row shape the database can produce in one query; photo URLs are added afterwards.</summary>
    public record SummaryRow(Listing L, string? ThumbKey, int PhotoCount, string OwnerName, string? BusinessName, BusinessKind? BusinessKind, string? BusinessSlug);

    public static IQueryable<SummaryRow> SelectSummaryRows(this IQueryable<Listing> q) =>
        q.Select(l => new SummaryRow(
            l,
            l.Photos.OrderBy(p => p.SortOrder).Select(p => p.ThumbKey).FirstOrDefault(),
            l.Photos.Count,
            l.Owner.DisplayName,
            l.Owner.Business != null ? l.Owner.Business.Name : null,
            l.Owner.Business != null ? l.Owner.Business.Kind : null,
            l.Owner.Business != null ? l.Owner.Business.Slug : null));

    public static ListingSummaryDto ToSummary(this SummaryRow row, IFileStorage storage)
    {
        var l = row.L;
        var seller = row.BusinessName is not null
            ? new SellerSummaryDto(row.BusinessName, true, row.BusinessKind, row.BusinessSlug)
            : new SellerSummaryDto(row.OwnerName, false, null, null);
        return new ListingSummaryDto(
            l.Id, l.Category, l.DealType, l.Title, l.PriceEur, l.Negotiable, l.PricePerM2,
            l.Municipality, l.Place, l.Location.Y, l.Location.X,
            row.ThumbKey is null ? null : storage.GetUrl(row.ThumbKey),
            row.PhotoCount, ParseAttributes(l.Attributes), seller, l.Status, l.PublishedAt, l.ExpiresAt);
    }

    public static async Task<PagedResult<ListingSummaryDto>> ToPageAsync(
        this IOrderedQueryable<Listing> q, int page, int pageSize, IFileStorage storage, CancellationToken ct)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);
        var total = await q.CountAsync(ct);
        var rows = await q.Skip((page - 1) * pageSize).Take(pageSize).SelectSummaryRows().ToListAsync(ct);
        return new PagedResult<ListingSummaryDto>(rows.Select(r => r.ToSummary(storage)).ToList(), page, pageSize, total);
    }
}
