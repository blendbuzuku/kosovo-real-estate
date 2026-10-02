namespace RealEstate.Api.Domain;

/// <summary>
/// Search filters. Used for the search endpoint (bound from the query string) and stored
/// as jsonb on saved searches, so alerts match exactly what the user saw.
/// </summary>
public record ListingSearchCriteria
{
    public DealType? DealType { get; init; }
    public PropertyType? PropertyType { get; init; }
    public string? City { get; init; }
    public string? Neighborhood { get; init; }
    public string? Q { get; init; }

    public decimal? MinPrice { get; init; }
    public decimal? MaxPrice { get; init; }
    public decimal? MinArea { get; init; }
    public decimal? MaxArea { get; init; }
    public int? MinRooms { get; init; }
    public int? MaxRooms { get; init; }
    public int? MinFloor { get; init; }
    public int? MaxFloor { get; init; }
    public int? MinYearBuilt { get; init; }
    public HeatingType? Heating { get; init; }
    public bool? HasParking { get; init; }
    public bool? IsFurnished { get; init; }
    public bool? HasElevator { get; init; }

    /// <summary>Only listings that are legalized or don't need it.</summary>
    public bool? LegalizedOnly { get; init; }
    public bool? HasCadastreCertificate { get; init; }
    public bool? HasConstructionPermit { get; init; }

    /// <summary>Radius search: within RadiusKm of (Lat, Lng).</summary>
    public double? Lat { get; init; }
    public double? Lng { get; init; }
    public double? RadiusKm { get; init; }

    /// <summary>Map viewport: minLng,minLat,maxLng,maxLat.</summary>
    public string? Bbox { get; init; }

    public Guid? AgencyId { get; init; }
    public Guid? OwnerId { get; init; }

    public ListingSort Sort { get; init; } = ListingSort.Newest;
}
