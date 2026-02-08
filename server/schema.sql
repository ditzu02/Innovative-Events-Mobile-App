-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-----------------------------------
-- LOCATIONS TABLE
-----------------------------------
CREATE TABLE IF NOT EXISTS locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    address TEXT,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    features JSONB,
    cover_image_url TEXT,
    rating_avg NUMERIC DEFAULT 0,
    rating_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-----------------------------------
-- CATEGORIES TABLE (L1)
-----------------------------------
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    icon TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-----------------------------------
-- SUBCATEGORIES TABLE (L2)
-----------------------------------
CREATE TABLE IF NOT EXISTS subcategories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-----------------------------------
-- EVENTS TABLE
-----------------------------------
CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id UUID REFERENCES locations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    category TEXT,
    category_id UUID REFERENCES categories(id),
    subcategory_id UUID REFERENCES subcategories(id),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    description TEXT,
    cover_image_url TEXT,
    ticket_url TEXT,
    price NUMERIC,
    rating_avg NUMERIC DEFAULT 0,
    rating_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-----------------------------------
-- USERS TABLE
-----------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-----------------------------------
-- REFRESH TOKENS TABLE
-----------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ
);

-----------------------------------
-- ARTISTS TABLE
-----------------------------------
CREATE TABLE IF NOT EXISTS artists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    bio TEXT,
    image_url TEXT,
    social_links JSONB
);

-----------------------------------
-- EVENT ↔️ ARTIST MANY-TO-MANY
-----------------------------------
CREATE TABLE IF NOT EXISTS event_artists (
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    artist_id UUID REFERENCES artists(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, artist_id)
);

-----------------------------------
-- TAGS TABLE (L3)
-----------------------------------
CREATE TABLE IF NOT EXISTS tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subcategory_id UUID REFERENCES subcategories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-----------------------------------
-- EVENT ↔️ TAG MANY-TO-MANY
-----------------------------------
CREATE TABLE IF NOT EXISTS event_tags (
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, tag_id)
);

-----------------------------------
-- REVIEWS TABLE
-----------------------------------
CREATE TABLE IF NOT EXISTS reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    rating INTEGER CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    photos TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-----------------------------------
-- SAVED EVENTS (FAVORITES)
-----------------------------------
CREATE TABLE IF NOT EXISTS saved_events (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, event_id)
);

-----------------------------------
-- EVENT PHOTOS
-----------------------------------
CREATE TABLE IF NOT EXISTS event_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    photo_url TEXT NOT NULL
);

-----------------------------------
-- TAXONOMY MIGRATION AUDIT
-----------------------------------
CREATE TABLE IF NOT EXISTS taxonomy_migration_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID,
    legacy_tag TEXT,
    mapped_tag_id UUID,
    chosen_category_slug TEXT,
    chosen_subcategory_slug TEXT,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-----------------------------------
-- TAXONOMY CONSISTENCY FUNCTIONS / TRIGGERS
-----------------------------------
CREATE OR REPLACE FUNCTION validate_event_branch_consistency()
RETURNS trigger AS $$
DECLARE
    subcategory_category_id UUID;
BEGIN
    IF NEW.subcategory_id IS NULL OR NEW.category_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT sc.category_id
    INTO subcategory_category_id
    FROM subcategories sc
    WHERE sc.id = NEW.subcategory_id;

    IF subcategory_category_id IS NULL THEN
        RAISE EXCEPTION 'Invalid subcategory_id % for event %', NEW.subcategory_id, NEW.id
            USING ERRCODE = '23514';
    END IF;

    IF subcategory_category_id <> NEW.category_id THEN
        RAISE EXCEPTION 'Event category_id (%) does not match subcategory category_id (%)',
            NEW.category_id, subcategory_category_id
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_event_branch_consistency ON events;
CREATE TRIGGER trg_validate_event_branch_consistency
BEFORE INSERT OR UPDATE ON events
FOR EACH ROW
EXECUTE FUNCTION validate_event_branch_consistency();

CREATE OR REPLACE FUNCTION validate_event_tag_branch_consistency()
RETURNS trigger AS $$
DECLARE
    event_subcategory_id UUID;
    tag_subcategory_id UUID;
BEGIN
    SELECT e.subcategory_id INTO event_subcategory_id
    FROM events e
    WHERE e.id = NEW.event_id;

    SELECT t.subcategory_id INTO tag_subcategory_id
    FROM tags t
    WHERE t.id = NEW.tag_id;

    IF event_subcategory_id IS NULL OR tag_subcategory_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF event_subcategory_id <> tag_subcategory_id THEN
        RAISE EXCEPTION 'tag_id % belongs to subcategory %, but event_id % belongs to subcategory %',
            NEW.tag_id, tag_subcategory_id, NEW.event_id, event_subcategory_id
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_event_tag_branch_consistency ON event_tags;
CREATE TRIGGER trg_validate_event_tag_branch_consistency
BEFORE INSERT OR UPDATE ON event_tags
FOR EACH ROW
EXECUTE FUNCTION validate_event_tag_branch_consistency();

-----------------------------------
-- INDEXES
-----------------------------------
CREATE INDEX IF NOT EXISTS idx_tags_subcategory ON tags(subcategory_id);
CREATE INDEX IF NOT EXISTS idx_subcategories_category ON subcategories(category_id);
CREATE INDEX IF NOT EXISTS idx_event_tags_event ON event_tags(event_id);
CREATE INDEX IF NOT EXISTS idx_event_tags_tag_event ON event_tags(tag_id, event_id);
CREATE INDEX IF NOT EXISTS idx_events_category_subcategory ON events(category_id, subcategory_id);
