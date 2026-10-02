using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using RealEstate.Api.Domain;

namespace RealEstate.Api.Data;

/// <summary>
/// SQL functions over the jsonb attributes column (created in the initial migration), so LINQ can
/// filter and sort on category fields: <c>Attr.Num(l.Attributes, "rooms") &gt;= 2</c>.
/// </summary>
public static class Attr
{
    public static decimal? Num(string attributes, string key) => throw new InvalidOperationException("Only usable in queries.");
    public static string? Text(string attributes, string key) => throw new InvalidOperationException("Only usable in queries.");

    public const string CreateFunctionsSql = """
        CREATE OR REPLACE FUNCTION attr_num(attrs jsonb, key text) RETURNS numeric
            LANGUAGE sql IMMUTABLE PARALLEL SAFE
            AS $$ SELECT CASE WHEN jsonb_typeof(attrs -> key) = 'number' THEN (attrs ->> key)::numeric END $$;
        CREATE OR REPLACE FUNCTION attr_text(attrs jsonb, key text) RETURNS text
            LANGUAGE sql IMMUTABLE PARALLEL SAFE
            AS $$ SELECT attrs ->> key $$;
        """;
}

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public static readonly JsonSerializerOptions CriteriaJson = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public DbSet<User> Users => Set<User>();
    public DbSet<Business> Businesses => Set<Business>();
    public DbSet<Listing> Listings => Set<Listing>();
    public DbSet<ListingPhoto> ListingPhotos => Set<ListingPhoto>();
    public DbSet<Favorite> Favorites => Set<Favorite>();
    public DbSet<SavedSearch> SavedSearches => Set<SavedSearch>();
    public DbSet<Conversation> Conversations => Set<Conversation>();
    public DbSet<Message> Messages => Set<Message>();
    public DbSet<ListingReport> ListingReports => Set<ListingReport>();

    protected override void ConfigureConventions(ModelConfigurationBuilder builder)
    {
        // Enums as readable strings rather than ints.
        builder.Properties<Enum>().HaveConversion<string>().HaveMaxLength(32);
    }

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasPostgresExtension("postgis");

        b.HasDbFunction(typeof(Attr).GetMethod(nameof(Attr.Num))!).HasName("attr_num").HasSchema(null);
        b.HasDbFunction(typeof(Attr).GetMethod(nameof(Attr.Text))!).HasName("attr_text").HasSchema(null);

        b.Entity<User>(e =>
        {
            e.HasIndex(u => u.Email).IsUnique();
            e.Property(u => u.Email).HasMaxLength(256);
            e.Property(u => u.DisplayName).HasMaxLength(120);
            e.Property(u => u.Phone).HasMaxLength(32);
            e.HasOne(u => u.Business).WithOne(a => a.User).HasForeignKey<Business>(a => a.UserId);
        });

        b.Entity<Business>(e =>
        {
            e.HasIndex(a => a.Slug).IsUnique();
            e.Property(a => a.Slug).HasMaxLength(80);
            e.Property(a => a.Name).HasMaxLength(120);
            e.Property(a => a.Description).HasMaxLength(2000);
            e.Property(a => a.Website).HasMaxLength(200);
            e.Property(a => a.Municipality).HasMaxLength(64);
            e.Property(a => a.Address).HasMaxLength(200);
        });

        b.Entity<Listing>(e =>
        {
            e.Property(l => l.Category).HasMaxLength(40);
            e.Property(l => l.Title).HasMaxLength(140);
            e.Property(l => l.Description).HasMaxLength(5000);
            e.Property(l => l.Municipality).HasMaxLength(64);
            e.Property(l => l.Place).HasMaxLength(80);
            e.Property(l => l.Address).HasMaxLength(200);
            e.Property(l => l.PriceEur).HasPrecision(12, 2);

            e.Property(l => l.Attributes).HasColumnType("jsonb");
            e.HasIndex(l => l.Attributes).HasMethod("gin").HasOperators("jsonb_path_ops");
            e.Property(l => l.PricePerM2)
                .HasPrecision(12, 2)
                .HasComputedColumnSql("round(price_eur / nullif(attr_num(attributes, 'areaM2'), 0), 2)", stored: true);

            // geography so distances are in metres and ST_DWithin uses the GiST index.
            e.Property(l => l.Location).HasColumnType("geography (point, 4326)");
            e.HasIndex(l => l.Location).HasMethod("gist");

            e.HasOne(l => l.Owner).WithMany().HasForeignKey(l => l.OwnerId);
            e.HasMany(l => l.Photos).WithOne().HasForeignKey(p => p.ListingId).OnDelete(DeleteBehavior.Cascade);

            e.HasIndex(l => new { l.Status, l.Category, l.DealType, l.Municipality });
            e.HasIndex(l => new { l.Status, l.PublishedAt });
            e.HasIndex(l => new { l.Status, l.ExpiresAt });
            e.HasIndex(l => l.OwnerId);
        });

        b.Entity<Favorite>(e =>
        {
            e.HasKey(f => new { f.UserId, f.ListingId });
            e.HasOne<User>().WithMany().HasForeignKey(f => f.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(f => f.Listing).WithMany().HasForeignKey(f => f.ListingId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<SavedSearch>(e =>
        {
            e.Property(s => s.Name).HasMaxLength(120);
            e.Property(s => s.Criteria)
                .HasColumnType("jsonb")
                .HasConversion(
                    c => JsonSerializer.Serialize(c, CriteriaJson),
                    s => JsonSerializer.Deserialize<ListingSearchCriteria>(s, CriteriaJson)!,
                    // The filter dictionary makes record equality reference-based, so compare the JSON.
                    new ValueComparer<ListingSearchCriteria>(
                        (a, c) => JsonSerializer.Serialize(a, CriteriaJson) == JsonSerializer.Serialize(c, CriteriaJson),
                        c => JsonSerializer.Serialize(c, CriteriaJson).GetHashCode(),
                        c => JsonSerializer.Deserialize<ListingSearchCriteria>(JsonSerializer.Serialize(c, CriteriaJson), CriteriaJson)!));
            e.HasOne(s => s.User).WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Conversation>(e =>
        {
            e.HasIndex(c => new { c.ListingId, c.SeekerId }).IsUnique();
            e.HasOne(c => c.Listing).WithMany().HasForeignKey(c => c.ListingId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(c => c.Seeker).WithMany().HasForeignKey(c => c.SeekerId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(c => c.Owner).WithMany().HasForeignKey(c => c.OwnerId).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(c => c.Messages).WithOne().HasForeignKey(m => m.ConversationId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Message>(e =>
        {
            e.Property(m => m.Body).HasMaxLength(4000);
            e.HasIndex(m => new { m.ConversationId, m.SentAt });
            e.OwnsOne(m => m.Booking, booking =>
            {
                booking.Property(x => x.From).HasColumnName("booking_from");
                booking.Property(x => x.To).HasColumnName("booking_to");
                booking.Property(x => x.Guests).HasColumnName("booking_guests");
                booking.Property(x => x.Units).HasColumnName("booking_units");
                booking.Property(x => x.TotalEur).HasColumnName("booking_total_eur").HasPrecision(12, 2);
            });
        });

        b.Entity<ListingReport>(e =>
        {
            e.Property(r => r.Comment).HasMaxLength(1000);
            e.HasOne(r => r.Listing).WithMany().HasForeignKey(r => r.ListingId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(r => r.Status);
        });
    }
}
