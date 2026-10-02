using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Processing;

namespace RealEstate.Api.Infrastructure;

public class StorageOptions
{
    public const string Section = "Storage";
    /// <summary>"Local" (disk, served by the API under /media) or "S3" (any S3-compatible store: AWS, MinIO, Cloudflare R2).</summary>
    public string Provider { get; set; } = "Local";
    public string LocalPath { get; set; } = "media";
    /// <summary>Base URL photos are served from, e.g. https://cdn.example.com. Defaults to /media for local storage.</summary>
    public string? PublicBaseUrl { get; set; }

    public string? S3Bucket { get; set; }
    public string? S3ServiceUrl { get; set; }
    public string? S3AccessKey { get; set; }
    public string? S3SecretKey { get; set; }
    public string S3Region { get; set; } = "eu-central-1";
}

public interface IFileStorage
{
    Task SaveAsync(string key, Stream content, string contentType, CancellationToken ct);
    Task DeleteAsync(string key, CancellationToken ct);
    string GetUrl(string key);
}

public class LocalFileStorage(IOptions<StorageOptions> options, IWebHostEnvironment env) : IFileStorage
{
    public string Root { get; } = Path.GetFullPath(Path.Combine(env.ContentRootPath, options.Value.LocalPath));

    public async Task SaveAsync(string key, Stream content, string contentType, CancellationToken ct)
    {
        var path = PathFor(key);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await using var file = File.Create(path);
        await content.CopyToAsync(file, ct);
    }

    public Task DeleteAsync(string key, CancellationToken ct)
    {
        var path = PathFor(key);
        if (File.Exists(path)) File.Delete(path);
        return Task.CompletedTask;
    }

    public string GetUrl(string key) => $"{(options.Value.PublicBaseUrl ?? "/media").TrimEnd('/')}/{key}";

    private string PathFor(string key)
    {
        var path = Path.GetFullPath(Path.Combine(Root, key));
        if (!path.StartsWith(Root, StringComparison.Ordinal)) throw new ArgumentException("Invalid key", nameof(key));
        return path;
    }
}

public class S3FileStorage(IAmazonS3 s3, IOptions<StorageOptions> options) : IFileStorage
{
    private StorageOptions O => options.Value;

    public Task SaveAsync(string key, Stream content, string contentType, CancellationToken ct) =>
        s3.PutObjectAsync(new PutObjectRequest
        {
            BucketName = O.S3Bucket,
            Key = key,
            InputStream = content,
            ContentType = contentType,
            Headers = { CacheControl = "public, max-age=31536000, immutable" }
        }, ct);

    public Task DeleteAsync(string key, CancellationToken ct) => s3.DeleteObjectAsync(O.S3Bucket, key, ct);

    public string GetUrl(string key) => $"{O.PublicBaseUrl!.TrimEnd('/')}/{key}";
}

public record ProcessedPhoto(string LargeKey, string ThumbKey, int Width, int Height);

/// <summary>Resizes uploads to a large and a thumbnail JPEG and strips EXIF (which can contain the uploader's GPS position).</summary>
public class PhotoProcessor(IFileStorage storage)
{
    public const int LargeMax = 1600;
    public const int ThumbWidth = 480;
    public const int ThumbHeight = 360;

    public async Task<ProcessedPhoto> ProcessAsync(Guid listingId, Stream upload, CancellationToken ct)
    {
        using var image = await Image.LoadAsync(upload, ct);
        image.Mutate(x => x.AutoOrient());
        image.Metadata.ExifProfile = null;
        image.Metadata.XmpProfile = null;

        var id = Guid.NewGuid().ToString("N");
        var largeKey = $"listings/{listingId:N}/{id}.jpg";
        var thumbKey = $"listings/{listingId:N}/{id}_thumb.jpg";
        var encoder = new JpegEncoder { Quality = 82 };

        int width, height;
        using (var large = image.Clone(x => x.Resize(new ResizeOptions { Mode = ResizeMode.Max, Size = new Size(LargeMax, LargeMax) })))
        {
            (width, height) = (large.Width, large.Height);
            await SaveAsync(large, largeKey, encoder, ct);
        }

        using (var thumb = image.Clone(x => x.Resize(new ResizeOptions { Mode = ResizeMode.Crop, Size = new Size(ThumbWidth, ThumbHeight) })))
        {
            await SaveAsync(thumb, thumbKey, encoder, ct);
        }

        return new ProcessedPhoto(largeKey, thumbKey, width, height);
    }

    private async Task SaveAsync(Image image, string key, JpegEncoder encoder, CancellationToken ct)
    {
        using var ms = new MemoryStream();
        await image.SaveAsJpegAsync(ms, encoder, ct);
        ms.Position = 0;
        await storage.SaveAsync(key, ms, "image/jpeg", ct);
    }
}
