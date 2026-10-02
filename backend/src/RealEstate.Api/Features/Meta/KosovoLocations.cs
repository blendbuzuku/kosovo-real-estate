namespace RealEstate.Api.Features.Meta;

public record CityInfo(string Name, double Lat, double Lng, IReadOnlyList<string> Neighborhoods);

/// <summary>Municipal centres used for the city dropdown and as the default map position.</summary>
public static class KosovoLocations
{
    public static readonly IReadOnlyList<CityInfo> Cities =
    [
        new("Prishtinë", 42.6629, 21.1655,
        [
            "Qendra", "Dardania", "Ulpiana", "Kodra e Diellit", "Bregu i Diellit", "Arbëria", "Kalabria",
            "Lakrishte", "Mati 1", "Veternik", "Emshir", "Tophane", "Velania", "Aktash", "Kodra e Trimave"
        ]),
        new("Prizren", 42.2139, 20.7397, ["Qendra", "Bazhdarhane", "Ortakoll", "Arbana", "Marash", "Jeni Mahalle", "Tusus"]),
        new("Pejë", 42.6593, 20.2887, ["Qendra", "Karagaç", "Kristal", "Dardania"]),
        new("Gjakovë", 42.3803, 20.4308, ["Qendra", "Çarshia e Madhe", "Blloku i Ri"]),
        new("Ferizaj", 42.3702, 21.1553, ["Qendra", "Dardania", "Bajram Curri"]),
        new("Gjilan", 42.4635, 21.4694, ["Qendra", "Dardania", "Arbëria"]),
        new("Mitrovicë", 42.8914, 20.8660, ["Qendra", "Bair", "Tavnik"]),
        new("Podujevë", 42.9106, 21.1931, ["Qendra"]),
        new("Vushtrri", 42.8231, 20.9675, ["Qendra"]),
        new("Fushë Kosovë", 42.6381, 21.0961, ["Qendra"]),
        new("Lipjan", 42.5217, 21.1258, ["Qendra"]),
        new("Drenas", 42.6253, 20.8939, ["Qendra"]),
        new("Suharekë", 42.3580, 20.8250, ["Qendra"]),
        new("Rahovec", 42.3992, 20.6547, ["Qendra"]),
        new("Malishevë", 42.4828, 20.7458, ["Qendra"]),
        new("Kamenicë", 42.5781, 21.5803, ["Qendra"]),
        new("Viti", 42.3214, 21.3581, ["Qendra"]),
        new("Deçan", 42.5402, 20.2880, ["Qendra"]),
        new("Istog", 42.7808, 20.4875, ["Qendra"]),
        new("Klinë", 42.6211, 20.5778, ["Qendra"]),
        new("Skenderaj", 42.7467, 20.7886, ["Qendra"]),
        new("Dragash", 42.0625, 20.6533, ["Qendra"]),
        new("Shtime", 42.4331, 21.0397, ["Qendra"]),
        new("Kaçanik", 42.2311, 21.2594, ["Qendra"]),
        new("Obiliq", 42.6869, 21.0769, ["Qendra"]),
        new("Graçanicë", 42.6000, 21.1933, ["Qendra"])
    ];
}
