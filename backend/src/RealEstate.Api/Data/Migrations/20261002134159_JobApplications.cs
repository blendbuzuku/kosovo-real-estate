using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RealEstate.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class JobApplications : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "application_id",
                table: "messages",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "job_applications",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    listing_id = table.Column<Guid>(type: "uuid", nullable: false),
                    applicant_id = table.Column<Guid>(type: "uuid", nullable: false),
                    conversation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    cover_letter = table.Column<string>(type: "character varying(5000)", maxLength: 5000, nullable: false),
                    phone = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    cv_key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    cv_file_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    cv_content_type = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_job_applications", x => x.id);
                    table.ForeignKey(
                        name: "fk_job_applications_conversations_conversation_id",
                        column: x => x.conversation_id,
                        principalTable: "conversations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_job_applications_listings_listing_id",
                        column: x => x.listing_id,
                        principalTable: "listings",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_job_applications_users_applicant_id",
                        column: x => x.applicant_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_messages_application_id",
                table: "messages",
                column: "application_id");

            migrationBuilder.CreateIndex(
                name: "ix_job_applications_applicant_id",
                table: "job_applications",
                column: "applicant_id");

            migrationBuilder.CreateIndex(
                name: "ix_job_applications_conversation_id",
                table: "job_applications",
                column: "conversation_id");

            migrationBuilder.CreateIndex(
                name: "ix_job_applications_listing_id_applicant_id",
                table: "job_applications",
                columns: new[] { "listing_id", "applicant_id" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "fk_messages_job_applications_application_id",
                table: "messages",
                column: "application_id",
                principalTable: "job_applications",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_messages_job_applications_application_id",
                table: "messages");

            migrationBuilder.DropTable(
                name: "job_applications");

            migrationBuilder.DropIndex(
                name: "ix_messages_application_id",
                table: "messages");

            migrationBuilder.DropColumn(
                name: "application_id",
                table: "messages");
        }
    }
}
