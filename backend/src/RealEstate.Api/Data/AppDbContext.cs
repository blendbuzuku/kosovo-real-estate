using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using RealEstate.Api.Domain;

namespace RealEstate.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    private static readonly JsonSerializerOptions CriteriaJson = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public DbSet<User> Users => Set<User>();
    public DbSet<Agency> Agencies => Set<Agency>();
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

        b.Entity<User>(e =>
        {
            e.HasIndex(u => u.Email).IsUnique();
            e.Property(u => u.Email).HasMaxLength(256);
            e.Property(u => u.DisplayName).HasMaxLength(120);
            e.Property(u => u.Phone).HasMaxLength(32);
            e.HasOne(u => u.Agency).WithOne(a => a.User).HasForeignKey<Agency>(a => a.UserId);
        });

        b.Entity<Agency>(e =>
        {
            e.HasIndex(a => a.Slug).IsUnique();
            e.Property(a => a.Slug).HasMaxLength(80);
            e.Property(a => a.Name).HasMaxLength(120);
        });

        b.Entity<Listing>(e =>
        {
            e.Property(l => l.Title).HasMaxLength(140);
            e.Property(l => l.Description).HasMaxLength(5000);
            e.Property(l => l.City).HasMaxLength(64);
            e.Property(l => l.Neighborhood).HasMaxLength(64);
            e.Property(l => l.Address).HasMaxLength(200);
            e.Property(l => l.PriceEur).HasPrecision(12, 2);
            e.Property(l => l.AreaM2).HasPrecision(10, 2);
            e.Property(l => l.PricePerM2)
                .HasPrecision(12, 2)
                .HasComputedColumnSql("round(price_eur / nullif(area_m2, 0), 2)", stored: true);

            // geography so distances are in metres and ST_DWithin uses the GiST index.
            e.Property(l => l.Location).HasColumnType("geography (point, 4326)");
            e.HasIndex(l => l.Location).HasMethod("gist");

            e.OwnsOne(l => l.Legal, legal =>
            {
                legal.Property(x => x.HasConstructionPermit).HasColumnName("legal_has_construction_permit");
                legal.Property(x => x.HasCadastreCertificate).HasColumnName("legal_has_cadastre_certificate");
                legal.Property(x => x.Legalization).HasColumnName("legal_legalization");
                legal.Property(x => x.Notes).HasColumnName("legal_notes").HasMaxLength(1000);
            });
            e.Navigation(l => l.Legal).IsRequired();

            e.HasOne(l => l.Owner).WithMany().HasForeignKey(l => l.OwnerId);
            e.HasMany(l => l.Photos).WithOne().HasForeignKey(p => p.ListingId).OnDelete(DeleteBehavior.Cascade);

            e.HasIndex(l => new { l.Status, l.DealType, l.PropertyType, l.City });
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
                    new ValueComparer<ListingSearchCriteria>((a, c) => a == c, c => c.GetHashCode(), c => c));
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
        });

        b.Entity<ListingReport>(e =>
        {
            e.Property(r => r.Comment).HasMaxLength(1000);
            e.HasOne(r => r.Listing).WithMany().HasForeignKey(r => r.ListingId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(r => r.Status);
        });
    }
}
