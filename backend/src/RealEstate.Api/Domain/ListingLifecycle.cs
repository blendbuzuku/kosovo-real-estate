namespace RealEstate.Api.Domain;

public class DomainException(string message) : Exception(message);

/// <summary>
/// Status transitions. Draft → PendingReview → Active → Expired/Archived, with Rejected
/// as a dead end that the owner can fix and resubmit.
/// </summary>
public partial class Listing
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromDays(60);
    /// <summary>Renewing is only offered close to expiry, so "expires unless renewed" keeps stale listings out.</summary>
    public static readonly TimeSpan RenewWindow = TimeSpan.FromDays(7);

    public bool IsEditable => Status is not ListingStatus.Archived;

    public bool CanRenew(DateTimeOffset now) =>
        Status == ListingStatus.Expired ||
        (Status == ListingStatus.Active && ExpiresAt is { } exp && exp - now <= RenewWindow);

    /// <summary>Called after the owner edits the listing. Live listings go back to review.</summary>
    public void MarkEdited(DateTimeOffset now)
    {
        if (!IsEditable) throw new DomainException("Archived listings can't be edited.");
        UpdatedAt = now;
        if (Status == ListingStatus.Active)
        {
            Status = ListingStatus.PendingReview;
            SubmittedAt = now;
        }
    }

    public void Submit(DateTimeOffset now)
    {
        if (Status is not (ListingStatus.Draft or ListingStatus.Rejected or ListingStatus.Expired))
            throw new DomainException($"A listing that is {Status} can't be submitted.");
        if (Photos.Count == 0 && (Categories.Find(Category)?.PhotosRequired ?? true))
            throw new DomainException("Add at least one photo before submitting.");
        Status = ListingStatus.PendingReview;
        SubmittedAt = now;
        ModerationNote = null;
    }

    public void Approve(DateTimeOffset now)
    {
        if (Status != ListingStatus.PendingReview)
            throw new DomainException("Only listings waiting for review can be approved.");
        Status = ListingStatus.Active;
        ModerationNote = null;
        PublishedAt ??= now;
        if (ExpiresAt is null || ExpiresAt <= now)
        {
            ExpiresAt = now + Lifetime;
            ExpiryReminderSentAt = null;
        }
    }

    public void Reject(string note)
    {
        if (Status is not (ListingStatus.PendingReview or ListingStatus.Active))
            throw new DomainException($"A listing that is {Status} can't be rejected.");
        Status = ListingStatus.Rejected;
        ModerationNote = note;
    }

    public void Renew(DateTimeOffset now)
    {
        if (!CanRenew(now))
            throw new DomainException($"Listings can be renewed in the last {RenewWindow.Days} days before they expire.");
        Status = ListingStatus.Active;
        ExpiresAt = now + Lifetime;
        ExpiryReminderSentAt = null;
    }

    public void Archive(DateTimeOffset now)
    {
        Status = ListingStatus.Archived;
        UpdatedAt = now;
    }

    public void Expire()
    {
        if (Status == ListingStatus.Active) Status = ListingStatus.Expired;
    }
}
