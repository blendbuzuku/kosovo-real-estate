using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;
using RealEstate.Api.Domain;
using RealEstate.Api.Infrastructure;

namespace RealEstate.Api.Features.Listings;

public record PagedResult<T>(IReadOnlyList<T> Items, int Page, int PageSize, int Total);

public record ListingSummaryDto(
    Guid Id,
    string Title,
    PropertyType PropertyType,
    DealType DealType,
    decimal PriceEur,
    decimal AreaM2,
    decimal? PricePerM2,
    int? Rooms,
    int? Floor,
    string City,
    string? Neighborhood,
    double Lat,
    double Lng,
    string? ThumbnailUrl,
    int PhotoCount,
    LegalizationStatus Legalization,
    bool? HasCadastreCertificate,
    string? AgencyName,
    ListingStatus Status,
    DateTimeOffset? PublishedAt,
    DateTimeOffset? ExpiresAt);

public record MapPinDto(Guid Id, double Lat, double Lng, decimal PriceEur, DealType DealType, PropertyType PropertyType);

public record PhotoDto(Guid Id, string Url, string ThumbnailUrl, int Width, int Height);

public record ListingOwnerDto(Guid Id, string DisplayName, bool IsAgency, string? AgencySlug, string? AgencyName, bool HasPhone);

public record LegalStatusDto(
    bool? HasConstructionPermit,
    bool? HasCadastreCertificate,
    LegalizationStatus Legalization,
    [MaxLength(1000)] string? Notes);

public record ListingDetailDto(
    Guid Id,
    string Title,
    string Description,
    PropertyType PropertyType,
    DealType DealType,
    decimal PriceEur,
    decimal AreaM2,
    decimal? PricePerM2,
    int? Rooms,
    int? Bathrooms,
    int? Floor,
    int? TotalFloors,
    int? YearBuilt,
    HeatingType Heating,
    bool HasParking,
    bool IsFurnished,
    bool HasElevator,
    bool HasBalcony,
    string City,
    string? Neighborhood,
    string? Address,
    double Lat,
    double Lng,
    LegalStatusDto Legal,
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
    [Required, StringLength(140, MinimumLength = 5)] public string Title { get; init; } = "";
    [Required, StringLength(5000, MinimumLength = 20)] public string Description { get; init; } = "";
    public PropertyType PropertyType { get; init; }
    public DealType DealType { get; init; }
    [Range(1, 100_000_000)] public decimal PriceEur { get; init; }
    [Range(1, 1_000_000)] public decimal AreaM2 { get; init; }
    [Range(0, 50)] public int? Rooms { get; init; }
    [Range(0, 20)] public int? Bathrooms { get; init; }
    [Range(-3, 100)] public int? Floor { get; init; }
    [Range(1, 100)] public int? TotalFloors { get; init; }
    [Range(1800, 2100)] public int? YearBuilt { get; init; }
    public HeatingType Heating { get; init; }
    public bool HasParking { get; init; }
    public bool IsFurnished { get; init; }
    public bool HasElevator { get; init; }
    public bool HasBalcony { get; init; }
    [Required, MaxLength(64)] public string City { get; init; } = "";
    [MaxLength(64)] public string? Neighborhood { get; init; }
    [MaxLength(200)] public string? Address { get; init; }
    // Roughly Kosovo plus a margin, so a swapped lat/lng is caught.
    [Range(41.5, 43.5)] public double Lat { get; init; }
    [Range(19.8, 21.9)] public double Lng { get; init; }
    [Required] public LegalStatusDto Legal { get; init; } = new(null, null, LegalizationStatus.Unknown, null);
}

public record ReorderPhotosRequest([Required] IReadOnlyList<Guid> PhotoIds);

public record PhoneDto(string Phone);

public static class ListingMapping
{
    /// <summary>Row shape the database can produce in one query; photo URLs are added afterwards.</summary>
    public record SummaryRow(Listing L, string? ThumbKey, int PhotoCount, string? AgencyName);

    public static IQueryable<SummaryRow> SelectSummaryRows(this IQueryable<Listing> q) =>
        q.Select(l => new SummaryRow(
            l,
            l.Photos.OrderBy(p => p.SortOrder).Select(p => p.ThumbKey).FirstOrDefault(),
            l.Photos.Count,
            l.Owner.Agency != null ? l.Owner.Agency.Name : null));

    public static ListingSummaryDto ToSummary(this SummaryRow row, IFileStorage storage)
    {
        var l = row.L;
        return new ListingSummaryDto(
            l.Id, l.Title, l.PropertyType, l.DealType, l.PriceEur, l.AreaM2, l.PricePerM2, l.Rooms, l.Floor,
            l.City, l.Neighborhood, l.Location.Y, l.Location.X,
            row.ThumbKey is null ? null : storage.GetUrl(row.ThumbKey),
            row.PhotoCount, l.Legal.Legalization, l.Legal.HasCadastreCertificate,
            row.AgencyName, l.Status, l.PublishedAt, l.ExpiresAt);
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

    public static void Apply(this Listing l, ListingUpsertRequest r)
    {
        l.Title = r.Title.Trim();
        l.Description = r.Description.Trim();
        l.PropertyType = r.PropertyType;
        l.DealType = r.DealType;
        l.PriceEur = r.PriceEur;
        l.AreaM2 = r.AreaM2;
        l.Rooms = r.Rooms;
        l.Bathrooms = r.Bathrooms;
        l.Floor = r.Floor;
        l.TotalFloors = r.TotalFloors;
        l.YearBuilt = r.YearBuilt;
        l.Heating = r.Heating;
        l.HasParking = r.HasParking;
        l.IsFurnished = r.IsFurnished;
        l.HasElevator = r.HasElevator;
        l.HasBalcony = r.HasBalcony;
        l.City = r.City.Trim();
        l.Neighborhood = string.IsNullOrWhiteSpace(r.Neighborhood) ? null : r.Neighborhood.Trim();
        l.Address = string.IsNullOrWhiteSpace(r.Address) ? null : r.Address.Trim();
        l.Location = ListingQuery.PointAt(r.Lat, r.Lng);
        l.Legal = new LegalStatus
        {
            HasConstructionPermit = r.Legal.HasConstructionPermit,
            HasCadastreCertificate = r.Legal.HasCadastreCertificate,
            Legalization = r.Legal.Legalization,
            Notes = string.IsNullOrWhiteSpace(r.Legal.Notes) ? null : r.Legal.Notes.Trim()
        };
    }
}
