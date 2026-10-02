using System.ComponentModel.DataAnnotations;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using RealEstate.Api.Data;
using RealEstate.Api.Domain;
using RealEstate.Api.Infrastructure;

namespace RealEstate.Api.Features.Accounts;

public record RegisterRequest
{
    [Required, EmailAddress, MaxLength(256)] public string Email { get; init; } = "";
    [Required, StringLength(128, MinimumLength = 8)] public string Password { get; init; } = "";
    [Required, StringLength(120, MinimumLength = 2)] public string DisplayName { get; init; } = "";
    [Phone, MaxLength(32)] public string? Phone { get; init; }
    /// <summary>Seeker, Owner or Agency. Admins are created from configuration.</summary>
    public UserRole Role { get; init; } = UserRole.Seeker;
    /// <summary>Required when Role is Agency.</summary>
    [MaxLength(120)] public string? AgencyName { get; init; }
}

public record LoginRequest([Required] string Email, [Required] string Password);

public record UpdateProfileRequest(
    [Required, StringLength(120, MinimumLength = 2)] string DisplayName,
    [Phone, MaxLength(32)] string? Phone);

public record AgencyDto(Guid Id, string Slug, string Name, string? Description, string? Website, string? City);

public record UserDto(Guid Id, string Email, string DisplayName, string? Phone, UserRole Role, AgencyDto? Agency);

public record AuthResponse(string Token, DateTimeOffset ExpiresAt, UserDto User);

[ApiController]
[Route("api/auth")]
public partial class AuthController(AppDbContext db, TokenService tokens, IPasswordHasher<User> hasher) : ControllerBase
{
    [HttpPost("register")]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult<AuthResponse>> Register(RegisterRequest request, CancellationToken ct)
    {
        if (request.Role == UserRole.Admin)
            return Problem("Admin accounts can't be self-registered.", statusCode: 400);
        if (request.Role == UserRole.Agency && string.IsNullOrWhiteSpace(request.AgencyName))
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                [nameof(request.AgencyName)] = ["Agency name is required for agency accounts."]
            }));

        var email = request.Email.Trim().ToLowerInvariant();
        if (await db.Users.AnyAsync(u => u.Email == email, ct))
            return Problem("An account with this email already exists.", statusCode: 409);

        var user = new User
        {
            Email = email,
            DisplayName = request.DisplayName.Trim(),
            Phone = string.IsNullOrWhiteSpace(request.Phone) ? null : request.Phone.Trim(),
            Role = request.Role
        };
        user.PasswordHash = hasher.HashPassword(user, request.Password);

        if (request.Role == UserRole.Agency)
        {
            var name = request.AgencyName!.Trim();
            user.Agency = new Agency { Name = name, Slug = await UniqueSlug(name, ct) };
        }

        db.Users.Add(user);
        await db.SaveChangesAsync(ct);
        return Issue(user);
    }

    [HttpPost("login")]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest request, CancellationToken ct)
    {
        var email = request.Email.Trim().ToLowerInvariant();
        var user = await db.Users.Include(u => u.Agency).FirstOrDefaultAsync(u => u.Email == email, ct);
        if (user is null) return Problem("Wrong email or password.", statusCode: 401);

        var result = hasher.VerifyHashedPassword(user, user.PasswordHash, request.Password);
        if (result == PasswordVerificationResult.Failed) return Problem("Wrong email or password.", statusCode: 401);
        if (result == PasswordVerificationResult.SuccessRehashNeeded)
        {
            user.PasswordHash = hasher.HashPassword(user, request.Password);
            await db.SaveChangesAsync(ct);
        }
        return Issue(user);
    }

    [HttpGet("me")]
    [Authorize]
    public async Task<ActionResult<UserDto>> Me(CancellationToken ct)
    {
        var user = await db.Users.Include(u => u.Agency).FirstOrDefaultAsync(u => u.Id == User.UserId(), ct);
        return user is null ? Unauthorized() : ToDto(user);
    }

    [HttpPut("me")]
    [Authorize]
    public async Task<ActionResult<UserDto>> UpdateMe(UpdateProfileRequest request, CancellationToken ct)
    {
        var user = await db.Users.Include(u => u.Agency).FirstAsync(u => u.Id == User.UserId(), ct);
        user.DisplayName = request.DisplayName.Trim();
        user.Phone = string.IsNullOrWhiteSpace(request.Phone) ? null : request.Phone.Trim();
        await db.SaveChangesAsync(ct);
        return ToDto(user);
    }

    public static UserDto ToDto(User u) => new(u.Id, u.Email, u.DisplayName, u.Phone, u.Role,
        u.Agency is { } a ? new AgencyDto(a.Id, a.Slug, a.Name, a.Description, a.Website, a.City) : null);

    private AuthResponse Issue(User user)
    {
        var (token, expires) = tokens.Issue(user);
        return new AuthResponse(token, expires, ToDto(user));
    }

    private async Task<string> UniqueSlug(string name, CancellationToken ct)
    {
        var baseSlug = Slugify(name);
        var slug = baseSlug;
        for (var i = 2; await db.Agencies.AnyAsync(a => a.Slug == slug, ct); i++) slug = $"{baseSlug}-{i}";
        return slug;
    }

    public static string Slugify(string text)
    {
        // Albanian ë/ç → e/c and so on, then keep [a-z0-9-].
        var decomposed = text.ToLowerInvariant().Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder();
        foreach (var ch in decomposed)
            if (System.Globalization.CharUnicodeInfo.GetUnicodeCategory(ch) != System.Globalization.UnicodeCategory.NonSpacingMark)
                sb.Append(ch);
        var slug = NonSlugChars().Replace(sb.ToString(), "-").Trim('-');
        return string.IsNullOrEmpty(slug) ? "agency" : slug[..Math.Min(slug.Length, 70)];
    }

    [GeneratedRegex("[^a-z0-9]+")]
    private static partial Regex NonSlugChars();
}
