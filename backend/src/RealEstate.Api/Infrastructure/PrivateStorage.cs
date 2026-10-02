using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;

namespace RealEstate.Api.Infrastructure;

/// <summary>
/// Files only the API hands out after an access check, such as CVs. Unlike photo storage nothing here
/// has a public URL: local files live outside the /media folder, S3 objects in a private bucket or prefix.
/// </summary>
public interface IPrivateFileStorage
{
    Task SaveAsync(string key, Stream content, string contentType, CancellationToken ct);
    Task<Stream?> OpenReadAsync(string key, CancellationToken ct);
    Task DeleteAsync(string key, CancellationToken ct);
}

public class LocalPrivateFileStorage(IOptions<StorageOptions> options, IWebHostEnvironment env) : IPrivateFileStorage
{
    public string Root { get; } = Path.GetFullPath(Path.Combine(env.ContentRootPath, options.Value.PrivateLocalPath));

    public async Task SaveAsync(string key, Stream content, string contentType, CancellationToken ct)
    {
        var path = PathFor(key);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await using var file = File.Create(path);
        await content.CopyToAsync(file, ct);
    }

    public Task<Stream?> OpenReadAsync(string key, CancellationToken ct)
    {
        var path = PathFor(key);
        return Task.FromResult<Stream?>(File.Exists(path) ? File.OpenRead(path) : null);
    }

    public Task DeleteAsync(string key, CancellationToken ct)
    {
        var path = PathFor(key);
        if (File.Exists(path)) File.Delete(path);
        return Task.CompletedTask;
    }

    private string PathFor(string key)
    {
        var path = Path.GetFullPath(Path.Combine(Root, key));
        if (!path.StartsWith(Root, StringComparison.Ordinal)) throw new ArgumentException("Invalid key", nameof(key));
        return path;
    }
}

/// <summary>Uses <see cref="StorageOptions.S3PrivateBucket"/>, which must not allow public reads.</summary>
public class S3PrivateFileStorage(IAmazonS3 s3, IOptions<StorageOptions> options) : IPrivateFileStorage
{
    private string Bucket => options.Value.S3PrivateBucket
        ?? throw new InvalidOperationException("Storage:S3PrivateBucket must be set to store CVs.");

    public Task SaveAsync(string key, Stream content, string contentType, CancellationToken ct) =>
        s3.PutObjectAsync(new PutObjectRequest { BucketName = Bucket, Key = key, InputStream = content, ContentType = contentType }, ct);

    public async Task<Stream?> OpenReadAsync(string key, CancellationToken ct)
    {
        try
        {
            var response = await s3.GetObjectAsync(Bucket, key, ct);
            return response.ResponseStream;
        }
        catch (AmazonS3Exception e) when (e.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public Task DeleteAsync(string key, CancellationToken ct) => s3.DeleteObjectAsync(Bucket, key, ct);
}
