


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."category_overrides" (
    "group_id" "uuid" NOT NULL,
    "title_normalized" "text" NOT NULL,
    "category" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."category_overrides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."entries" (
    "id" "uuid" NOT NULL,
    "group_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "title" "text",
    "note" "text",
    "category" "text",
    "category_source" "text",
    "payer_id" "uuid" NOT NULL,
    "recipient_id" "uuid",
    "amount_cents" bigint NOT NULL,
    "currency" "text" NOT NULL,
    "exchange_rate" numeric DEFAULT 1 NOT NULL,
    "split_mode" "text" DEFAULT 'equal'::"text" NOT NULL,
    "expense_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "photo_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "entries_amount_cents_check" CHECK (("amount_cents" > 0)),
    CONSTRAINT "entries_category_source_check" CHECK (("category_source" = ANY (ARRAY['keyword'::"text", 'llm'::"text", 'manual'::"text"]))),
    CONSTRAINT "entries_exchange_rate_check" CHECK (("exchange_rate" > (0)::numeric)),
    CONSTRAINT "entries_kind_check" CHECK (("kind" = ANY (ARRAY['expense'::"text", 'payment'::"text"]))),
    CONSTRAINT "entries_split_mode_check" CHECK (("split_mode" = ANY (ARRAY['equal'::"text", 'exact'::"text", 'percent'::"text", 'shares'::"text"])))
);


ALTER TABLE "public"."entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."entry_shares" (
    "entry_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "share_cents" bigint NOT NULL,
    "input_value" numeric
);


ALTER TABLE "public"."entry_shares" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."groups" (
    "id" "uuid" NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "base_currency" "text" DEFAULT 'EUR'::"text" NOT NULL,
    "accent_color" "text" DEFAULT 'emerald'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."members" (
    "id" "uuid" NOT NULL,
    "group_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."photos" (
    "id" "uuid" NOT NULL,
    "group_id" "uuid" NOT NULL,
    "content_type" "text" NOT NULL,
    "data" "bytea" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."photos" OWNER TO "postgres";


ALTER TABLE ONLY "public"."category_overrides"
    ADD CONSTRAINT "category_overrides_pkey" PRIMARY KEY ("group_id", "title_normalized");



ALTER TABLE ONLY "public"."entries"
    ADD CONSTRAINT "entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."entry_shares"
    ADD CONSTRAINT "entry_shares_pkey" PRIMARY KEY ("entry_id", "member_id");



ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_pkey" PRIMARY KEY ("id");



CREATE INDEX "entries_group_date_idx" ON "public"."entries" USING "btree" ("group_id", "expense_date" DESC, "created_at" DESC);



CREATE INDEX "members_group_idx" ON "public"."members" USING "btree" ("group_id");



CREATE INDEX "photos_group_idx" ON "public"."photos" USING "btree" ("group_id");



ALTER TABLE ONLY "public"."category_overrides"
    ADD CONSTRAINT "category_overrides_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."entries"
    ADD CONSTRAINT "entries_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."entries"
    ADD CONSTRAINT "entries_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "public"."members"("id");



ALTER TABLE ONLY "public"."entries"
    ADD CONSTRAINT "entries_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."entries"
    ADD CONSTRAINT "entries_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "public"."members"("id");



ALTER TABLE ONLY "public"."entry_shares"
    ADD CONSTRAINT "entry_shares_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."entry_shares"
    ADD CONSTRAINT "entry_shares_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id");



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;



ALTER TABLE "public"."category_overrides" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."entry_shares" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."photos" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."category_overrides" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."category_overrides" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."category_overrides" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."entries" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."entries" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."entries" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."entry_shares" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."entry_shares" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."entry_shares" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."groups" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."groups" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."groups" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."members" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."members" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."members" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."photos" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."photos" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."photos" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";







