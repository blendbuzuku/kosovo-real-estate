using System.Globalization;
using Microsoft.EntityFrameworkCore;
using NetTopologySuite;
using NetTopologySuite.Geometries;
using RealEstate.Api.Data;
using RealEstate.Api.Domain;

namespace RealEstate.Api.Features.Listings;

public static class ListingQuery
{
    public static readonly GeometryFactory Geo = NtsGeometryServices.Instance.CreateGeometryFactory(srid: 4326);

    public static Point PointAt(double lat, double lng) => Geo.CreatePoint(new Coordinate(lng, lat));

    /// <summary>Reads "f.rooms.min=2"-style query parameters into the criteria's field filters.</summary>
    public static ListingSearchCriteria WithFieldFilters(this ListingSearchCriteria c, IQueryCollection query)
    {
        var filters = query
            .Where(q => q.Key.StartsWith("f.", StringComparison.Ordinal) && !string.IsNullOrWhiteSpace(q.Value))
            .ToDictionary(q => q.Key[2..], q => q.Value.ToString());
        return filters.Count == 0 ? c : c with { F = filters };
    }

    /// <summary>Applies every filter in the criteria. Status is left to the caller.</summary>
    public static IQueryable<Listing> Filter(this IQueryable<Listing> q, ListingSearchCriteria c)
    {
        if (!string.IsNullOrEmpty(c.Category)) q = q.Where(l => l.Category == c.Category);
        else if (!string.IsNullOrEmpty(c.Vertical))
        {
            var keys = Categories.InVertical(c.Vertical).Select(x => x.Key).ToList();
            q = q.Where(l => keys.Contains(l.Category));
        }
        if (c.DealType is { } deal) q = q.Where(l => l.DealType == deal);
        if (!string.IsNullOrWhiteSpace(c.Municipality)) q = q.Where(l => l.Municipality == c.Municipality);
        if (!string.IsNullOrWhiteSpace(c.Place)) q = q.Where(l => l.Place == c.Place);
        if (!string.IsNullOrWhiteSpace(c.Q))
        {
            var pattern = $"%{EscapeLike(c.Q.Trim())}%";
            q = q.Where(l => EF.Functions.ILike(l.Title, pattern)
                             || EF.Functions.ILike(l.Description, pattern)
                             || (l.Place != null && EF.Functions.ILike(l.Place, pattern))
                             || (l.Address != null && EF.Functions.ILike(l.Address, pattern)));
        }

        if (c.MinPrice is { } minPrice) q = q.Where(l => l.PriceEur >= minPrice);
        if (c.MaxPrice is { } maxPrice) q = q.Where(l => l.PriceEur <= maxPrice);
        if (c.Seller == SellerType.Business) q = q.Where(l => l.Owner.Business != null);
        if (c.Seller == SellerType.Private) q = q.Where(l => l.Owner.Business == null);

        if (c is { Lat: { } lat, Lng: { } lng, RadiusKm: { } km } && km > 0)
        {
            var centre = PointAt(lat, lng);
            var metres = km * 1000;
            q = q.Where(l => l.Location.IsWithinDistance(centre, metres));
        }

        if (TryParseBbox(c.Bbox, out var box))
            q = q.Where(l => l.Location.Intersects(box));

        if (c.BusinessId is { } businessId) q = q.Where(l => l.Owner.Business != null && l.Owner.Business.Id == businessId);
        if (c.OwnerId is { } ownerId) q = q.Where(l => l.OwnerId == ownerId);

        if (c.F is { Count: > 0 }) q = ApplyFieldFilters(q, c);
        return q;
    }

    /// <summary>
    /// Field filters only apply to fields the searched categories actually have; unknown keys are
    /// ignored so an old saved search never breaks.
    /// </summary>
    private static IQueryable<Listing> ApplyFieldFilters(IQueryable<Listing> q, ListingSearchCriteria c)
    {
        List<CategoryDef> categories = Categories.Find(c.Category) is { } one ? [one] : Categories.InVertical(c.Vertical).ToList();
        FieldDef? FieldFor(string key) => categories.Select(cat => cat.Field(key)).FirstOrDefault(f => f is not null);

        foreach (var (rawKey, value) in c.F!)
        {
            var dot = rawKey.LastIndexOf('.');
            var (key, bound) = dot > 0 && rawKey[(dot + 1)..] is "min" or "max" ? (rawKey[..dot], rawKey[(dot + 1)..]) : (rawKey, null);
            var field = FieldFor(key);
            if (field is null || field.Filter == FilterKind.None) continue;

            if (field.Type is FieldType.Number or FieldType.Integer or FieldType.Year)
            {
                if (!decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var n)) continue;
                q = bound == "max"
                    ? q.Where(l => Attr.Num(l.Attributes, key) <= n)
                    : q.Where(l => Attr.Num(l.Attributes, key) >= n);
            }
            else if (field.Filter == FilterKind.Contains)
            {
                var pattern = $"%{EscapeLike(value.Trim())}%";
                q = q.Where(l => EF.Functions.ILike(Attr.Text(l.Attributes, key)!, pattern));
            }
            else if (field.Type == FieldType.Boolean)
            {
                var wanted = value.Equals("true", StringComparison.OrdinalIgnoreCase) ? "true" : "false";
                q = q.Where(l => Attr.Text(l.Attributes, key) == wanted);
            }
            else
            {
                var values = value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
                q = q.Where(l => values.Contains(Attr.Text(l.Attributes, key)!));
            }
        }
        return q;
    }

    public static IOrderedQueryable<Listing> Sort(this IQueryable<Listing> q, ListingSort sort) => sort switch
    {
        ListingSort.PriceAsc => q.OrderBy(l => l.PriceEur).ThenByDescending(l => l.PublishedAt),
        ListingSort.PriceDesc => q.OrderByDescending(l => l.PriceEur).ThenByDescending(l => l.PublishedAt),
        ListingSort.PricePerM2Asc => q.OrderBy(l => l.PricePerM2 == null).ThenBy(l => l.PricePerM2).ThenByDescending(l => l.PublishedAt),
        ListingSort.YearDesc => q.OrderBy(l => Attr.Num(l.Attributes, "year") == null)
            .ThenByDescending(l => Attr.Num(l.Attributes, "year")).ThenByDescending(l => l.PublishedAt),
        ListingSort.MileageAsc => q.OrderBy(l => Attr.Num(l.Attributes, "mileageKm") == null)
            .ThenBy(l => Attr.Num(l.Attributes, "mileageKm")).ThenByDescending(l => l.PublishedAt),
        _ => q.OrderByDescending(l => l.PublishedAt).ThenByDescending(l => l.CreatedAt)
    };

    public static bool TryParseBbox(string? bbox, out Polygon box)
    {
        box = null!;
        if (string.IsNullOrWhiteSpace(bbox)) return false;
        var parts = bbox.Split(',');
        if (parts.Length != 4) return false;
        var v = new double[4];
        for (var i = 0; i < 4; i++)
            if (!double.TryParse(parts[i], NumberStyles.Float, CultureInfo.InvariantCulture, out v[i])) return false;
        var (minLng, minLat, maxLng, maxLat) = (v[0], v[1], v[2], v[3]);
        if (minLng >= maxLng || minLat >= maxLat) return false;
        box = Geo.CreatePolygon(
        [
            new(minLng, minLat), new(maxLng, minLat), new(maxLng, maxLat), new(minLng, maxLat), new(minLng, minLat)
        ]);
        return true;
    }

    private static string EscapeLike(string s) => s.Replace(@"\", @"\\").Replace("%", @"\%").Replace("_", @"\_");
}
