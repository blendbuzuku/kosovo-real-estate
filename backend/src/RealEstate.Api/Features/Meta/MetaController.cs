using Microsoft.AspNetCore.Mvc;

namespace RealEstate.Api.Features.Meta;

[ApiController]
[Route("api/meta")]
public class MetaController : ControllerBase
{
    [HttpGet("cities")]
    [ResponseCache(Duration = 3600)]
    public IReadOnlyList<CityInfo> Cities() => KosovoLocations.Cities;
}
