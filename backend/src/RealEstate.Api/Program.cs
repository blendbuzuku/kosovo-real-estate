using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Amazon.S3;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using RealEstate.Api.Data;
using RealEstate.Api.Domain;
using RealEstate.Api.Features.Listings;
using RealEstate.Api.Infrastructure;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

builder.Services.AddDbContext<AppDbContext>(o => o
    .UseNpgsql(config.GetConnectionString("Default"), npgsql => npgsql.UseNetTopologySuite())
    .UseSnakeCaseNamingConvention());

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<IPasswordHasher<User>, PasswordHasher<User>>();

// Auth
builder.Services.Configure<JwtOptions>(config.GetSection(JwtOptions.Section));
builder.Services.AddSingleton<TokenService>();
var jwt = config.GetSection(JwtOptions.Section).Get<JwtOptions>() ?? new JwtOptions();
if (jwt.SigningKey.Length < 32)
    throw new InvalidOperationException("Jwt:SigningKey must be at least 32 characters. Set it in configuration or user secrets.");
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.MapInboundClaims = false;
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidIssuer = jwt.Issuer,
            ValidAudience = jwt.Audience,
            IssuerSigningKey = jwt.Key(),
            NameClaimType = "name",
            RoleClaimType = "role"
        };
        // A token can outlive its account (database reset, deleted user). Treat it as signed out
        // instead of letting writes fail on the owner foreign key.
        o.Events = new JwtBearerEvents
        {
            OnTokenValidated = async ctx =>
            {
                var id = ctx.Principal?.UserIdOrNull();
                var db = ctx.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
                if (id is null || !await db.Users.AnyAsync(u => u.Id == id, ctx.HttpContext.RequestAborted))
                    ctx.Fail("The account for this token no longer exists.");
            }
        };
    });
builder.Services.AddAuthorization();

// Photos
builder.Services.Configure<StorageOptions>(config.GetSection(StorageOptions.Section));
var storage = config.GetSection(StorageOptions.Section).Get<StorageOptions>() ?? new StorageOptions();
if (storage.Provider.Equals("S3", StringComparison.OrdinalIgnoreCase))
{
    builder.Services.AddSingleton<IAmazonS3>(_ => new AmazonS3Client(storage.S3AccessKey, storage.S3SecretKey, new AmazonS3Config
    {
        ServiceURL = storage.S3ServiceUrl,
        AuthenticationRegion = storage.S3Region,
        ForcePathStyle = true
    }));
    builder.Services.AddSingleton<IFileStorage, S3FileStorage>();
}
else
{
    builder.Services.AddSingleton<LocalFileStorage>();
    builder.Services.AddSingleton<IFileStorage>(sp => sp.GetRequiredService<LocalFileStorage>());
}
builder.Services.AddScoped<PhotoProcessor>();

// Email
builder.Services.Configure<EmailOptions>(config.GetSection(EmailOptions.Section));
if (string.IsNullOrEmpty(config[$"{EmailOptions.Section}:SmtpHost"]))
    builder.Services.AddSingleton<IEmailSender, LoggingEmailSender>();
else
    builder.Services.AddSingleton<IEmailSender, SmtpEmailSender>();

// Background jobs
builder.Services.AddScoped<ListingMaintenance>();
if (config.GetValue("Maintenance:Enabled", true))
    builder.Services.AddHostedService<ListingMaintenanceWorker>();

builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    var limits = config.GetSection("RateLimits");
    string Partition(HttpContext ctx) => ctx.User.UserIdOrNull()?.ToString() ?? ctx.Connection.RemoteIpAddress?.ToString() ?? "anon";
    o.AddPolicy("phone", ctx => RateLimitPartition.GetFixedWindowLimiter(Partition(ctx),
        _ => new FixedWindowRateLimiterOptions { PermitLimit = limits.GetValue("PhonePerHour", 30), Window = TimeSpan.FromHours(1) }));
    o.AddPolicy("auth", ctx => RateLimitPartition.GetFixedWindowLimiter(Partition(ctx),
        _ => new FixedWindowRateLimiterOptions { PermitLimit = limits.GetValue("AuthPer10Minutes", 20), Window = TimeSpan.FromMinutes(10) }));
    o.AddPolicy("messages", ctx => RateLimitPartition.GetFixedWindowLimiter(Partition(ctx),
        _ => new FixedWindowRateLimiterOptions { PermitLimit = limits.GetValue("MessagesPerHour", 60), Window = TimeSpan.FromHours(1) }));
});

builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins(config.GetSection("Cors:Origins").Get<string[]>() ?? ["http://localhost:4200"])
    .AllowAnyHeader()
    .AllowAnyMethod()));

builder.Services.AddProblemDetails();
builder.Services.AddControllers()
    .AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddOpenApi();

var app = builder.Build();

// Business-rule violations (e.g. submitting without photos) become 409s with a readable message.
app.UseExceptionHandler(handler => handler.Run(async ctx =>
{
    var error = ctx.Features.Get<IExceptionHandlerFeature>()?.Error;
    var problems = ctx.RequestServices.GetRequiredService<IProblemDetailsService>();
    if (error is DomainException)
    {
        ctx.Response.StatusCode = StatusCodes.Status409Conflict;
        await problems.WriteAsync(new ProblemDetailsContext
        {
            HttpContext = ctx,
            ProblemDetails = { Title = "This action isn't allowed right now.", Detail = error.Message, Status = 409 }
        });
        return;
    }
    ctx.Response.StatusCode = StatusCodes.Status500InternalServerError;
    await problems.WriteAsync(new ProblemDetailsContext { HttpContext = ctx, ProblemDetails = { Title = "Something went wrong.", Status = 500 } });
}));

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    if (config.GetValue("Database:MigrateOnStartup", false)) await db.Database.MigrateAsync();
    var hasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher<User>>();
    await Seeder.EnsureAdminAsync(db, config, hasher);
    if (config.GetValue("Database:SeedDemoData", false))
        await Seeder.SeedDemoDataAsync(db, hasher, scope.ServiceProvider.GetRequiredService<TimeProvider>());
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}

if (app.Services.GetService<IFileStorage>() is LocalFileStorage local)
{
    Directory.CreateDirectory(local.Root);
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(local.Root),
        RequestPath = "/media",
        OnPrepareResponse = c => c.Context.Response.Headers.CacheControl = "public, max-age=31536000, immutable"
    });
}

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();
app.MapControllers();
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Run();

public partial class Program;
