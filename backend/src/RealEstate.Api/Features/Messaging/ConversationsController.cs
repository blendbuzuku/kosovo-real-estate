using System.ComponentModel.DataAnnotations;
using System.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using RealEstate.Api.Data;
using RealEstate.Api.Domain;
using RealEstate.Api.Features.Listings;
using RealEstate.Api.Infrastructure;

namespace RealEstate.Api.Features.Messaging;

public record SendMessageRequest([Required, StringLength(4000, MinimumLength = 1)] string Body);

public record BookingRequestBody(
    DateOnly CheckIn,
    DateOnly CheckOut,
    [Range(1, 50)] int? Guests,
    [MaxLength(2000)] string? Message);

public record BookingDto(DateOnly From, DateOnly To, int? Guests, int Units, decimal TotalEur);

public record MessageDto(Guid Id, Guid SenderId, string Body, DateTimeOffset SentAt, bool IsMine, DateTimeOffset? ReadAt, BookingDto? Booking);

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
        var conversation = await FindOrStart(listing, userId, now, ct);
        await AddMessage(conversation, userId, request.Body, now, ct);
        await NotifyRecipient(listing.Owner, listing.Title, conversation.Id, ct);
        return await Conversations(userId, db.Conversations.Where(c => c.Id == conversation.Id)).FirstAsync(ct);
    }

    /// <summary>
    /// Ask for specific dates on a per-night stay or a per-day rental. It arrives as a message with the
    /// dates and total attached; the owner confirms by replying.
    /// </summary>
    [HttpPost("api/listings/{listingId:guid}/booking-requests")]
    [EnableRateLimiting("messages")]
    public async Task<ActionResult<ConversationDto>> RequestBooking(Guid listingId, BookingRequestBody request, CancellationToken ct)
    {
        var userId = User.UserId();
        var listing = await db.Listings.Include(l => l.Owner)
            .FirstOrDefaultAsync(l => l.Id == listingId && l.Status == ListingStatus.Active, ct);
        if (listing is null) return NotFound();
        if (listing.OwnerId == userId) return Problem("You can't book your own listing.", statusCode: 400);
        if (listing.DealType is not (DealType.RentNightly or DealType.RentDaily))
            return Problem("Only per-night and per-day rentals take booking requests. Send a message instead.", statusCode: 400);

        var nightly = listing.DealType == DealType.RentNightly;
        var unit = nightly ? "night" : "day";
        var attributes = ListingMapping.ParseAttributes(listing.Attributes);
        var errors = new Dictionary<string, string[]>();
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        var units = request.CheckOut.DayNumber - request.CheckIn.DayNumber;

        if (request.CheckIn < today) errors["checkIn"] = ["The start date is in the past."];
        if (units < 1) errors["checkOut"] = [$"The end date must be after the start date."];
        else if (units > 90) errors["checkOut"] = ["Booking requests can cover at most 90 days."];
        else if (Number(attributes, "minNights") is { } minNights && units < minNights)
            errors["checkOut"] = [$"This place has a minimum stay of {minNights} nights."];
        if (nightly)
        {
            if (request.Guests is null) errors["guests"] = ["How many guests?"];
            else if (Number(attributes, "maxGuests") is { } maxGuests && request.Guests > maxGuests)
                errors["guests"] = [$"This place sleeps at most {maxGuests} guests."];
        }
        if (errors.Count > 0) return ValidationProblem(new ValidationProblemDetails(errors));

        var booking = new BookingRequest
        {
            From = request.CheckIn,
            To = request.CheckOut,
            Guests = nightly ? request.Guests : null,
            Units = units,
            TotalEur = units * listing.PriceEur
        };
        var summary = $"Booking request: {request.CheckIn:d MMM} to {request.CheckOut:d MMM yyyy}, {units} {unit}{(units == 1 ? "" : "s")}" +
                      (booking.Guests is { } g ? $", {g} guest{(g == 1 ? "" : "s")}" : "") +
                      $", €{booking.TotalEur:N0} in total.";
        var body = string.IsNullOrWhiteSpace(request.Message) ? summary : $"{summary}\n\n{request.Message.Trim()}";

        var now = clock.GetUtcNow();
        var conversation = await FindOrStart(listing, userId, now, ct);
        await AddMessage(conversation, userId, body, now, ct, booking);
        await NotifyRecipient(listing.Owner, listing.Title, conversation.Id, ct);
        return await Conversations(userId, db.Conversations.Where(c => c.Id == conversation.Id)).FirstAsync(ct);
    }

    private static decimal? Number(System.Text.Json.JsonElement attributes, string key) =>
        attributes.TryGetProperty(key, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.Number ? v.GetDecimal() : null;

    private async Task<Conversation> FindOrStart(Listing listing, Guid userId, DateTimeOffset now, CancellationToken ct)
    {
        var conversation = await db.Conversations.FirstOrDefaultAsync(c => c.ListingId == listing.Id && c.SeekerId == userId, ct);
        if (conversation is null)
        {
            conversation = new Conversation { ListingId = listing.Id, SeekerId = userId, OwnerId = listing.OwnerId, CreatedAt = now };
            db.Conversations.Add(conversation);
        }
        return conversation;
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
            .Select(m => new MessageDto(m.Id, m.SenderId, m.Body, m.SentAt, m.SenderId == userId, m.ReadAt,
                m.Booking == null ? null : new BookingDto(m.Booking.From, m.Booking.To, m.Booking.Guests, m.Booking.Units, m.Booking.TotalEur)))
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
        return new MessageDto(message.Id, message.SenderId, message.Body, message.SentAt, true, null, null);
    }

    private async Task<Message> AddMessage(
        Conversation conversation, Guid senderId, string body, DateTimeOffset now, CancellationToken ct, BookingRequest? booking = null)
    {
        var message = new Message { ConversationId = conversation.Id, SenderId = senderId, Body = body.Trim(), SentAt = now, Booking = booking };
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
                c.OwnerId == userId ? c.Seeker.DisplayName : (c.Owner.Business != null ? c.Owner.Business.Name : c.Owner.DisplayName),
                c.Messages.OrderByDescending(m => m.SentAt).Select(m => m.Body).FirstOrDefault(),
                c.LastMessageAt,
                c.Messages.Count(m => m.SenderId != userId && m.ReadAt == null),
                c.OwnerId == userId));
}
