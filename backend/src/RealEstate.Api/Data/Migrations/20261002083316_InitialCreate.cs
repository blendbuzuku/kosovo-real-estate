using System;
using Microsoft.EntityFrameworkCore.Migrations;
using RealEstate.Api.Data;
using NetTopologySuite.Geometries;

#nullable disable

namespace RealEstate.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The attributes functions must exist before the price_per_m2 generated column uses them.
            migrationBuilder.Sql(Attr.CreateFunctionsSql);

            migrationBuilder.AlterDatabase()
                .Annotation("Npgsql:PostgresExtension:postgis", ",,");

            migrationBuilder.CreateTable(
                name: "users",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    email = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    password_hash = table.Column<string>(type: "text", nullable: false),
                    display_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    phone = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    role = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_users", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "businesses",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    slug = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    website = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    municipality = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    address = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_businesses", x => x.id);
                    table.ForeignKey(
                        name: "fk_businesses_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "listings",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    owner_id = table.Column<Guid>(type: "uuid", nullable: false),
                    category = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    deal_type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    title = table.Column<string>(type: "character varying(140)", maxLength: 140, nullable: false),
                    description = table.Column<string>(type: "character varying(5000)", maxLength: 5000, nullable: false),
                    price_eur = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false),
                    negotiable = table.Column<bool>(type: "boolean", nullable: false),
                    price_per_m2 = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: true, computedColumnSql: "round(price_eur / nullif(attr_num(attributes, 'areaM2'), 0), 2)", stored: true),
                    attributes = table.Column<string>(type: "jsonb", nullable: false),
                    municipality = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    place = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    address = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    location = table.Column<Point>(type: "geography (point, 4326)", nullable: false),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    moderation_note = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    submitted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    published_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    expiry_reminder_sent_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    view_count = table.Column<int>(type: "integer", nullable: false),
                    phone_reveal_count = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_listings", x => x.id);
                    table.ForeignKey(
                        name: "fk_listings_users_owner_id",
                        column: x => x.owner_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "saved_searches",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    criteria = table.Column<string>(type: "jsonb", nullable: false),
                    email_alerts = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    last_alerted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_saved_searches", x => x.id);
                    table.ForeignKey(
                        name: "fk_saved_searches_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "conversations",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    listing_id = table.Column<Guid>(type: "uuid", nullable: false),
                    seeker_id = table.Column<Guid>(type: "uuid", nullable: false),
                    owner_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    last_message_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_conversations", x => x.id);
                    table.ForeignKey(
                        name: "fk_conversations_listings_listing_id",
                        column: x => x.listing_id,
                        principalTable: "listings",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_conversations_users_owner_id",
                        column: x => x.owner_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_conversations_users_seeker_id",
                        column: x => x.seeker_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "favorites",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    listing_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_favorites", x => new { x.user_id, x.listing_id });
                    table.ForeignKey(
                        name: "fk_favorites_listings_listing_id",
                        column: x => x.listing_id,
                        principalTable: "listings",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_favorites_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "listing_photos",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    listing_id = table.Column<Guid>(type: "uuid", nullable: false),
                    large_key = table.Column<string>(type: "text", nullable: false),
                    thumb_key = table.Column<string>(type: "text", nullable: false),
                    width = table.Column<int>(type: "integer", nullable: false),
                    height = table.Column<int>(type: "integer", nullable: false),
                    sort_order = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_listing_photos", x => x.id);
                    table.ForeignKey(
                        name: "fk_listing_photos_listings_listing_id",
                        column: x => x.listing_id,
                        principalTable: "listings",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "listing_reports",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    listing_id = table.Column<Guid>(type: "uuid", nullable: false),
                    reporter_id = table.Column<Guid>(type: "uuid", nullable: false),
                    reason = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    comment = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    resolved_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_listing_reports", x => x.id);
                    table.ForeignKey(
                        name: "fk_listing_reports_listings_listing_id",
                        column: x => x.listing_id,
                        principalTable: "listings",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "messages",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    conversation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    sender_id = table.Column<Guid>(type: "uuid", nullable: false),
                    body = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    sent_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    read_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    booking_from = table.Column<DateOnly>(type: "date", nullable: true),
                    booking_to = table.Column<DateOnly>(type: "date", nullable: true),
                    booking_guests = table.Column<int>(type: "integer", nullable: true),
                    booking_units = table.Column<int>(type: "integer", nullable: true),
                    booking_total_eur = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_messages", x => x.id);
                    table.ForeignKey(
                        name: "fk_messages_conversations_conversation_id",
                        column: x => x.conversation_id,
                        principalTable: "conversations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_businesses_slug",
                table: "businesses",
                column: "slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_businesses_user_id",
                table: "businesses",
                column: "user_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_conversations_listing_id_seeker_id",
                table: "conversations",
                columns: new[] { "listing_id", "seeker_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_conversations_owner_id",
                table: "conversations",
                column: "owner_id");

            migrationBuilder.CreateIndex(
                name: "ix_conversations_seeker_id",
                table: "conversations",
                column: "seeker_id");

            migrationBuilder.CreateIndex(
                name: "ix_favorites_listing_id",
                table: "favorites",
                column: "listing_id");

            migrationBuilder.CreateIndex(
                name: "ix_listing_photos_listing_id",
                table: "listing_photos",
                column: "listing_id");

            migrationBuilder.CreateIndex(
                name: "ix_listing_reports_listing_id",
                table: "listing_reports",
                column: "listing_id");

            migrationBuilder.CreateIndex(
                name: "ix_listing_reports_status",
                table: "listing_reports",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "ix_listings_attributes",
                table: "listings",
                column: "attributes")
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "jsonb_path_ops" });

            migrationBuilder.CreateIndex(
                name: "ix_listings_location",
                table: "listings",
                column: "location")
                .Annotation("Npgsql:IndexMethod", "gist");

            migrationBuilder.CreateIndex(
                name: "ix_listings_owner_id",
                table: "listings",
                column: "owner_id");

            migrationBuilder.CreateIndex(
                name: "ix_listings_status_category_deal_type_municipality",
                table: "listings",
                columns: new[] { "status", "category", "deal_type", "municipality" });

            migrationBuilder.CreateIndex(
                name: "ix_listings_status_expires_at",
                table: "listings",
                columns: new[] { "status", "expires_at" });

            migrationBuilder.CreateIndex(
                name: "ix_listings_status_published_at",
                table: "listings",
                columns: new[] { "status", "published_at" });

            migrationBuilder.CreateIndex(
                name: "ix_messages_conversation_id_sent_at",
                table: "messages",
                columns: new[] { "conversation_id", "sent_at" });

            migrationBuilder.CreateIndex(
                name: "ix_saved_searches_user_id",
                table: "saved_searches",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_users_email",
                table: "users",
                column: "email",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "businesses");

            migrationBuilder.DropTable(
                name: "favorites");

            migrationBuilder.DropTable(
                name: "listing_photos");

            migrationBuilder.DropTable(
                name: "listing_reports");

            migrationBuilder.DropTable(
                name: "messages");

            migrationBuilder.DropTable(
                name: "saved_searches");

            migrationBuilder.DropTable(
                name: "conversations");

            migrationBuilder.DropTable(
                name: "listings");

            migrationBuilder.DropTable(
                name: "users");

            migrationBuilder.Sql("DROP FUNCTION IF EXISTS attr_num(jsonb, text); DROP FUNCTION IF EXISTS attr_text(jsonb, text);");
        }
    }
}
