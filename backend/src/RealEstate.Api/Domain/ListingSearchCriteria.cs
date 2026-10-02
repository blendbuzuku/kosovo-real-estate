namespace RealEstate.Api.Domain;

/// <summary>
/// Search filters. Bound from the query string for search and stored as jsonb on saved searches,
/// so alerts match exactly what the user saw.
/// </summary>
public record ListingSearchCriteria
{
    /// <summary>"property" or "vehicles": search a whole vertical when no category is picked.</summary>
    public string? Vertical { get; init; }
    public string? Category { get; init; }
    public DealType? DealType { get; init; }
    public string? Municipality { get; init; }
    public string? Place { get; init; }
    public string? Q { get; init; }

    public decimal? MinPrice { get; init; }
    public decimal? MaxPrice { get; init; }
    public SellerType? Seller { get; init; }

    /// <summary>Radius search: within RadiusKm of (Lat, Lng).</summary>
    public double? Lat { get; init; }
    public double? Lng { get; init; }
    public double? RadiusKm { get; init; }

    /// <summary>Map viewport: minLng,minLat,maxLng,maxLat.</summary>
    public string? Bbox { get; init; }

    public Guid? BusinessId { get; init; }
    public Guid? OwnerId { get; init; }

    /// <summary>
    /// Category field filters, keyed like the query string: "rooms.min", "mileageKm.max",
    /// "fuel" (comma-separated for several), "parking" ("true"), "model" (text contains).
    /// </summary>
    public Dictionary<string, string>? F { get; init; }

    public ListingSort Sort { get; init; } = ListingSort.Newest;
}
