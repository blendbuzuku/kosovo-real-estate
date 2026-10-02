using NetTopologySuite.Geometries;

namespace RealEstate.Api.Domain;

public class User
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string Email { get; set; }
    public string PasswordHash { get; set; } = "";
    public required string DisplayName { get; set; }
    public string? Phone { get; set; }
    public UserRole Role { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public Agency? Agency { get; set; }
}

public class Agency
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;
    public required string Slug { get; set; }
    public required string Name { get; set; }
    public string? Description { get; set; }
    public string? Website { get; set; }
    public string? City { get; set; }
    public string? LogoKey { get; set; }
}

/// <summary>
/// Legal paperwork for the property. Kosovo buyers care a lot about this, since many
/// buildings were put up without permits and only later (or never) legalized.
/// </summary>
public class LegalStatus
{
    /// <summary>Leje ndërtimi.</summary>
    public bool? HasConstructionPermit { get; set; }

    /// <summary>Certifikata e pronësisë / fletë poseduese from the cadastre.</summary>
    public bool? HasCadastreCertificate { get; set; }

    public LegalizationStatus Legalization { get; set; } = LegalizationStatus.Unknown;

    public string? Notes { get; set; }
}

public partial class Listing
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OwnerId { get; set; }
    public User Owner { get; set; } = null!;

    public required string Title { get; set; }
    public required string Description { get; set; }
    public PropertyType PropertyType { get; set; }
    public DealType DealType { get; set; }

    public decimal PriceEur { get; set; }
    public decimal AreaM2 { get; set; }
    /// <summary>Stored generated column, so sorting by €/m² can use an index.</summary>
    public decimal? PricePerM2 { get; private set; }

    public int? Rooms { get; set; }
    public int? Bathrooms { get; set; }
    public int? Floor { get; set; }
    public int? TotalFloors { get; set; }
    public int? YearBuilt { get; set; }
    public HeatingType Heating { get; set; }
    public bool HasParking { get; set; }
    public bool IsFurnished { get; set; }
    public bool HasElevator { get; set; }
    public bool HasBalcony { get; set; }

    public required string City { get; set; }
    public string? Neighborhood { get; set; }
    public string? Address { get; set; }
    public required Point Location { get; set; }

    public LegalStatus Legal { get; set; } = new();

    public ListingStatus Status { get; set; } = ListingStatus.Draft;
    public string? ModerationNote { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? SubmittedAt { get; set; }
    public DateTimeOffset? PublishedAt { get; set; }
    public DateTimeOffset? ExpiresAt { get; set; }
    public DateTimeOffset? ExpiryReminderSentAt { get; set; }

    public int ViewCount { get; set; }
    public int PhoneRevealCount { get; set; }

    public List<ListingPhoto> Photos { get; set; } = [];
}

public class ListingPhoto
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ListingId { get; set; }
    public required string LargeKey { get; set; }
    public required string ThumbKey { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public int SortOrder { get; set; }
}

public class Favorite
{
    public Guid UserId { get; set; }
    public Guid ListingId { get; set; }
    public Listing Listing { get; set; } = null!;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class SavedSearch
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;
    public required string Name { get; set; }
    public required ListingSearchCriteria Criteria { get; set; }
    public bool EmailAlerts { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    /// <summary>Listings published after this point have not been emailed yet.</summary>
    public DateTimeOffset LastAlertedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class Conversation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ListingId { get; set; }
    public Listing Listing { get; set; } = null!;
    public Guid SeekerId { get; set; }
    public User Seeker { get; set; } = null!;
    public Guid OwnerId { get; set; }
    public User Owner { get; set; } = null!;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset LastMessageAt { get; set; } = DateTimeOffset.UtcNow;
    public List<Message> Messages { get; set; } = [];
}

public class Message
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ConversationId { get; set; }
    public Guid SenderId { get; set; }
    public required string Body { get; set; }
    public DateTimeOffset SentAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? ReadAt { get; set; }
}

public class ListingReport
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ListingId { get; set; }
    public Listing Listing { get; set; } = null!;
    public Guid ReporterId { get; set; }
    public ReportReason Reason { get; set; }
    public string? Comment { get; set; }
    public ReportStatus Status { get; set; } = ReportStatus.Open;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? ResolvedAt { get; set; }
}
