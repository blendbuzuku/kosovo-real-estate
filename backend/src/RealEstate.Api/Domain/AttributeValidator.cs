using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace RealEstate.Api.Domain;

/// <summary>
/// Checks submitted attributes against the category's fields and returns a normalised JSON object
/// (numbers as numbers, yes/no as booleans, unknown or empty values dropped).
/// </summary>
public static class AttributeValidator
{
    public static (string Json, Dictionary<string, string[]> Errors) Normalize(
        CategoryDef category, DealType deal, IReadOnlyDictionary<string, JsonElement>? input)
    {
        var errors = new Dictionary<string, string[]>();
        var output = new JsonObject();
        input ??= new Dictionary<string, JsonElement>();

        foreach (var key in input.Keys)
            if (category.Field(key) is null)
                errors[$"attributes.{key}"] = [$"{category.Name} ads don't have a field called '{key}'."];

        foreach (var field in category.Fields)
        {
            if (!field.AppliesTo(deal)) continue;
            input.TryGetValue(field.Key, out var raw);
            var empty = raw.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null ||
                        (raw.ValueKind == JsonValueKind.String && string.IsNullOrWhiteSpace(raw.GetString()));
            if (empty)
            {
                if (field.Required) errors[$"attributes.{field.Key}"] = [$"{field.Label} is required."];
                continue;
            }

            var (node, error) = Convert(field, raw);
            if (error is not null) errors[$"attributes.{field.Key}"] = [error];
            else output[field.Key] = node;
        }

        return (output.ToJsonString(), errors);
    }

    private static (JsonNode? Node, string? Error) Convert(FieldDef f, JsonElement raw)
    {
        switch (f.Type)
        {
            case FieldType.Number:
            case FieldType.Integer:
            case FieldType.Year:
            {
                decimal value;
                if (raw.ValueKind == JsonValueKind.Number) value = raw.GetDecimal();
                else if (raw.ValueKind == JsonValueKind.String &&
                         decimal.TryParse(raw.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed)) value = parsed;
                else return (null, $"{f.Label} must be a number.");

                if (f.Type != FieldType.Number && value != decimal.Truncate(value)) return (null, $"{f.Label} must be a whole number.");
                if (f.Min is { } min && value < min) return (null, $"{f.Label} must be at least {min}.");
                if (f.Max is { } max && value > max) return (null, $"{f.Label} must be at most {max}.");
                return (f.Type == FieldType.Number ? JsonValue.Create(value) : JsonValue.Create((long)value), null);
            }
            case FieldType.Boolean:
                return raw.ValueKind switch
                {
                    JsonValueKind.True => (JsonValue.Create(true), null),
                    JsonValueKind.False => (JsonValue.Create(false), null),
                    JsonValueKind.String when bool.TryParse(raw.GetString(), out var b) => (JsonValue.Create(b), null),
                    _ => (null, $"{f.Label} must be yes or no.")
                };
            case FieldType.Select:
            {
                var value = raw.ValueKind == JsonValueKind.String ? raw.GetString()!.Trim() : raw.ToString();
                return f.Options!.Any(o => o.Value == value)
                    ? (JsonValue.Create(value), null)
                    : (null, $"'{value}' isn't a valid choice for {f.Label}.");
            }
            default:
            {
                var value = raw.ValueKind == JsonValueKind.String ? raw.GetString()!.Trim() : raw.ToString();
                return value.Length > 1000 ? (null, $"{f.Label} is too long.") : (JsonValue.Create(value), null);
            }
        }
    }
}
