using System.Globalization;
using System.Text;
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

    /// <summary>Finds a municipality by name, ignoring case and the ë/ç accents ("prishtine" finds Prishtinë).</summary>
    public static Municipality? Find(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;
        var key = Fold(name);
        return All.FirstOrDefault(m => m.Name == name) ?? All.FirstOrDefault(m => Fold(m.Name) == key);
    }

    /// <summary>Finds a neighbourhood or village of the municipality, with the same tolerance as <see cref="Find"/>.</summary>
    public static Place? FindPlace(Municipality m, string? place)
    {
        if (string.IsNullOrWhiteSpace(place)) return null;
        var key = Fold(place);
        return m.Places.FirstOrDefault(p => p.Name == place) ?? m.Places.FirstOrDefault(p => Fold(p.Name) == key);
    }

    public static string Fold(string s)
    {
        var decomposed = s.Trim().ToLowerInvariant().Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(decomposed.Length);
        foreach (var ch in decomposed)
            if (CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark) sb.Append(ch);
        return sb.ToString();
    }

    private static IReadOnlyList<Municipality> Load()
    {
        using var stream = typeof(Locations).Assembly.GetManifestResourceStream("RealEstate.Api.kosovo-locations.json")
                           ?? throw new InvalidOperationException("kosovo-locations.json is missing from the assembly.");
        return JsonSerializer.Deserialize<List<Municipality>>(stream, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
    }
}
