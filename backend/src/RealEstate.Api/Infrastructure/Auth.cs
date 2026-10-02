using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using RealEstate.Api.Domain;

namespace RealEstate.Api.Infrastructure;

public class JwtOptions
{
    public const string Section = "Jwt";
    public string Issuer { get; set; } = "kosovo-real-estate";
    public string Audience { get; set; } = "kosovo-real-estate";
    /// <summary>At least 32 characters. Set via configuration/secrets in production.</summary>
    public string SigningKey { get; set; } = "";
    public int LifetimeHours { get; set; } = 24 * 7;

    public SymmetricSecurityKey Key() => new(Encoding.UTF8.GetBytes(SigningKey));
}

public class TokenService(IOptions<JwtOptions> options, TimeProvider clock)
{
    public (string Token, DateTimeOffset ExpiresAt) Issue(User user)
    {
        var o = options.Value;
        var expires = clock.GetUtcNow().AddHours(o.LifetimeHours);
        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim(JwtRegisteredClaimNames.Email, user.Email),
            new Claim("role", user.Role.ToString()),
            new Claim(JwtRegisteredClaimNames.Name, user.DisplayName)
        };
        var token = new JwtSecurityToken(
            o.Issuer, o.Audience, claims,
            expires: expires.UtcDateTime,
            signingCredentials: new SigningCredentials(o.Key(), SecurityAlgorithms.HmacSha256));
        return (new JwtSecurityTokenHandler().WriteToken(token), expires);
    }
}

public static class Roles
{
    public const string Admin = nameof(UserRole.Admin);
}

public static class ClaimsPrincipalExtensions
{
    public static Guid? UserIdOrNull(this ClaimsPrincipal user)
    {
        var sub = user.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? user.FindFirstValue(ClaimTypes.NameIdentifier);
        return Guid.TryParse(sub, out var id) ? id : null;
    }

    public static Guid UserId(this ClaimsPrincipal user) =>
        user.UserIdOrNull() ?? throw new InvalidOperationException("No authenticated user.");

    public static bool IsAdmin(this ClaimsPrincipal user) => user.IsInRole(Roles.Admin);
}
