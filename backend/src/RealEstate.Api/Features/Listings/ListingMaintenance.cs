using System.Net;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using RealEstate.Api.Data;
using RealEstate.Api.Domain;
using RealEstate.Api.Infrastructure;

namespace RealEstate.Api.Features.Listings;

/// <summary>Expires old listings, reminds owners before expiry, and emails saved-search matches.</summary>
public class ListingMaintenance(
    AppDbContext db, TimeProvider clock, IEmailSender email, IOptions<EmailOptions> emailOptions, ILogger<ListingMaintenance> log)
{
    public static readonly TimeSpan ReminderLead = TimeSpan.FromDays(3);
    private string AppUrl => emailOptions.Value.AppBaseUrl.TrimEnd('/');

    public async Task RunAsync(CancellationToken ct)
    {
        await ExpireAsync(ct);
        await SendExpiryRemindersAsync(ct);
        await SendSavedSearchAlertsAsync(ct);
    }

    public async Task<int> ExpireAsync(CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var count = await db.Listings
            .Where(l => l.Status == ListingStatus.Active && l.ExpiresAt <= now)
            .ExecuteUpdateAsync(s => s.SetProperty(l => l.Status, ListingStatus.Expired), ct);
        if (count > 0) log.LogInformation("Expired {Count} listings", count);
        return count;
    }

    public async Task SendExpiryRemindersAsync(CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var soon = now + ReminderLead;
        var listings = await db.Listings.Include(l => l.Owner)
            .Where(l => l.Status == ListingStatus.Active && l.ExpiresAt <= soon && l.ExpiryReminderSentAt == null)
            .Take(500)
            .ToListAsync(ct);

        foreach (var l in listings)
        {
            await email.SendAsync(l.Owner.Email, $"\"{l.Title}\" expires on {l.ExpiresAt:dd.MM.yyyy}",
                $"<p>Your listing <strong>{WebUtility.HtmlEncode(l.Title)}</strong> will be taken down on {l.ExpiresAt:dd.MM.yyyy}.</p>" +
                $"<p>If it's still available, <a href=\"{AppUrl}/my-listings\">renew it</a> to keep it up for another {Listing.Lifetime.Days} days.</p>", ct);
            l.ExpiryReminderSentAt = now;
        }
        await db.SaveChangesAsync(ct);
    }

    public async Task SendSavedSearchAlertsAsync(CancellationToken ct)
    {
        var cutoff = clock.GetUtcNow();
        var searches = await db.SavedSearches.Include(s => s.User)
            .Where(s => s.EmailAlerts && s.LastAlertedAt < cutoff)
            .OrderBy(s => s.LastAlertedAt)
            .Take(1000)
            .ToListAsync(ct);

        foreach (var search in searches)
        {
            var since = search.LastAlertedAt;
            var matches = db.Listings.AsNoTracking()
                .Where(l => l.Status == ListingStatus.Active && l.PublishedAt > since && l.PublishedAt <= cutoff)
                .Filter(search.Criteria);

            var total = await matches.CountAsync(ct);
            if (total > 0)
            {
                var top = await matches.OrderByDescending(l => l.PublishedAt).Take(10)
                    .Select(l => new { l.Id, l.Title, l.PriceEur, l.DealType, l.Municipality, l.Place })
                    .ToListAsync(ct);

                var body = new StringBuilder($"<p>{total} new listing{(total == 1 ? "" : "s")} match your search <strong>{WebUtility.HtmlEncode(search.Name)}</strong>:</p><ul>");
                foreach (var l in top)
                    body.Append($"<li><a href=\"{AppUrl}/listings/{l.Id}\">{WebUtility.HtmlEncode(l.Title)}</a> · {PriceText(l.PriceEur, l.DealType)} · {WebUtility.HtmlEncode(l.Place is null ? l.Municipality : $"{l.Place}, {l.Municipality}")}</li>");
                body.Append($"</ul><p><a href=\"{AppUrl}/saved-searches\">Manage your alerts</a></p>");

                await email.SendAsync(search.User.Email, $"New listings for \"{search.Name}\"", body.ToString(), ct);
            }
            search.LastAlertedAt = cutoff;
        }
        await db.SaveChangesAsync(ct);
    }

    public static string PriceText(decimal price, DealType deal) => deal switch
    {
        DealType.RentMonthly => $"{price:N0} € / month",
        DealType.RentNightly => $"{price:N0} € / night",
        DealType.RentDaily => $"{price:N0} € / day",
        _ => $"{price:N0} €"
    };
}

public class ListingMaintenanceWorker(IServiceScopeFactory scopes, ILogger<ListingMaintenanceWorker> log, IConfiguration config)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var interval = TimeSpan.FromMinutes(config.GetValue("Maintenance:IntervalMinutes", 15));
        using var timer = new PeriodicTimer(interval);
        do
        {
            try
            {
                using var scope = scopes.CreateScope();
                await scope.ServiceProvider.GetRequiredService<ListingMaintenance>().RunAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Listing maintenance failed");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
