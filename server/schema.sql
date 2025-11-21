-- Enable UUID generation
create extension if not exists "pgcrypto";

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
-- EVENTS TABLE
-----------------------------------
CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id UUID REFERENCES locations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    category TEXT,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    description TEXT,
    cover_image_url TEXT,
    price NUMERIC,
    rating_avg NUMERIC DEFAULT 0,
    rating_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
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
-- TAGS TABLE
-----------------------------------
CREATE TABLE IF NOT EXISTS tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL
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
    user_id UUID NOT NULL,
    rating INTEGER CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    photos TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-----------------------------------
-- SAVED EVENTS (FAVORITES)
-----------------------------------
CREATE TABLE IF NOT EXISTS saved_events (
    user_id UUID NOT NULL,
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
