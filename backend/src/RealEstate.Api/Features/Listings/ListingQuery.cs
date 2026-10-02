using System.Globalization;
using Microsoft.EntityFrameworkCore;
using NetTopologySuite;
using NetTopologySuite.Geometries;
using RealEstate.Api.Domain;

namespace RealEstate.Api.Features.Listings;

public static class ListingQuery
{
    public static readonly GeometryFactory Geo = NtsGeometryServices.Instance.CreateGeometryFactory(srid: 4326);

    public static Point PointAt(double lat, double lng) => Geo.CreatePoint(new Coordinate(lng, lat));

    /// <summary>Applies every filter in the criteria. Status is left to the caller.</summary>
    public static IQueryable<Listing> Filter(this IQueryable<Listing> q, ListingSearchCriteria c)
    {
        if (c.DealType is { } deal) q = q.Where(l => l.DealType == deal);
        if (c.PropertyType is { } type) q = q.Where(l => l.PropertyType == type);
        if (!string.IsNullOrWhiteSpace(c.City)) q = q.Where(l => l.City == c.City);
        if (!string.IsNullOrWhiteSpace(c.Neighborhood)) q = q.Where(l => l.Neighborhood == c.Neighborhood);
        if (!string.IsNullOrWhiteSpace(c.Q))
        {
            var pattern = $"%{EscapeLike(c.Q.Trim())}%";
            q = q.Where(l => EF.Functions.ILike(l.Title, pattern)
                             || EF.Functions.ILike(l.Description, pattern)
                             || (l.Neighborhood != null && EF.Functions.ILike(l.Neighborhood, pattern))
                             || (l.Address != null && EF.Functions.ILike(l.Address, pattern)));
        }

        if (c.MinPrice is { } minPrice) q = q.Where(l => l.PriceEur >= minPrice);
        if (c.MaxPrice is { } maxPrice) q = q.Where(l => l.PriceEur <= maxPrice);
        if (c.MinArea is { } minArea) q = q.Where(l => l.AreaM2 >= minArea);
        if (c.MaxArea is { } maxArea) q = q.Where(l => l.AreaM2 <= maxArea);
        if (c.MinRooms is { } minRooms) q = q.Where(l => l.Rooms >= minRooms);
        if (c.MaxRooms is { } maxRooms) q = q.Where(l => l.Rooms <= maxRooms);
        if (c.MinFloor is { } minFloor) q = q.Where(l => l.Floor >= minFloor);
        if (c.MaxFloor is { } maxFloor) q = q.Where(l => l.Floor <= maxFloor);
        if (c.MinYearBuilt is { } minYear) q = q.Where(l => l.YearBuilt >= minYear);
        if (c.Heating is { } heating) q = q.Where(l => l.Heating == heating);
        if (c.HasParking is { } parking) q = q.Where(l => l.HasParking == parking);
        if (c.IsFurnished is { } furnished) q = q.Where(l => l.IsFurnished == furnished);
        if (c.HasElevator is { } elevator) q = q.Where(l => l.HasElevator == elevator);

        if (c.LegalizedOnly == true)
            q = q.Where(l => l.Legal.Legalization == LegalizationStatus.Legalized
                             || l.Legal.Legalization == LegalizationStatus.NotRequired);
        if (c.HasCadastreCertificate is { } cadastre) q = q.Where(l => l.Legal.HasCadastreCertificate == cadastre);
        if (c.HasConstructionPermit is { } permit) q = q.Where(l => l.Legal.HasConstructionPermit == permit);

        if (c is { Lat: { } lat, Lng: { } lng, RadiusKm: { } km } && km > 0)
        {
            var centre = PointAt(lat, lng);
            var metres = km * 1000;
            q = q.Where(l => l.Location.IsWithinDistance(centre, metres));
        }

        if (TryParseBbox(c.Bbox, out var box))
            q = q.Where(l => l.Location.Intersects(box));

        if (c.AgencyId is { } agencyId) q = q.Where(l => l.Owner.Agency != null && l.Owner.Agency.Id == agencyId);
        if (c.OwnerId is { } ownerId) q = q.Where(l => l.OwnerId == ownerId);

        return q;
    }

    public static IOrderedQueryable<Listing> Sort(this IQueryable<Listing> q, ListingSort sort) => sort switch
    {
        ListingSort.PriceAsc => q.OrderBy(l => l.PriceEur).ThenByDescending(l => l.PublishedAt),
        ListingSort.PriceDesc => q.OrderByDescending(l => l.PriceEur).ThenByDescending(l => l.PublishedAt),
        ListingSort.PricePerM2Asc => q.OrderBy(l => l.PricePerM2).ThenByDescending(l => l.PublishedAt),
        ListingSort.PricePerM2Desc => q.OrderByDescending(l => l.PricePerM2).ThenByDescending(l => l.PublishedAt),
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
