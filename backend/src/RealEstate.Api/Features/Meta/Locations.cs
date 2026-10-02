using System.Text.Json;

namespace RealEstate.Api.Features.Meta;

public record Place(string Name, string Kind);

public record Municipality(string Name, double Lat, double Lng, IReadOnlyList<Place> Places);

/// <summary>
/// Kosovo's 38 municipalities with their neighbourhoods and villages, from kosovo-locations.json.
/// Ads must pick a municipality from this list, and a place from that municipality's list if they give one.
/// </summary>
public static class Locations
{
    public static readonly IReadOnlyList<Municipality> All = Load();

    public static Municipality? Find(string? name) => All.FirstOrDefault(m => m.Name == name);

    public static bool HasPlace(Municipality m, string? place) => m.Places.Any(p => p.Name == place);

    private static IReadOnlyList<Municipality> Load()
    {
        using var stream = typeof(Locations).Assembly.GetManifestResourceStream("RealEstate.Api.kosovo-locations.json")
                           ?? throw new InvalidOperationException("kosovo-locations.json is missing from the assembly.");
        return JsonSerializer.Deserialize<List<Municipality>>(stream, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
    }
}
