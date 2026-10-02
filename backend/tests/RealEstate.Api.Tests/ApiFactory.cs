using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Time.Testing;
using Npgsql;
using RealEstate.Api.Data;
using RealEstate.Api.Features.Accounts;
using RealEstate.Api.Infrastructure;

namespace RealEstate.Api.Tests;

public record SentEmail(string To, string Subject, string Body);

public class CapturingEmailSender : IEmailSender
{
    public ConcurrentQueue<SentEmail> Sent { get; } = new();

    public Task SendAsync(string to, string subject, string htmlBody, CancellationToken ct = default)
    {
        Sent.Enqueue(new SentEmail(to, subject, htmlBody));
        return Task.CompletedTask;
    }
}

/// <summary>
/// Runs the real API against a throwaway PostGIS database. Set TEST_DATABASE_URL to point at
/// another server; the default matches the local docker-compose setup.
/// </summary>
public class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    public const string AdminEmail = "admin@test.local";
    public const string AdminPassword = "Admin1234!";

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    private readonly string _dbName = $"realestate_test_{Guid.NewGuid():N}";
    private readonly string _mediaPath = Path.Combine(Path.GetTempPath(), $"realestate-media-{Guid.NewGuid():N}");
    private readonly string _serverConnection =
        Environment.GetEnvironmentVariable("TEST_DATABASE_URL")
        ?? "Host=localhost;Port=5432;Username=realestate;Password=realestate;Database=postgres";

    public FakeTimeProvider Clock { get; } = new(new DateTimeOffset(2026, 10, 1, 9, 0, 0, TimeSpan.Zero));
    public CapturingEmailSender Email { get; } = new();

    private string DbConnection => new NpgsqlConnectionStringBuilder(_serverConnection) { Database = _dbName }.ConnectionString;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Default", DbConnection);
        builder.UseSetting("Jwt:SigningKey", "test-signing-key-0123456789abcdef0123456789");
        builder.UseSetting("Admin:Email", AdminEmail);
        builder.UseSetting("Admin:Password", AdminPassword);
        builder.UseSetting("Database:MigrateOnStartup", "true");
        builder.UseSetting("Database:SeedDemoData", "false");
        builder.UseSetting("Maintenance:Enabled", "false");
        builder.UseSetting("Storage:LocalPath", _mediaPath);
        builder.UseSetting("RateLimits:AuthPer10Minutes", "10000");
        builder.UseSetting("RateLimits:PhonePerHour", "10000");
        builder.UseSetting("RateLimits:MessagesPerHour", "10000");

        builder.ConfigureServices(services =>
        {
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(Clock);
            services.RemoveAll<IEmailSender>();
            services.AddSingleton<IEmailSender>(Email);
        });
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public new async Task DisposeAsync()
    {
        await base.DisposeAsync();
        NpgsqlConnection.ClearAllPools();
        await using var conn = new NpgsqlConnection(_serverConnection);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{_dbName}\" WITH (FORCE)", conn);
        await cmd.ExecuteNonQueryAsync();
        if (Directory.Exists(_mediaPath)) Directory.Delete(_mediaPath, recursive: true);
    }

    public async Task<T> WithDb<T>(Func<AppDbContext, Task<T>> action)
    {
        using var scope = Services.CreateScope();
        return await action(scope.ServiceProvider.GetRequiredService<AppDbContext>());
    }

    public async Task WithScope(Func<IServiceProvider, Task> action)
    {
        using var scope = Services.CreateScope();
        await action(scope.ServiceProvider);
    }

    public async Task<HttpClient> ClientFor(string email, string password)
    {
        var client = CreateClient();
        var res = await client.PostAsJsonAsync("/api/auth/login", new { email, password });
        res.EnsureSuccessStatusCode();
        var auth = (await res.Content.ReadFromJsonAsync<AuthResponse>(Json))!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.Token);
        return client;
    }

    public async Task<(HttpClient Client, UserDto User)> Register(string role, string? agencyName = null, string? phone = "+383 44 000 111")
    {
        var client = CreateClient();
        var email = $"{role.ToLowerInvariant()}-{Guid.NewGuid():N}@test.local";
        var res = await client.PostAsJsonAsync("/api/auth/register", new
        {
            email,
            password = "Password123!",
            displayName = $"Test {role}",
            phone,
            role,
            agencyName
        });
        res.EnsureSuccessStatusCode();
        var auth = (await res.Content.ReadFromJsonAsync<AuthResponse>(Json))!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.Token);
        return (client, auth.User);
    }
}
