namespace RealEstate.Api.Domain;

public enum UserRole
{
    Seeker,
    Owner,
    Agency,
    Admin
}

public enum PropertyType
{
    Apartment,
    House,
    Land,
    Commercial
}

public enum DealType
{
    Sale,
    RentMonthly,
    RentShortTerm
}

public enum HeatingType
{
    None,
    District,
    Central,
    Electric,
    HeatPump,
    AirConditioning,
    Wood,
    Other
}

public enum ListingStatus
{
    Draft,
    PendingReview,
    Active,
    Rejected,
    Expired,
    Archived
}

/// <summary>Whether the building has been legalized under Kosovo's legalization law.</summary>
public enum LegalizationStatus
{
    Unknown,
    Legalized,
    InProcess,
    NotLegalized,
    NotRequired
}

public enum ListingSort
{
    Newest,
    PriceAsc,
    PriceDesc,
    PricePerM2Asc,
    PricePerM2Desc
}

public enum ReportReason
{
    Spam,
    Fraud,
    WrongInformation,
    NoLongerAvailable,
    Duplicate,
    Offensive,
    Other
}

public enum ReportStatus
{
    Open,
    Dismissed,
    ListingRemoved
}
