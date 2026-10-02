namespace RealEstate.Api.Domain;

public enum UserRole
{
    Member,
    Business,
    Admin
}

/// <summary>What kind of business runs a business account. Shown on its public page and on its ads.</summary>
public enum BusinessKind
{
    RealEstateAgency,
    Developer,
    CarDealer,
    RentACar,
    Shop,
    Company,
    Other
}

public enum DealType
{
    Sale,
    RentMonthly,
    RentNightly,
    RentDaily,
    /// <summary>A job opening; the price is the monthly salary, 0 when it's agreed at interview.</summary>
    Job
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

public enum SellerType
{
    Private,
    Business
}

public enum ListingSort
{
    Newest,
    PriceAsc,
    PriceDesc,
    PricePerM2Asc,
    YearDesc,
    MileageAsc
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

public enum ApplicationStatus
{
    New,
    Shortlisted,
    Rejected
}

public enum ReportStatus
{
    Open,
    Dismissed,
    ListingRemoved
}
