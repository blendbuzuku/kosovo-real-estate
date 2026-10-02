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
    /// <summary>Personal accounts can do everything; business accounts also get a public page.</summary>
    public AccountType AccountType { get; init; } = AccountType.Personal;
    /// <summary>Required for business accounts.</summary>
    [MaxLength(120)] public string? BusinessName { get; init; }
    public BusinessKind? BusinessKind { get; init; }
    [MaxLength(64)] public string? Municipality { get; init; }
}

public enum AccountType { Personal, Business }

public record LoginRequest([Required] string Email, [Required] string Password);

public record UpdateProfileRequest(
    [Required, StringLength(120, MinimumLength = 2)] string DisplayName,
    [Phone, MaxLength(32)] string? Phone);

public record BusinessDto(Guid Id, string Slug, string Name, BusinessKind Kind, string? Description, string? Website, string? Municipality, string? Address);

public record UserDto(Guid Id, string Email, string DisplayName, string? Phone, UserRole Role, BusinessDto? Business);

public record AuthResponse(string Token, DateTimeOffset ExpiresAt, UserDto User);

[ApiController]
[Route("api/auth")]
public partial class AuthController(AppDbContext db, TokenService tokens, IPasswordHasher<User> hasher) : ControllerBase
{
    [HttpPost("register")]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult<AuthResponse>> Register(RegisterRequest request, CancellationToken ct)
    {
        var isBusiness = request.AccountType == AccountType.Business;
        if (isBusiness && string.IsNullOrWhiteSpace(request.BusinessName))
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["businessName"] = ["Business name is required for business accounts."]
            }));

        var email = request.Email.Trim().ToLowerInvariant();
        if (await db.Users.AnyAsync(u => u.Email == email, ct))
            return Problem("An account with this email already exists.", statusCode: 409);

        var user = new User
        {
            Email = email,
            DisplayName = request.DisplayName.Trim(),
            Phone = string.IsNullOrWhiteSpace(request.Phone) ? null : request.Phone.Trim(),
            Role = isBusiness ? UserRole.Business : UserRole.Member
        };
        user.PasswordHash = hasher.HashPassword(user, request.Password);

        if (isBusiness)
        {
            var name = request.BusinessName!.Trim();
            user.Business = new Business
            {
                Name = name,
                Kind = request.BusinessKind ?? BusinessKind.Other,
                Slug = await UniqueSlug(name, ct),
                Municipality = Meta.Locations.Find(request.Municipality)?.Name
            };
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
        var user = await db.Users.Include(u => u.Business).FirstOrDefaultAsync(u => u.Email == email, ct);
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
        var user = await db.Users.Include(u => u.Business).FirstOrDefaultAsync(u => u.Id == User.UserId(), ct);
        return user is null ? Unauthorized() : ToDto(user);
    }

    [HttpPut("me")]
    [Authorize]
    public async Task<ActionResult<UserDto>> UpdateMe(UpdateProfileRequest request, CancellationToken ct)
    {
        var user = await db.Users.Include(u => u.Business).FirstAsync(u => u.Id == User.UserId(), ct);
        user.DisplayName = request.DisplayName.Trim();
        user.Phone = string.IsNullOrWhiteSpace(request.Phone) ? null : request.Phone.Trim();
        await db.SaveChangesAsync(ct);
        return ToDto(user);
    }

    public static UserDto ToDto(User u) => new(u.Id, u.Email, u.DisplayName, u.Phone, u.Role,
        u.Business is { } b ? new BusinessDto(b.Id, b.Slug, b.Name, b.Kind, b.Description, b.Website, b.Municipality, b.Address) : null);

    private AuthResponse Issue(User user)
    {
        var (token, expires) = tokens.Issue(user);
        return new AuthResponse(token, expires, ToDto(user));
    }

    private async Task<string> UniqueSlug(string name, CancellationToken ct)
    {
        var baseSlug = Slugify(name);
        var slug = baseSlug;
        for (var i = 2; await db.Businesses.AnyAsync(a => a.Slug == slug, ct); i++) slug = $"{baseSlug}-{i}";
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
        return string.IsNullOrEmpty(slug) ? "business" : slug[..Math.Min(slug.Length, 70)];
    }

    [GeneratedRegex("[^a-z0-9]+")]
    private static partial Regex NonSlugChars();
}
