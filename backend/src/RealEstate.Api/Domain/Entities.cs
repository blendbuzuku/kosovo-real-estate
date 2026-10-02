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

    public Business? Business { get; set; }
}

/// <summary>Public profile for agencies, developers, car dealers and rent-a-car companies.</summary>
public class Business
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;
    public required string Slug { get; set; }
    public required string Name { get; set; }
    public BusinessKind Kind { get; set; }
    public string? Description { get; set; }
    public string? Website { get; set; }
    public string? Municipality { get; set; }
    public string? Address { get; set; }
}

/// <summary>
/// One ad in any category. The fields every ad has are columns; the category's own fields
/// (rooms, mileage, legal status…) live in <see cref="Attributes"/> as jsonb, validated against
/// <see cref="Categories"/>.
/// </summary>
public partial class Listing
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OwnerId { get; set; }
    public User Owner { get; set; } = null!;

    public required string Category { get; set; }
    public DealType DealType { get; set; }
    public required string Title { get; set; }
    public required string Description { get; set; }

    public decimal PriceEur { get; set; }
    public bool Negotiable { get; set; }
    /// <summary>Stored generated column from the areaM2 attribute, so €/m² sorting is cheap.</summary>
    public decimal? PricePerM2 { get; private set; }

    /// <summary>Category-specific values as a JSON object, e.g. {"areaM2":72,"rooms":2,"legalization":"Legalized"}.</summary>
    public string Attributes { get; set; } = "{}";

    public required string Municipality { get; set; }
    public string? Place { get; set; }
    public string? Address { get; set; }
    public required Point Location { get; set; }

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

    /// <summary>Set when the message is a booking request for a per-night or per-day rental.</summary>
    public BookingRequest? Booking { get; set; }
}

public class BookingRequest
{
    public DateOnly From { get; set; }
    public DateOnly To { get; set; }
    public int? Guests { get; set; }
    public int Units { get; set; }
    public decimal TotalEur { get; set; }
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
