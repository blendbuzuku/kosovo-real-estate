using System.ComponentModel.DataAnnotations;
using System.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using RealEstate.Api.Data;
using RealEstate.Api.Domain;
using RealEstate.Api.Features.Listings;
using RealEstate.Api.Features.Messaging;
using RealEstate.Api.Infrastructure;

namespace RealEstate.Api.Features.Jobs;

public class ApplyRequest
{
    [Required, StringLength(5000, MinimumLength = 20)] public string CoverLetter { get; init; } = "";
    [MaxLength(40)] public string? Phone { get; init; }
    public IFormFile? Cv { get; init; }
}

public record SetApplicationStatusRequest(ApplicationStatus Status);

/// <summary>What the applicant sees about their own application.</summary>
public record MyApplicationDto(
    Guid Id, Guid ListingId, string ListingTitle, string Employer, string Municipality, ListingStatus ListingStatus,
    ApplicationStatus Status, string? CvFileName, Guid ConversationId, DateTimeOffset CreatedAt);

/// <summary>What the employer sees about one applicant.</summary>
public record ApplicantDto(
    Guid Id, Guid ApplicantId, string Name, string Email, string? Phone, string CoverLetter, string? CvFileName,
    ApplicationStatus Status, Guid ConversationId, DateTimeOffset CreatedAt);

public record JobApplicantsDto(Guid ListingId, string ListingTitle, IReadOnlyList<ApplicantDto> Applicants);

[ApiController]
[Authorize]
public class JobApplicationsController(AppDbContext db, IPrivateFileStorage files, Inbox inbox, TimeProvider clock) : ControllerBase
{
    public const long MaxCvBytes = 5 * 1024 * 1024;

    /// <summary>
    /// Apply for a job ad with a cover letter and, optionally (unless the ad asks for one), a CV as PDF or Word.
    /// The application also lands in the employer's inbox as a message, so both sides can talk there.
    /// </summary>
    [HttpPost("api/listings/{listingId:guid}/applications")]
    [EnableRateLimiting("messages")]
    [RequestSizeLimit(MaxCvBytes + 64 * 1024)]
    public async Task<ActionResult<MyApplicationDto>> Apply(Guid listingId, [FromForm] ApplyRequest request, CancellationToken ct)
    {
        var userId = User.UserId();
        var listing = await db.Listings.Include(l => l.Owner).ThenInclude(o => o.Business)
            .FirstOrDefaultAsync(l => l.Id == listingId && l.Status == ListingStatus.Active, ct);
        if (listing is null) return NotFound();
        if (listing.DealType != DealType.Job) return Problem("Only job ads take applications. Send a message instead.", statusCode: 400);
        if (listing.OwnerId == userId) return Problem("You can't apply to your own job ad.", statusCode: 400);
        if (await db.JobApplications.AnyAsync(a => a.ListingId == listingId && a.ApplicantId == userId, ct))
            return Problem("You've already applied for this job.", statusCode: 409);

        var cvRequired = ListingMapping.ParseAttributes(listing.Attributes) is var attrs &&
                         attrs.TryGetProperty("cvRequired", out var flag) && flag.ValueKind == System.Text.Json.JsonValueKind.True;
        if (request.Cv is null && cvRequired)
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]> { ["cv"] = ["This employer asks for a CV."] }));

        var application = new JobApplication
        {
            ListingId = listingId,
            ApplicantId = userId,
            CoverLetter = request.CoverLetter.Trim(),
            Phone = string.IsNullOrWhiteSpace(request.Phone) ? null : request.Phone.Trim(),
            CreatedAt = clock.GetUtcNow(),
            UpdatedAt = clock.GetUtcNow()
        };

        if (request.Cv is { } cv)
        {
            if (await CvKind(cv, ct) is not { } kind)
                return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
                    { ["cv"] = ["Your CV must be a PDF or Word file (.pdf, .doc, .docx) under 5 MB."] }));
            application.CvKey = $"cvs/{listingId:N}/{application.Id:N}{kind.Extension}";
            application.CvFileName = SafeFileName(cv.FileName, kind.Extension);
            application.CvContentType = kind.ContentType;
            await using var stream = cv.OpenReadStream();
            await files.SaveAsync(application.CvKey, stream, kind.ContentType, ct);
        }

        var now = clock.GetUtcNow();
        var conversation = await inbox.FindOrStart(listing, userId, now, ct);
        application.ConversationId = conversation.Id;
        db.JobApplications.Add(application);
        var body = $"Applied for this job{(application.CvFileName is null ? "" : " with a CV")}.\n\n{application.CoverLetter}";
        await inbox.AddMessage(conversation, userId, body, now, ct, application: application);
        await inbox.Notify(listing.Owner, $"New application for \"{listing.Title}\"",
            $"<p>Someone applied for <strong>{WebUtility.HtmlEncode(listing.Title)}</strong>.</p>",
            $"/my-ads/{listing.Id}/applicants", "See applicants", ct);

        return await Mine(userId, db.JobApplications.Where(a => a.Id == application.Id)).FirstAsync(ct);
    }

    [HttpGet("api/me/applications")]
    public async Task<IReadOnlyList<MyApplicationDto>> MyApplications(CancellationToken ct) =>
        await Mine(User.UserId(), db.JobApplications.OrderByDescending(a => a.CreatedAt)).ToListAsync(ct);

    /// <summary>The signed-in user's application for one job ad, if they applied.</summary>
    [HttpGet("api/listings/{listingId:guid}/applications/mine")]
    public async Task<ActionResult<MyApplicationDto>> MineFor(Guid listingId, CancellationToken ct) =>
        await Mine(User.UserId(), db.JobApplications.Where(a => a.ListingId == listingId)).FirstOrDefaultAsync(ct) is { } a ? a : NoContent();

    /// <summary>Everyone who applied for one of the employer's job ads, newest first.</summary>
    [HttpGet("api/listings/{listingId:guid}/applications")]
    public async Task<ActionResult<JobApplicantsDto>> Applicants(Guid listingId, CancellationToken ct)
    {
        var userId = User.UserId();
        var listing = await db.Listings.AsNoTracking().FirstOrDefaultAsync(l => l.Id == listingId && (l.OwnerId == userId || User.IsAdmin()), ct);
        if (listing is null) return NotFound();
        var applicants = await db.JobApplications.AsNoTracking()
            .Where(a => a.ListingId == listingId)
            .OrderByDescending(a => a.CreatedAt)
            .Select(a => new ApplicantDto(a.Id, a.ApplicantId, a.Applicant.DisplayName, a.Applicant.Email, a.Phone ?? a.Applicant.Phone,
                a.CoverLetter, a.CvFileName, a.Status, a.ConversationId, a.CreatedAt))
            .ToListAsync(ct);
        return new JobApplicantsDto(listing.Id, listing.Title, applicants);
    }

    /// <summary>The employer shortlists or turns down an applicant; the applicant gets an email.</summary>
    [HttpPut("api/applications/{id:guid}/status")]
    public async Task<ActionResult<ApplicantDto>> SetStatus(Guid id, SetApplicationStatusRequest request, CancellationToken ct)
    {
        var userId = User.UserId();
        var application = await db.JobApplications.Include(a => a.Listing).Include(a => a.Applicant)
            .FirstOrDefaultAsync(a => a.Id == id && a.Listing.OwnerId == userId, ct);
        if (application is null) return NotFound();
        if (application.Status != request.Status)
        {
            application.Status = request.Status;
            application.UpdatedAt = clock.GetUtcNow();
            await db.SaveChangesAsync(ct);
            if (request.Status != ApplicationStatus.New)
            {
                var news = request.Status == ApplicationStatus.Shortlisted
                    ? "You've been shortlisted. The employer will be in touch about next steps."
                    : "The employer has decided not to go ahead with your application this time.";
                await inbox.Notify(application.Applicant, $"Update on your application for \"{application.Listing.Title}\"",
                    $"<p>{news}</p>", "/my-applications", "See your applications", ct);
            }
        }
        var a = application;
        return new ApplicantDto(a.Id, a.ApplicantId, a.Applicant.DisplayName, a.Applicant.Email, a.Phone ?? a.Applicant.Phone,
            a.CoverLetter, a.CvFileName, a.Status, a.ConversationId, a.CreatedAt);
    }

    /// <summary>Download the CV. Only the employer who posted the job and the applicant can.</summary>
    [HttpGet("api/applications/{id:guid}/cv")]
    public async Task<IActionResult> Cv(Guid id, CancellationToken ct)
    {
        var userId = User.UserId();
        var application = await db.JobApplications.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == id && (a.ApplicantId == userId || a.Listing.OwnerId == userId || User.IsAdmin()), ct);
        if (application?.CvKey is null) return NotFound();
        var stream = await files.OpenReadAsync(application.CvKey, ct);
        if (stream is null) return NotFound();
        Response.Headers.CacheControl = "private, no-store";
        return File(stream, application.CvContentType ?? "application/octet-stream", application.CvFileName);
    }

    /// <summary>Filter and order <paramref name="source"/> before calling: EF can't translate either after the DTO projection.</summary>
    private static IQueryable<MyApplicationDto> Mine(Guid userId, IQueryable<JobApplication> source) =>
        source.AsNoTracking()
            .Where(a => a.ApplicantId == userId)
            .Select(a => new MyApplicationDto(a.Id, a.ListingId, a.Listing.Title,
                a.Listing.Owner.Business != null ? a.Listing.Owner.Business.Name : a.Listing.Owner.DisplayName,
                a.Listing.Municipality, a.Listing.Status, a.Status, a.CvFileName, a.ConversationId, a.CreatedAt));

    private record CvFileKind(string Extension, string ContentType);

    /// <summary>Checks the file's first bytes, not just its name, so only real PDF and Word files are stored.</summary>
    private static async Task<CvFileKind?> CvKind(IFormFile file, CancellationToken ct)
    {
        if (file.Length is 0 or > MaxCvBytes) return null;
        var head = new byte[8];
        await using var s = file.OpenReadStream();
        var read = await s.ReadAtLeastAsync(head, head.Length, throwOnEndOfStream: false, ct);
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (read >= 4 && head[0] == '%' && head[1] == 'P' && head[2] == 'D' && head[3] == 'F')
            return new(".pdf", "application/pdf");
        if (read >= 4 && head[0] == 'P' && head[1] == 'K' && head[2] == 3 && head[3] == 4 && ext == ".docx")
            return new(".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        if (read >= 8 && head is [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1] && ext == ".doc")
            return new(".doc", "application/msword");
        return null;
    }

    private static string SafeFileName(string name, string extension)
    {
        var stem = Path.GetFileNameWithoutExtension(name);
        var clean = new string(stem.Where(c => char.IsLetterOrDigit(c) || c is ' ' or '-' or '_' or '.').ToArray()).Trim();
        if (clean.Length == 0) clean = "CV";
        if (clean.Length > 80) clean = clean[..80];
        return clean + extension;
    }
}
