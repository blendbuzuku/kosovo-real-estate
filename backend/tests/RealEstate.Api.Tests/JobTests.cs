using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using RealEstate.Api.Domain;
using RealEstate.Api.Features.Jobs;
using RealEstate.Api.Features.Listings;
using RealEstate.Api.Features.Messaging;

namespace RealEstate.Api.Tests;

public class JobTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly byte[] Pdf = Encoding.ASCII.GetBytes("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");

    private static ListingUpsertRequest JobAd(decimal salary = 900, bool cvRequired = false) => new()
    {
        Category = "jobs",
        DealType = DealType.Job,
        Title = "Junior .NET developer",
        Description = "Backend work with ASP.NET Core and PostgreSQL, mentoring included.",
        PriceEur = salary,
        Municipality = "Prishtinë",
        Attributes = TestData.Attrs(new { sector = "IT & software", employmentType = "FullTime", workplace = "Hybrid", cvRequired })
    };

    /// <summary>Job ads need no photo, so they go straight from draft to review.</summary>
    private async Task<ListingDetailDto> LiveJob(HttpClient employer, ListingUpsertRequest? ad = null)
    {
        var job = await TestData.CreateListing(employer, ad ?? JobAd());
        (await employer.PostAsync($"/api/listings/{job.Id}/submit", null)).EnsureSuccessStatusCode();
        var admin = await factory.ClientFor(ApiFactory.AdminEmail, ApiFactory.AdminPassword);
        (await admin.PostAsync($"/api/admin/listings/{job.Id}/approve", null)).EnsureSuccessStatusCode();
        return job;
    }

    private static Task<HttpResponseMessage> Apply(HttpClient client, Guid jobId, string letter = "I'd love to join, I have built two APIs at university.",
        byte[]? cv = null, string cvName = "Drita Berisha CV.pdf")
    {
        var form = new MultipartFormDataContent { { new StringContent(letter), "coverLetter" }, { new StringContent("+383 44 222 333"), "phone" } };
        if (cv is not null)
        {
            var file = new ByteArrayContent(cv);
            file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
            form.Add(file, "cv", cvName);
        }
        return client.PostAsync($"/api/listings/{jobId}/applications", form);
    }

    [Fact]
    public async Task Applicant_applies_with_a_cv_and_the_employer_reviews_it()
    {
        var (employer, _) = await factory.Register(BusinessKind.Company);
        var job = await LiveJob(employer);
        var (applicant, me) = await factory.Register();

        var mine = await (await Apply(applicant, job.Id, cv: Pdf)).Read<MyApplicationDto>();
        Assert.Equal(ApplicationStatus.New, mine.Status);
        Assert.Equal("Drita Berisha CV.pdf", mine.CvFileName);
        Assert.Equal(HttpStatusCode.Conflict, (await Apply(applicant, job.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Apply(employer, job.Id)).StatusCode);

        // The employer sees the applicant and the application in the inbox.
        var list = await (await employer.GetAsync($"/api/listings/{job.Id}/applications")).Read<JobApplicantsDto>();
        var applicant1 = Assert.Single(list.Applicants);
        Assert.Equal(me.Id, applicant1.ApplicantId);
        Assert.Equal("+383 44 222 333", applicant1.Phone);
        var messages = await (await employer.GetAsync($"/api/conversations/{applicant1.ConversationId}/messages")).Read<List<MessageDto>>();
        Assert.Equal(mine.Id, Assert.Single(messages).Application?.Id);
        Assert.Contains(factory.Email.Sent, m => m.Subject.Contains("New application"));

        // Only the employer and the applicant can download the CV.
        var cv = await employer.GetAsync($"/api/applications/{mine.Id}/cv");
        Assert.Equal(HttpStatusCode.OK, cv.StatusCode);
        Assert.Equal("application/pdf", cv.Content.Headers.ContentType?.MediaType);
        Assert.Equal(Pdf, await cv.Content.ReadAsByteArrayAsync());
        Assert.Equal(HttpStatusCode.OK, (await applicant.GetAsync($"/api/applications/{mine.Id}/cv")).StatusCode);
        var (stranger, _) = await factory.Register();
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/applications/{mine.Id}/cv")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync($"/api/applications/{mine.Id}/cv")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/listings/{job.Id}/applications")).StatusCode);

        // Shortlisting is visible to the applicant and emails them.
        var updated = await (await employer.PutAsJsonAsync($"/api/applications/{mine.Id}/status",
            new SetApplicationStatusRequest(ApplicationStatus.Shortlisted), ApiFactory.Json)).Read<ApplicantDto>();
        Assert.Equal(ApplicationStatus.Shortlisted, updated.Status);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PutAsJsonAsync($"/api/applications/{mine.Id}/status",
            new SetApplicationStatusRequest(ApplicationStatus.Rejected), ApiFactory.Json)).StatusCode);
        var myList = await (await applicant.GetAsync("/api/me/applications")).Read<List<MyApplicationDto>>();
        Assert.Equal(ApplicationStatus.Shortlisted, Assert.Single(myList).Status);
        Assert.Equal(ApplicationStatus.Shortlisted, (await (await applicant.GetAsync($"/api/listings/{job.Id}/applications/mine")).Read<MyApplicationDto>()).Status);
        Assert.Equal(HttpStatusCode.NoContent, (await stranger.GetAsync($"/api/listings/{job.Id}/applications/mine")).StatusCode);
    }

    [Fact]
    public async Task Cv_rules_salary_and_photos()
    {
        var (employer, _) = await factory.Register(BusinessKind.Company);
        // Salary can be left for the interview (0), and no photo is needed to go live.
        var job = await LiveJob(employer, JobAd(salary: 0, cvRequired: true));
        Assert.Equal(0, job.PriceEur);
        var (applicant, _) = await factory.Register();

        Assert.Equal(HttpStatusCode.BadRequest, (await Apply(applicant, job.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Apply(applicant, job.Id, cv: Encoding.ASCII.GetBytes("MZ not a pdf"), cvName: "cv.pdf")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Apply(applicant, job.Id, cv: new byte[JobApplicationsController.MaxCvBytes + 1])).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Apply(applicant, job.Id, cv: Pdf)).StatusCode);

        // Other ads still need a price and a photo, and don't take applications.
        Assert.Equal(HttpStatusCode.BadRequest, (await employer.PostAsJsonAsync("/api/listings", TestData.Item(price: 0), ApiFactory.Json)).StatusCode);
        var item = await TestData.CreateListing(employer, TestData.Item());
        Assert.Equal(HttpStatusCode.Conflict, (await employer.PostAsync($"/api/listings/{item.Id}/submit", null)).StatusCode);
        var flat = await TestData.CreateLiveListing(factory, employer);
        Assert.Equal(HttpStatusCode.BadRequest, (await Apply(applicant, flat.Id)).StatusCode);
        // Jobs are only offered as jobs.
        Assert.Equal(HttpStatusCode.BadRequest, (await employer.PostAsJsonAsync("/api/listings", JobAd() with { DealType = DealType.Sale }, ApiFactory.Json)).StatusCode);
    }
}
