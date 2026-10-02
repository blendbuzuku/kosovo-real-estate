using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using RealEstate.Api.Data;
using RealEstate.Api.Domain;
using RealEstate.Api.Features.Meta;
using RealEstate.Api.Infrastructure;

namespace RealEstate.Api.Features.Listings;

[ApiController]
[Route("api/listings")]
public class ListingsController(AppDbContext db, IFileStorage storage, PhotoProcessor photos, TimeProvider clock) : ControllerBase
{
    public const int MaxPhotos = 30;
    private static readonly string[] AllowedImageTypes = ["image/jpeg", "image/png", "image/webp"];

    /// <summary>Public search over live listings.</summary>
    /// <remarks>Category fields are filtered with f.&lt;key&gt;, f.&lt;key&gt;.min and f.&lt;key&gt;.max query parameters.</remarks>
    [HttpGet]
    public Task<PagedResult<ListingSummaryDto>> Search(
        [FromQuery] ListingSearchCriteria criteria, int page = 1, int pageSize = 20, CancellationToken ct = default) =>
        db.Listings.AsNoTracking()
            .Where(l => l.Status == ListingStatus.Active)
            .Filter(criteria.WithFieldFilters(Request.Query))
            .Sort(criteria.Sort)
            .ToPageAsync(page, pageSize, storage, ct);

    /// <summary>Lightweight pins for the map view (pass bbox for the current viewport).</summary>
    [HttpGet("map")]
    public async Task<IReadOnlyList<MapPinDto>> Map([FromQuery] ListingSearchCriteria criteria, CancellationToken ct)
    {
        // ST_X/ST_Y don't exist for geography, so read the point and split it here.
        var rows = await db.Listings.AsNoTracking()
            .Where(l => l.Status == ListingStatus.Active)
            .Filter(criteria.WithFieldFilters(Request.Query))
            .Sort(criteria.Sort)
            .Take(1000)
            .Select(l => new { l.Id, l.Location, l.PriceEur, l.DealType, l.Category })
            .ToListAsync(ct);
        return rows.Select(r => new MapPinDto(r.Id, r.Location.Y, r.Location.X, r.PriceEur, r.DealType, r.Category)).ToList();
    }

    /// <summary>Other live ads in the same category and deal, nearest first.</summary>
    [HttpGet("{id:guid}/similar")]
    public async Task<ActionResult<IReadOnlyList<ListingSummaryDto>>> Similar(Guid id, int take = 8, CancellationToken ct = default)
    {
        var source = await db.Listings.AsNoTracking()
            .Where(l => l.Id == id)
            .Select(l => new { l.Category, l.DealType, l.Location })
            .FirstOrDefaultAsync(ct);
        if (source is null) return NotFound();
        var rows = await db.Listings.AsNoTracking()
            .Where(l => l.Status == ListingStatus.Active && l.Id != id && l.Category == source.Category && l.DealType == source.DealType)
            .OrderBy(l => l.Location.Distance(source.Location))
            .Take(Math.Clamp(take, 1, 24))
            .SelectSummaryRows()
            .ToListAsync(ct);
        return rows.Select(r => r.ToSummary(storage)).ToList();
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ListingDetailDto>> Get(Guid id, CancellationToken ct)
    {
        var listing = await db.Listings
            .Include(l => l.Photos)
            .Include(l => l.Owner).ThenInclude(o => o.Business)
            .FirstOrDefaultAsync(l => l.Id == id, ct);
        if (listing is null) return NotFound();

        var userId = User.UserIdOrNull();
        var isMine = listing.OwnerId == userId;
        if (listing.Status != ListingStatus.Active && !isMine && !User.IsAdmin()) return NotFound();

        if (listing.Status == ListingStatus.Active && !isMine)
        {
            await db.Listings.Where(l => l.Id == id)
                .ExecuteUpdateAsync(s => s.SetProperty(l => l.ViewCount, l => l.ViewCount + 1), ct);
        }

        var isFavorite = userId is { } uid && await db.Favorites.AnyAsync(f => f.UserId == uid && f.ListingId == id, ct);
        return ToDetail(listing, isMine, isFavorite);
    }

    /// <summary>The owner's phone number. Rate limited and counted, since it's what scrapers want.</summary>
    [HttpGet("{id:guid}/phone")]
    [EnableRateLimiting("phone")]
    public async Task<ActionResult<PhoneDto>> Phone(Guid id, CancellationToken ct)
    {
        var phone = await db.Listings
            .Where(l => l.Id == id && l.Status == ListingStatus.Active)
            .Select(l => l.Owner.Phone)
            .FirstOrDefaultAsync(ct);
        if (string.IsNullOrEmpty(phone)) return NotFound();
        await db.Listings.Where(l => l.Id == id)
            .ExecuteUpdateAsync(s => s.SetProperty(l => l.PhoneRevealCount, l => l.PhoneRevealCount + 1), ct);
        return new PhoneDto(phone);
    }

    [HttpGet("~/api/me/listings")]
    [Authorize]
    public Task<PagedResult<ListingSummaryDto>> Mine(ListingStatus? status, int page = 1, int pageSize = 50, CancellationToken ct = default)
    {
        var userId = User.UserId();
        var q = db.Listings.AsNoTracking().Where(l => l.OwnerId == userId);
        if (status is { } s) q = q.Where(l => l.Status == s);
        return q.OrderByDescending(l => l.UpdatedAt).ToPageAsync(page, pageSize, storage, ct);
    }

    /// <summary>Anyone signed in can post; the ad starts as a draft.</summary>
    [HttpPost]
    [Authorize]
    public async Task<ActionResult<ListingDetailDto>> Create(ListingUpsertRequest request, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var listing = new Listing
        {
            OwnerId = User.UserId(),
            Category = "",
            Title = "",
            Description = "",
            Municipality = "",
            Location = ListingQuery.PointAt(0, 0),
            CreatedAt = now,
            UpdatedAt = now
        };
        if (Apply(listing, request) is { } invalid) return invalid;
        db.Listings.Add(listing);
        await db.SaveChangesAsync(ct);
        return CreatedAtAction(nameof(Get), new { id = listing.Id }, await LoadDetail(listing.Id, ct));
    }

    [HttpPut("{id:guid}")]
    [Authorize]
    public async Task<ActionResult<ListingDetailDto>> Update(Guid id, ListingUpsertRequest request, CancellationToken ct)
    {
        var listing = await FindOwned(id, ct);
        if (listing is null) return NotFound();
        if (Apply(listing, request) is { } invalid) return invalid;
        listing.MarkEdited(clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return await LoadDetail(id, ct);
    }

    [HttpPost("{id:guid}/submit")]
    [Authorize]
    public Task<ActionResult<ListingDetailDto>> Submit(Guid id, CancellationToken ct) =>
        Transition(id, l => l.Submit(clock.GetUtcNow()), ct);

    [HttpPost("{id:guid}/renew")]
    [Authorize]
    public Task<ActionResult<ListingDetailDto>> Renew(Guid id, CancellationToken ct) =>
        Transition(id, l => l.Renew(clock.GetUtcNow()), ct);

    /// <summary>Mark as sold/rented and take it down.</summary>
    [HttpPost("{id:guid}/archive")]
    [Authorize]
    public Task<ActionResult<ListingDetailDto>> Archive(Guid id, CancellationToken ct) =>
        Transition(id, l => l.Archive(clock.GetUtcNow()), ct);

    [HttpDelete("{id:guid}")]
    [Authorize]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var listing = await FindOwned(id, ct);
        if (listing is null) return NotFound();
        var keys = listing.Photos.SelectMany(p => new[] { p.LargeKey, p.ThumbKey }).ToList();
        db.Listings.Remove(listing);
        await db.SaveChangesAsync(ct);
        foreach (var key in keys) await storage.DeleteAsync(key, ct);
        return NoContent();
    }

    [HttpPost("{id:guid}/photos")]
    [Authorize]
    [RequestSizeLimit(60 * 1024 * 1024)]
    public async Task<ActionResult<IReadOnlyList<PhotoDto>>> UploadPhotos(Guid id, [FromForm] IFormFileCollection files, CancellationToken ct)
    {
        var listing = await FindOwned(id, ct);
        if (listing is null) return NotFound();
        if (files.Count == 0) return Problem("No files uploaded.", statusCode: 400);
        if (listing.Photos.Count + files.Count > MaxPhotos) return Problem($"A listing can have at most {MaxPhotos} photos.", statusCode: 400);

        var nextOrder = listing.Photos.Count == 0 ? 0 : listing.Photos.Max(p => p.SortOrder) + 1;
        foreach (var file in files)
        {
            if (!AllowedImageTypes.Contains(file.ContentType) || file.Length > 15 * 1024 * 1024)
                return Problem($"{file.FileName}: photos must be JPEG, PNG or WebP and under 15 MB.", statusCode: 400);

            ProcessedPhoto processed;
            try
            {
                await using var stream = file.OpenReadStream();
                processed = await photos.ProcessAsync(listing.Id, stream, ct);
            }
            catch (SixLabors.ImageSharp.ImageFormatException)
            {
                return Problem($"{file.FileName} is not a readable image.", statusCode: 400);
            }

            var photo = new ListingPhoto
            {
                ListingId = listing.Id,
                LargeKey = processed.LargeKey,
                ThumbKey = processed.ThumbKey,
                Width = processed.Width,
                Height = processed.Height,
                SortOrder = nextOrder++
            };
            // EF's relationship fix-up adds it to listing.Photos.
            db.ListingPhotos.Add(photo);
        }

        listing.UpdatedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(ct);
        return Ok(listing.Photos.OrderBy(p => p.SortOrder).Select(ToPhotoDto).ToList());
    }

    [HttpPut("{id:guid}/photos/order")]
    [Authorize]
    public async Task<ActionResult<IReadOnlyList<PhotoDto>>> ReorderPhotos(Guid id, ReorderPhotosRequest request, CancellationToken ct)
    {
        var listing = await FindOwned(id, ct);
        if (listing is null) return NotFound();
        if (!request.PhotoIds.Order().SequenceEqual(listing.Photos.Select(p => p.Id).Order()))
            return Problem("PhotoIds must list every photo of the listing exactly once.", statusCode: 400);

        for (var i = 0; i < request.PhotoIds.Count; i++)
            listing.Photos.Single(p => p.Id == request.PhotoIds[i]).SortOrder = i;
        await db.SaveChangesAsync(ct);
        return Ok(listing.Photos.OrderBy(p => p.SortOrder).Select(ToPhotoDto).ToList());
    }

    [HttpDelete("{id:guid}/photos/{photoId:guid}")]
    [Authorize]
    public async Task<IActionResult> DeletePhoto(Guid id, Guid photoId, CancellationToken ct)
    {
        var listing = await FindOwned(id, ct);
        var photo = listing?.Photos.FirstOrDefault(p => p.Id == photoId);
        if (photo is null) return NotFound();
        if (listing!.Photos.Count == 1 && listing.Status is ListingStatus.Active or ListingStatus.PendingReview)
            return Problem("Live ads need at least one photo. Add another before deleting this one.", statusCode: 400);
        db.ListingPhotos.Remove(photo);
        await db.SaveChangesAsync(ct);
        await storage.DeleteAsync(photo.LargeKey, ct);
        await storage.DeleteAsync(photo.ThumbKey, ct);
        return NoContent();
    }

    private async Task<ActionResult<ListingDetailDto>> Transition(Guid id, Action<Listing> change, CancellationToken ct)
    {
        var listing = await FindOwned(id, ct);
        if (listing is null) return NotFound();
        change(listing);
        await db.SaveChangesAsync(ct);
        return await LoadDetail(id, ct);
    }

    private Task<Listing?> FindOwned(Guid id, CancellationToken ct)
    {
        var userId = User.UserId();
        return db.Listings.Include(l => l.Photos).FirstOrDefaultAsync(l => l.Id == id && l.OwnerId == userId, ct);
    }

    private async Task<ListingDetailDto> LoadDetail(Guid id, CancellationToken ct)
    {
        var listing = await db.Listings.AsNoTracking()
            .Include(l => l.Photos)
            .Include(l => l.Owner).ThenInclude(o => o.Business)
            .FirstAsync(l => l.Id == id, ct);
        return ToDetail(listing, isMine: true, isFavorite: false);
    }

    /// <summary>Validates the request against the category and location lists and copies it onto the listing.</summary>
    private ActionResult? Apply(Listing listing, ListingUpsertRequest r)
    {
        var errors = new Dictionary<string, string[]>();
        var category = Categories.Find(r.Category);
        if (category is null) errors["category"] = [$"Unknown category '{r.Category}'."];
        else if (!category.Deals.Contains(r.DealType))
            errors["dealType"] = [$"{category.Name} ads can't be listed as {r.DealType}."];

        var municipality = Locations.Find(r.Municipality);
        var place = string.IsNullOrWhiteSpace(r.Place) ? null : r.Place.Trim();
        if (municipality is null) errors["municipality"] = [$"Unknown municipality '{r.Municipality}'."];
        else if (place is not null)
        {
            if (Locations.FindPlace(municipality, place) is { } known) place = known.Name;
            else errors["place"] = [$"'{place}' isn't a neighbourhood or village of {municipality.Name}. Leave it empty and use the address instead."];
        }
        if (r.Lat is null != r.Lng is null) errors["lat"] = ["Give both latitude and longitude, or neither."];

        var attributes = "{}";
        if (category is not null && !errors.ContainsKey("dealType"))
        {
            var (json, attributeErrors) = AttributeValidator.Normalize(category, r.DealType, r.Attributes);
            foreach (var (key, value) in attributeErrors) errors[key] = value;
            attributes = json;
        }

        if (errors.Count > 0) return ValidationProblem(new ValidationProblemDetails(errors));

        listing.Category = category!.Key;
        listing.DealType = r.DealType;
        listing.Title = r.Title.Trim();
        listing.Description = r.Description.Trim();
        listing.PriceEur = r.PriceEur;
        listing.Negotiable = r.Negotiable;
        listing.Municipality = municipality!.Name;
        listing.Place = place;
        listing.Address = string.IsNullOrWhiteSpace(r.Address) ? null : r.Address.Trim();
        listing.Location = r is { Lat: { } lat, Lng: { } lng } ? ListingQuery.PointAt(lat, lng) : ListingQuery.PointAt(municipality.Lat, municipality.Lng);
        listing.Attributes = attributes;
        return null;
    }

    private PhotoDto ToPhotoDto(ListingPhoto p) =>
        new(p.Id, storage.GetUrl(p.LargeKey), storage.GetUrl(p.ThumbKey), p.Width, p.Height);

    private ListingDetailDto ToDetail(Listing l, bool isMine, bool isFavorite)
    {
        var showModeration = isMine || User.IsAdmin();
        var owner = l.Owner;
        return new ListingDetailDto(
            l.Id, l.Category, l.DealType, l.Title, l.Description, l.PriceEur, l.Negotiable, l.PricePerM2,
            ListingMapping.ParseAttributes(l.Attributes),
            l.Municipality, l.Place, l.Address, l.Location.Y, l.Location.X,
            l.Photos.OrderBy(p => p.SortOrder).Select(ToPhotoDto).ToList(),
            new ListingOwnerDto(owner.Id, owner.DisplayName, !string.IsNullOrEmpty(owner.Phone), owner.CreatedAt,
                owner.Business?.Slug, owner.Business?.Name, owner.Business?.Kind),
            l.Status,
            showModeration ? l.ModerationNote : null,
            l.CreatedAt, l.PublishedAt, l.ExpiresAt,
            isMine && l.CanRenew(clock.GetUtcNow()),
            l.ViewCount, isFavorite, isMine);
    }
}
