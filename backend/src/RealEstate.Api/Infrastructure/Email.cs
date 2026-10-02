using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Options;
using MimeKit;

namespace RealEstate.Api.Infrastructure;

public class EmailOptions
{
    public const string Section = "Email";
    /// <summary>When empty, emails are only written to the log (handy in development).</summary>
    public string? SmtpHost { get; set; }
    public int SmtpPort { get; set; } = 587;
    public string? SmtpUser { get; set; }
    public string? SmtpPassword { get; set; }
    public string From { get; set; } = "Prona <no-reply@example.com>";
    /// <summary>Public URL of the web app, used for links in emails.</summary>
    public string AppBaseUrl { get; set; } = "http://localhost:4200";
}

public interface IEmailSender
{
    Task SendAsync(string to, string subject, string htmlBody, CancellationToken ct = default);
}

public class LoggingEmailSender(ILogger<LoggingEmailSender> log) : IEmailSender
{
    public Task SendAsync(string to, string subject, string htmlBody, CancellationToken ct = default)
    {
        log.LogInformation("Email to {To}: {Subject}\n{Body}", to, subject, htmlBody);
        return Task.CompletedTask;
    }
}

public class SmtpEmailSender(IOptions<EmailOptions> options) : IEmailSender
{
    public async Task SendAsync(string to, string subject, string htmlBody, CancellationToken ct = default)
    {
        var o = options.Value;
        var message = new MimeMessage();
        message.From.Add(MailboxAddress.Parse(o.From));
        message.To.Add(MailboxAddress.Parse(to));
        message.Subject = subject;
        message.Body = new BodyBuilder { HtmlBody = htmlBody }.ToMessageBody();

        using var client = new SmtpClient();
        await client.ConnectAsync(o.SmtpHost!, o.SmtpPort, SecureSocketOptions.StartTlsWhenAvailable, ct);
        if (!string.IsNullOrEmpty(o.SmtpUser)) await client.AuthenticateAsync(o.SmtpUser, o.SmtpPassword ?? "", ct);
        await client.SendAsync(message, ct);
        await client.DisconnectAsync(true, ct);
    }
}
