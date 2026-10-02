using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using RealEstate.Api.Data;
using RealEstate.Api.Domain;
using RealEstate.Api.Infrastructure;

namespace RealEstate.Api.Features.Messaging;

/// <summary>Starting conversations and adding messages, shared by plain messages, booking requests and job applications.</summary>
public class Inbox(AppDbContext db, IEmailSender email, IOptions<EmailOptions> emailOptions)
{
    /// <summary>The seeker's conversation about this listing, created (unsaved) if there isn't one yet.</summary>
    public async Task<Conversation> FindOrStart(Listing listing, Guid userId, DateTimeOffset now, CancellationToken ct)
    {
        var conversation = await db.Conversations.FirstOrDefaultAsync(c => c.ListingId == listing.Id && c.SeekerId == userId, ct);
        if (conversation is null)
        {
            conversation = new Conversation { ListingId = listing.Id, SeekerId = userId, OwnerId = listing.OwnerId, CreatedAt = now };
            db.Conversations.Add(conversation);
        }
        return conversation;
    }

    public async Task<Message> AddMessage(
        Conversation conversation, Guid senderId, string body, DateTimeOffset now, CancellationToken ct,
        BookingRequest? booking = null, JobApplication? application = null)
    {
        var message = new Message
        {
            ConversationId = conversation.Id, SenderId = senderId, Body = body.Trim(), SentAt = now, Booking = booking, Application = application
        };
        db.Messages.Add(message);
        conversation.LastMessageAt = now;
        await db.SaveChangesAsync(ct);
        return message;
    }

    public Task NotifyRecipient(User recipient, string listingTitle, Guid conversationId, CancellationToken ct) =>
        Notify(recipient, $"New message about \"{listingTitle}\"",
            $"<p>You have a new message about <strong>{WebUtility.HtmlEncode(listingTitle)}</strong>.</p>", $"/messages/{conversationId}", "Read and reply", ct);

    public Task Notify(User recipient, string subject, string html, string path, string linkText, CancellationToken ct)
    {
        var link = $"{emailOptions.Value.AppBaseUrl.TrimEnd('/')}{path}";
        return email.SendAsync(recipient.Email, subject, $"{html}<p><a href=\"{link}\">{WebUtility.HtmlEncode(linkText)}</a></p>", ct);
    }
}
