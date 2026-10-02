using System.ComponentModel.DataAnnotations;
using System.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using RealEstate.Api.Data;
using RealEstate.Api.Domain;
using RealEstate.Api.Infrastructure;

namespace RealEstate.Api.Features.Messaging;

public record SendMessageRequest([Required, StringLength(4000, MinimumLength = 1)] string Body);

public record MessageDto(Guid Id, Guid SenderId, string Body, DateTimeOffset SentAt, bool IsMine, DateTimeOffset? ReadAt);

public record ConversationDto(
    Guid Id,
    Guid ListingId,
    string ListingTitle,
    string OtherPartyName,
    string? LastMessage,
    DateTimeOffset LastMessageAt,
    int UnreadCount,
    bool IAmOwner);

[ApiController]
[Authorize]
public class ConversationsController(
    AppDbContext db, TimeProvider clock, IEmailSender email, IOptions<EmailOptions> emailOptions) : ControllerBase
{
    /// <summary>Message the owner of a listing. Reuses the existing conversation for this listing if there is one.</summary>
    [HttpPost("api/listings/{listingId:guid}/messages")]
    [EnableRateLimiting("messages")]
    public async Task<ActionResult<ConversationDto>> Start(Guid listingId, SendMessageRequest request, CancellationToken ct)
    {
        var userId = User.UserId();
        var listing = await db.Listings.Include(l => l.Owner)
            .FirstOrDefaultAsync(l => l.Id == listingId && l.Status == ListingStatus.Active, ct);
        if (listing is null) return NotFound();
        if (listing.OwnerId == userId) return Problem("You can't message yourself about your own listing.", statusCode: 400);

        var now = clock.GetUtcNow();
        var conversation = await db.Conversations.FirstOrDefaultAsync(c => c.ListingId == listingId && c.SeekerId == userId, ct);
        if (conversation is null)
        {
            conversation = new Conversation { ListingId = listingId, SeekerId = userId, OwnerId = listing.OwnerId, CreatedAt = now };
            db.Conversations.Add(conversation);
        }

        await AddMessage(conversation, userId, request.Body, now, ct);
        await NotifyRecipient(listing.Owner, listing.Title, conversation.Id, ct);
        return await Conversations(userId, db.Conversations.Where(c => c.Id == conversation.Id)).FirstAsync(ct);
    }

    [HttpGet("api/me/conversations")]
    public async Task<IReadOnlyList<ConversationDto>> List(CancellationToken ct) =>
        await Conversations(User.UserId(), db.Conversations.OrderByDescending(c => c.LastMessageAt)).ToListAsync(ct);

    [HttpGet("api/me/conversations/unread")]
    public async Task<int> UnreadCount(CancellationToken ct)
    {
        var userId = User.UserId();
        return await db.Messages.CountAsync(m =>
            m.ReadAt == null && m.SenderId != userId &&
            db.Conversations.Any(c => c.Id == m.ConversationId && (c.SeekerId == userId || c.OwnerId == userId)), ct);
    }

    /// <summary>Messages in a conversation, oldest first. Marks the other party's messages as read.</summary>
    [HttpGet("api/conversations/{id:guid}/messages")]
    public async Task<ActionResult<IReadOnlyList<MessageDto>>> Messages(Guid id, CancellationToken ct)
    {
        var userId = User.UserId();
        if (!await IsParticipant(id, userId, ct)) return NotFound();

        await db.Messages.Where(m => m.ConversationId == id && m.SenderId != userId && m.ReadAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(m => m.ReadAt, clock.GetUtcNow()), ct);

        return await db.Messages.AsNoTracking()
            .Where(m => m.ConversationId == id)
            .OrderBy(m => m.SentAt)
            .Select(m => new MessageDto(m.Id, m.SenderId, m.Body, m.SentAt, m.SenderId == userId, m.ReadAt))
            .ToListAsync(ct);
    }

    [HttpPost("api/conversations/{id:guid}/messages")]
    [EnableRateLimiting("messages")]
    public async Task<ActionResult<MessageDto>> Reply(Guid id, SendMessageRequest request, CancellationToken ct)
    {
        var userId = User.UserId();
        var conversation = await db.Conversations
            .Include(c => c.Listing).Include(c => c.Seeker).Include(c => c.Owner)
            .FirstOrDefaultAsync(c => c.Id == id && (c.SeekerId == userId || c.OwnerId == userId), ct);
        if (conversation is null) return NotFound();

        var message = await AddMessage(conversation, userId, request.Body, clock.GetUtcNow(), ct);
        var recipient = conversation.SeekerId == userId ? conversation.Owner : conversation.Seeker;
        await NotifyRecipient(recipient, conversation.Listing.Title, conversation.Id, ct);
        return new MessageDto(message.Id, message.SenderId, message.Body, message.SentAt, true, null);
    }

    private async Task<Message> AddMessage(Conversation conversation, Guid senderId, string body, DateTimeOffset now, CancellationToken ct)
    {
        var message = new Message { ConversationId = conversation.Id, SenderId = senderId, Body = body.Trim(), SentAt = now };
        db.Messages.Add(message);
        conversation.LastMessageAt = now;
        await db.SaveChangesAsync(ct);
        return message;
    }

    private async Task NotifyRecipient(User recipient, string listingTitle, Guid conversationId, CancellationToken ct)
    {
        var link = $"{emailOptions.Value.AppBaseUrl.TrimEnd('/')}/messages/{conversationId}";
        await email.SendAsync(recipient.Email,
            $"New message about \"{listingTitle}\"",
            $"<p>You have a new message about <strong>{WebUtility.HtmlEncode(listingTitle)}</strong>.</p>" +
            $"<p><a href=\"{link}\">Read and reply</a></p>", ct);
    }

    private Task<bool> IsParticipant(Guid conversationId, Guid userId, CancellationToken ct) =>
        db.Conversations.AnyAsync(c => c.Id == conversationId && (c.SeekerId == userId || c.OwnerId == userId), ct);

    /// <summary>Filter and order <paramref name="source"/> before calling: EF can't translate either after the DTO projection.</summary>
    private static IQueryable<ConversationDto> Conversations(Guid userId, IQueryable<Conversation> source) =>
        source.AsNoTracking()
            .Where(c => c.SeekerId == userId || c.OwnerId == userId)
            .Select(c => new ConversationDto(
                c.Id,
                c.ListingId,
                c.Listing.Title,
                c.OwnerId == userId ? c.Seeker.DisplayName : (c.Owner.Agency != null ? c.Owner.Agency.Name : c.Owner.DisplayName),
                c.Messages.OrderByDescending(m => m.SentAt).Select(m => m.Body).FirstOrDefault(),
                c.LastMessageAt,
                c.Messages.Count(m => m.SenderId != userId && m.ReadAt == null),
                c.OwnerId == userId));
}
