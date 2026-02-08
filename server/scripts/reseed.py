#!/usr/bin/env python3
"""
Reset + reseed demo data focused on Romania (Timișoara + București).

- Loads DB config from server/.env (DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME;
  optionally DATABASE_URL and DB_SSLMODE).
- --reset flag TRUNCATEs all app tables safely (TRUNCATE ... CASCADE) inside a transaction.
- Idempotent:
  - taxonomy upserts by unique slug (categories/subcategories/tags)
  - locations get-or-create by (name, address)
  - events get-or-create by (title, start_time)
  - event_tags / event_artists are PK-protected and use ON CONFLICT DO NOTHING
  - photos get-or-create by (event_id, photo_url)
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import psycopg2
import psycopg2.extras
from psycopg2.extensions import connection as PgConn
from zoneinfo import ZoneInfo


APP_TZ = ZoneInfo("Europe/Bucharest")

# "Today" is fixed to match your requirement.
# If you prefer "now", replace this with datetime.now(APP_TZ).
SEED_TODAY = datetime(2026, 2, 8, 10, 0, tzinfo=APP_TZ)

RNG = random.Random(20260208)  # deterministic across runs


# -----------------------------
# Env / Connection
# -----------------------------

def load_dotenv(dotenv_path: Path) -> Dict[str, str]:
    """
    Minimal .env parser. Supports:
      KEY=value
      KEY="value"
      KEY='value'
    Ignores empty lines and comments.
    """
    env: Dict[str, str] = {}
    if not dotenv_path.exists():
        return env

    for raw_line in dotenv_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip()
        if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
            v = v[1:-1]
        env[k] = v
    return env


def build_conn_info(env: Dict[str, str]) -> Dict[str, str]:
    """
    Returns a dict with either {"dsn": "..."} or {"kwargs": {...}} for psycopg2.connect.
    """
    # Prefer explicit DATABASE_URL if present
    database_url = env.get("DATABASE_URL") or os.environ.get("DATABASE_URL")
    if database_url:
        sslmode = env.get("DB_SSLMODE") or os.environ.get("DB_SSLMODE")
        if sslmode and "sslmode=" not in database_url:
            # append sslmode if not present
            sep = "&" if "?" in database_url else "?"
            database_url = f"{database_url}{sep}sslmode={sslmode}"
        return {"dsn": database_url}

    # Fallback to discrete config keys
    def pick(key: str, default: Optional[str] = None) -> Optional[str]:
        return env.get(key) or os.environ.get(key) or default

    user = pick("DB_USER")
    password = pick("DB_PASSWORD")
    host = pick("DB_HOST", "localhost")
    port = pick("DB_PORT", "5432")
    dbname = pick("DB_NAME")
    sslmode = pick("DB_SSLMODE")

    missing = [k for k in ("DB_USER", "DB_PASSWORD", "DB_NAME") if not pick(k)]
    if missing:
        raise RuntimeError(f"Missing required DB env vars: {', '.join(missing)} (in server/.env or OS env)")

    kwargs: Dict[str, Any] = {
        "user": user,
        "password": password,
        "host": host,
        "port": int(port) if port else 5432,
        "dbname": dbname,
    }
    if sslmode:
        kwargs["sslmode"] = sslmode

    return {"kwargs": kwargs}


def connect() -> PgConn:
    repo_root = Path(__file__).resolve().parents[2]  # server/scripts/ -> repo root
    dotenv_path = repo_root / "server" / ".env"
    file_env = load_dotenv(dotenv_path)

    conn_info = build_conn_info(file_env)

    if "dsn" in conn_info:
        print("[db] Connecting via DATABASE_URL")
        conn = psycopg2.connect(conn_info["dsn"])
    else:
        print("[db] Connecting via discrete DB_* env vars")
        conn = psycopg2.connect(**conn_info["kwargs"])

    conn.autocommit = False
    return conn


# -----------------------------
# DB Helpers
# -----------------------------

def log(msg: str) -> None:
    print(msg, flush=True)


def fetch_one(cur, sql: str, params: Tuple[Any, ...]) -> Optional[Tuple[Any, ...]]:
    cur.execute(sql, params)
    return cur.fetchone()


def fetch_all(cur, sql: str, params: Tuple[Any, ...] = ()) -> List[Tuple[Any, ...]]:
    cur.execute(sql, params)
    return cur.fetchall()


def exec_sql(cur, sql: str, params: Tuple[Any, ...] = ()) -> None:
    cur.execute(sql, params)


def upsert_category(cur, *, name: str, slug: str, icon: str) -> str:
    cur.execute(
        """
        INSERT INTO categories (name, slug, icon)
        VALUES (%s, %s, %s)
        ON CONFLICT (slug)
        DO UPDATE SET name = EXCLUDED.name, icon = EXCLUDED.icon
        RETURNING id
        """,
        (name, slug, icon),
    )
    return cur.fetchone()[0]


def upsert_subcategory(cur, *, name: str, slug: str, category_id: str) -> str:
    cur.execute(
        """
        INSERT INTO subcategories (category_id, name, slug)
        VALUES (%s, %s, %s)
        ON CONFLICT (slug)
        DO UPDATE SET name = EXCLUDED.name, category_id = EXCLUDED.category_id
        RETURNING id
        """,
        (category_id, name, slug),
    )
    return cur.fetchone()[0]


def upsert_tag(cur, *, name: str, slug: str, subcategory_id: str) -> str:
    cur.execute(
        """
        INSERT INTO tags (subcategory_id, name, slug)
        VALUES (%s, %s, %s)
        ON CONFLICT (slug)
        DO UPDATE SET name = EXCLUDED.name, subcategory_id = EXCLUDED.subcategory_id
        RETURNING id
        """,
        (subcategory_id, name, slug),
    )
    return cur.fetchone()[0]


def get_or_create_location(
    cur,
    *,
    name: str,
    address: str,
    latitude: float,
    longitude: float,
    features: Dict[str, Any],
    cover_image_url: str,
    rating_avg: Optional[float] = None,
    rating_count: int = 0,
) -> str:
    row = fetch_one(
        cur,
        """
        SELECT id
        FROM locations
        WHERE name = %s AND COALESCE(address, '') = %s
        """,
        (name, address),
    )
    if row:
        # keep it stable, but also "refresh" details (nice for edits)
        exec_sql(
            cur,
            """
            UPDATE locations
            SET latitude = %s,
                longitude = %s,
                features = %s::jsonb,
                cover_image_url = %s,
                rating_avg = %s,
                rating_count = %s
            WHERE id = %s
            """,
            (
                latitude,
                longitude,
                json.dumps(features),
                cover_image_url,
                rating_avg,
                rating_count,
                row[0],
            ),
        )
        return row[0]

    cur.execute(
        """
        INSERT INTO locations (
            name, address, latitude, longitude, features, cover_image_url, rating_avg, rating_count
        )
        VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s, %s)
        RETURNING id
        """,
        (name, address, latitude, longitude, json.dumps(features), cover_image_url, rating_avg, rating_count),
    )
    return cur.fetchone()[0]


def get_or_create_event(
    cur,
    *,
    location_id: str,
    title: str,
    category: str,
    category_id: str,
    subcategory_id: str,
    start_time: datetime,
    end_time: datetime,
    description: str,
    cover_image_url: str,
    ticket_url: str,
    price: float,
    rating_avg: Optional[float] = None,
    rating_count: int = 0,
) -> str:
    """
    Natural key: (title, start_time) - stable and re-runnable.
    """
    row = fetch_one(
        cur,
        """
        SELECT id
        FROM events
        WHERE title = %s AND start_time = %s
        """,
        (title, start_time),
    )
    if row:
        # keep it updated (and also ensures trigger constraints remain valid)
        exec_sql(
            cur,
            """
            UPDATE events
            SET location_id = %s,
                category = %s,
                category_id = %s,
                subcategory_id = %s,
                end_time = %s,
                description = %s,
                cover_image_url = %s,
                ticket_url = %s,
                price = %s,
                rating_avg = %s,
                rating_count = %s
            WHERE id = %s
            """,
            (
                location_id,
                category,
                category_id,
                subcategory_id,
                end_time,
                description,
                cover_image_url,
                ticket_url,
                price,
                rating_avg,
                rating_count,
                row[0],
            ),
        )
        return row[0]

    cur.execute(
        """
        INSERT INTO events (
            location_id, title, category, category_id, subcategory_id,
            start_time, end_time, description, cover_image_url, ticket_url, price, rating_avg, rating_count
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (
            location_id,
            title,
            category,
            category_id,
            subcategory_id,
            start_time,
            end_time,
            description,
            cover_image_url,
            ticket_url,
            price,
            rating_avg,
            rating_count,
        ),
    )
    return cur.fetchone()[0]


def get_or_create_artist(cur, *, name: str, bio: str, image_url: str, social_links: Dict[str, Any]) -> str:
    # no unique constraint, so do a manual get-or-create by name
    row = fetch_one(cur, "SELECT id FROM artists WHERE name = %s", (name,))
    if row:
        exec_sql(
            cur,
            """
            UPDATE artists
            SET bio = %s,
                image_url = %s,
                social_links = %s::jsonb
            WHERE id = %s
            """,
            (bio, image_url, json.dumps(social_links), row[0]),
        )
        return row[0]

    cur.execute(
        """
        INSERT INTO artists (name, bio, image_url, social_links)
        VALUES (%s, %s, %s, %s::jsonb)
        RETURNING id
        """,
        (name, bio, image_url, json.dumps(social_links)),
    )
    return cur.fetchone()[0]


def link_event_tag(cur, *, event_id: str, tag_id: str) -> None:
    cur.execute(
        """
        INSERT INTO event_tags (event_id, tag_id)
        VALUES (%s, %s)
        ON CONFLICT DO NOTHING
        """,
        (event_id, tag_id),
    )


def link_event_artist(cur, *, event_id: str, artist_id: str) -> None:
    cur.execute(
        """
        INSERT INTO event_artists (event_id, artist_id)
        VALUES (%s, %s)
        ON CONFLICT DO NOTHING
        """,
        (event_id, artist_id),
    )


def add_event_photo(cur, *, event_id: str, photo_url: str) -> None:
    row = fetch_one(
        cur,
        "SELECT id FROM event_photos WHERE event_id = %s AND photo_url = %s",
        (event_id, photo_url),
    )
    if row:
        return
    cur.execute(
        """
        INSERT INTO event_photos (event_id, photo_url)
        VALUES (%s, %s)
        """,
        (event_id, photo_url),
    )


# -----------------------------
# Reset
# -----------------------------

def reset_all(cur) -> None:
    # Keep order irrelevant by using TRUNCATE ... CASCADE
    # (UUID PKs so RESTART IDENTITY isn't required, but it doesn't hurt for sequences)
    tables = [
        "event_artists",
        "event_tags",
        "reviews",
        "saved_events",
        "event_photos",
        "refresh_tokens",
        "taxonomy_migration_audit",
        "events",
        "tags",
        "subcategories",
        "categories",
        "artists",
        "users",
        "locations",
    ]
    log("[reset] Truncating all app tables (CASCADE)...")
    exec_sql(cur, f"TRUNCATE {', '.join(tables)} RESTART IDENTITY CASCADE;")
    log("[reset] Done.")


def reset_content_keep_taxonomy(cur) -> None:
    """
    Delete all app data but keep taxonomy tables:
    - keeps: categories, subcategories, tags
    - deletes: locations, events, joins, photos, reviews, artists, users, tokens, audit
    """
    tables = [
        "event_artists",
        "event_tags",
        "reviews",
        "saved_events",
        "event_photos",
        "refresh_tokens",
        "taxonomy_migration_audit",
        "events",
        "artists",
        "users",
        "locations",
    ]
    log("[reset] Truncating non-taxonomy tables (CASCADE)...")
    exec_sql(cur, f"TRUNCATE {', '.join(tables)} RESTART IDENTITY CASCADE;")
    log("[reset] Done.")


# -----------------------------
# Seed Data (Taxonomy / Locations / Events)
# -----------------------------

@dataclass(frozen=True)
class CategorySeed:
    slug: str
    name: str
    icon: str


@dataclass(frozen=True)
class SubcategorySeed:
    slug: str
    name: str
    category_slug: str


@dataclass(frozen=True)
class TagSeed:
    slug: str
    name: str
    subcategory_slug: str


def taxonomy_spec() -> Tuple[List[CategorySeed], List[SubcategorySeed], List[TagSeed]]:
    """
    Matches your existing hierarchy reset script (same slugs & naming).
    """
    categories = [
        CategorySeed(slug="music", name="Music", icon="music"),
        CategorySeed(slug="nightlife", name="Nightlife", icon="moon"),
        CategorySeed(slug="arts-culture", name="Arts & Culture", icon="palette"),
        CategorySeed(slug="food-drink", name="Food & Drink", icon="utensils"),
        CategorySeed(slug="entertainment", name="Entertainment", icon="ticket"),
        CategorySeed(slug="outdoor", name="Outdoor", icon="tree"),
        CategorySeed(slug="markets", name="Markets", icon="shopping-bag"),
    ]

    subcategories = [
        # music
        SubcategorySeed(slug="electronic", name="Electronic", category_slug="music"),
        SubcategorySeed(slug="rock-indie", name="Rock & Indie", category_slug="music"),
        SubcategorySeed(slug="jazz-blues", name="Jazz & Blues", category_slug="music"),
        SubcategorySeed(slug="classical", name="Classical", category_slug="music"),
        # nightlife
        SubcategorySeed(slug="club-nights", name="Club Nights", category_slug="nightlife"),
        SubcategorySeed(slug="rooftop-parties", name="Rooftop Parties", category_slug="nightlife"),
        SubcategorySeed(slug="boat-parties", name="Boat Parties", category_slug="nightlife"),
        SubcategorySeed(slug="bar-crawls", name="Bar Crawls", category_slug="nightlife"),
        # arts & culture
        SubcategorySeed(slug="museums", name="Museums", category_slug="arts-culture"),
        SubcategorySeed(slug="exhibitions", name="Exhibitions", category_slug="arts-culture"),
        SubcategorySeed(slug="theater", name="Theater", category_slug="arts-culture"),
        SubcategorySeed(slug="cultural-festivals", name="Cultural Festivals", category_slug="arts-culture"),
        # food & drink
        SubcategorySeed(slug="wine-events", name="Wine Events", category_slug="food-drink"),
        SubcategorySeed(slug="beer-events", name="Beer Events", category_slug="food-drink"),
        SubcategorySeed(slug="street-food", name="Street Food", category_slug="food-drink"),
        SubcategorySeed(slug="dining-experiences", name="Dining Experiences", category_slug="food-drink"),
        # entertainment
        SubcategorySeed(slug="comedy", name="Comedy", category_slug="entertainment"),
        SubcategorySeed(slug="cinema", name="Cinema", category_slug="entertainment"),
        SubcategorySeed(slug="game-nights", name="Game Nights", category_slug="entertainment"),
        # outdoor
        SubcategorySeed(slug="hiking", name="Hiking", category_slug="outdoor"),
        SubcategorySeed(slug="outdoor-cinema", name="Outdoor Cinema", category_slug="outdoor"),
        SubcategorySeed(slug="outdoor-festivals", name="Festivals", category_slug="outdoor"),
        # markets
        SubcategorySeed(slug="farmers-markets", name="Farmers Markets", category_slug="markets"),
        SubcategorySeed(slug="flea-markets", name="Flea Markets", category_slug="markets"),
        SubcategorySeed(slug="christmas-markets", name="Christmas Markets", category_slug="markets"),
        SubcategorySeed(slug="food-markets", name="Food Markets", category_slug="markets"),
    ]

    # Tags: your current file only defines tags for a subset of subcategories.
    # That's okay; events will only pick tags from the selected subcategory.
    tags = [
        # electronic
        TagSeed(slug="techno", name="Techno", subcategory_slug="electronic"),
        TagSeed(slug="house", name="House", subcategory_slug="electronic"),
        TagSeed(slug="drum-bass", name="Drum & Bass", subcategory_slug="electronic"),
        TagSeed(slug="trance", name="Trance", subcategory_slug="electronic"),

        # club-nights
        TagSeed(slug="dj-sets", name="DJ Sets", subcategory_slug="club-nights"),
        TagSeed(slug="underground-clubs", name="Underground Clubs", subcategory_slug="club-nights"),
        TagSeed(slug="afterparties", name="Afterparties", subcategory_slug="club-nights"),

        # wine-events
        TagSeed(slug="wine-tasting", name="Wine Tasting", subcategory_slug="wine-events"),
        TagSeed(slug="vineyard-tours", name="Vineyard Tours", subcategory_slug="wine-events"),

        # cultural-festivals
        TagSeed(slug="folk-festivals", name="Folk Festivals", subcategory_slug="cultural-festivals"),
        TagSeed(slug="heritage-celebrations", name="Heritage Celebrations", subcategory_slug="cultural-festivals"),

        # comedy
        TagSeed(slug="standup-comedy", name="Stand-up Comedy", subcategory_slug="comedy"),
        TagSeed(slug="improv-shows", name="Improv Shows", subcategory_slug="comedy"),

        # farmers-markets
        TagSeed(slug="local-produce", name="Local Produce", subcategory_slug="farmers-markets"),
        TagSeed(slug="organic-products", name="Organic Products", subcategory_slug="farmers-markets"),
        TagSeed(slug="seasonal-fruits", name="Seasonal Fruits", subcategory_slug="farmers-markets"),
        TagSeed(slug="farm-to-table", name="Farm-to-Table", subcategory_slug="farmers-markets"),

        # flea-markets
        TagSeed(slug="second-hand", name="Second-hand", subcategory_slug="flea-markets"),
        TagSeed(slug="antiques", name="Antiques", subcategory_slug="flea-markets"),
        TagSeed(slug="vintage-clothes", name="Vintage Clothes", subcategory_slug="flea-markets"),
        TagSeed(slug="collectibles", name="Collectibles", subcategory_slug="flea-markets"),

        # food-markets
        TagSeed(slug="international-cuisine", name="International Cuisine", subcategory_slug="food-markets"),
        TagSeed(slug="local-cuisine", name="Local Cuisine", subcategory_slug="food-markets"),
        TagSeed(slug="tasting-events", name="Tasting Events", subcategory_slug="food-markets"),
        TagSeed(slug="vegan", name="Vegan", subcategory_slug="food-markets"),
        TagSeed(slug="farmers-market", name="Farmers Market", subcategory_slug="food-markets"),
    ]

    return categories, subcategories, tags


def seed_taxonomy(cur) -> Tuple[Dict[str, str], Dict[str, str], Dict[str, str]]:
    """
    Returns (category_ids_by_slug, subcategory_ids_by_slug, tag_ids_by_slug)
    """
    log("[seed] Taxonomy...")
    categories, subcategories, tags = taxonomy_spec()

    cat_ids: Dict[str, str] = {}
    for c in categories:
        cat_ids[c.slug] = upsert_category(cur, name=c.name, slug=c.slug, icon=c.icon)

    subcat_ids: Dict[str, str] = {}
    for sc in subcategories:
        subcat_ids[sc.slug] = upsert_subcategory(
            cur,
            name=sc.name,
            slug=sc.slug,
            category_id=cat_ids[sc.category_slug],
        )

    tag_ids: Dict[str, str] = {}
    for t in tags:
        tag_ids[t.slug] = upsert_tag(
            cur,
            name=t.name,
            slug=t.slug,
            subcategory_id=subcat_ids[t.subcategory_slug],
        )

    log(f"[seed] Taxonomy done: {len(cat_ids)} categories, {len(subcat_ids)} subcategories, {len(tag_ids)} tags.")
    return cat_ids, subcat_ids, tag_ids


def pick_location_rating(*, seed: int, venue_type: str) -> Tuple[float, int]:
    r = random.Random(seed)

    base_by_type = {
        "cafe": 4.6,
        "cultural": 4.5,
        "outdoor": 4.4,
        "venue": 4.3,
        "sport": 4.2,
        "market": 4.3,
        "club": 4.4,
        "concert_hall": 4.6,
        "gallery": 4.5,
        "park": 4.4,
    }
    count_range_by_type: Dict[str, Tuple[int, int]] = {
        "cafe": (120, 1400),
        "cultural": (80, 900),
        "outdoor": (160, 2600),
        "park": (200, 3200),
        "venue": (100, 1700),
        "concert_hall": (120, 2200),
        "club": (140, 2400),
        "sport": (40, 700),
        "market": (250, 4200),
        "gallery": (60, 800),
    }

    base = base_by_type.get(venue_type, 4.3)
    min_count, max_count = count_range_by_type.get(venue_type, (80, 1400))

    rating_avg = base + (r.random() - 0.5) * 0.6
    rating_avg = round(min(4.9, max(3.7, rating_avg)), 1)
    rating_count = int(r.randint(min_count, max_count))
    return rating_avg, rating_count


def pick_event_rating(
    *,
    seed: int,
    start_time: datetime,
    subcategory_slug: str,
) -> Tuple[Optional[float], int]:
    r = random.Random(seed)
    days_until = (start_time.date() - SEED_TODAY.date()).days

    # Future events are less likely to have ratings.
    if days_until >= 45:
        no_rating_chance = 0.65
    elif days_until >= 21:
        no_rating_chance = 0.45
    else:
        no_rating_chance = 0.25

    if r.random() < no_rating_chance:
        return None, 0

    base_by_subcat = {
        "electronic": 4.5,
        "club-nights": 4.4,
        "wine-events": 4.6,
        "cultural-festivals": 4.3,
        "comedy": 4.4,
        "farmers-markets": 4.3,
        "flea-markets": 4.2,
        "food-markets": 4.3,
    }
    count_range_by_subcat: Dict[str, Tuple[int, int]] = {
        "electronic": (12, 140),
        "club-nights": (10, 120),
        "wine-events": (8, 90),
        "cultural-festivals": (10, 160),
        "comedy": (10, 140),
        "farmers-markets": (18, 220),
        "flea-markets": (12, 170),
        "food-markets": (16, 200),
    }

    base = base_by_subcat.get(subcategory_slug, 4.3)
    min_count, max_count = count_range_by_subcat.get(subcategory_slug, (10, 140))

    # Farther dates skew towards fewer ratings.
    volume_factor = max(0.35, 1.0 - (days_until / 140.0))
    rating_count = max(1, int(r.randint(min_count, max_count) * volume_factor))

    rating_avg = base + (r.random() - 0.5) * 0.8
    rating_avg = round(min(4.9, max(3.6, rating_avg)), 1)
    return rating_avg, rating_count


def seed_locations(cur) -> List[Tuple[str, str, str, str]]:
    """
    Returns list of (location_id, city_key, location_name, venue_type)
    city_key is 'tm' or 'buc'.
    """
    log("[seed] Locations (Timișoara + București)...")

    # placeholder image host
    IMG = "https://picsum.photos/seed/{seed}/1200/800"

    tm = [
        ("RAFT Coffee Roasters", "Str. Eugeniu de Savoya 8, Timișoara", 45.7579, 21.2295,
         {"type": "cafe", "amenities": ["wifi", "outdoor seating"], "accessibility": ["wheelchair access"]}),
        ("Faber Cultural Space", "Str. Păstorilor 1, Timișoara", 45.7478, 21.2355,
         {"type": "cultural", "amenities": ["indoor", "parking", "restrooms"], "accessibility": ["wheelchair access"]}),
        ("Iulius Town Garden", "Piața Consiliul Europei 2, Timișoara", 45.7710, 21.2268,
         {"type": "outdoor", "amenities": ["outdoor", "family friendly", "pet friendly", "parking", "restrooms"]}),
        ("Bastion Pop-Up Stage", "Bastionul Maria Theresia, Timișoara", 45.7570, 21.2318,
         {"type": "venue", "amenities": ["outdoor", "bar", "restrooms", "live music"]}),
        ("Dâmbovița Run Track", "Bd. Dâmbovița (zona parc), Timișoara", 45.7445, 21.2095,
         {"type": "sport", "amenities": ["outdoor", "family friendly"], "extras": ["running track"]}),
        ("Piața 700 Market Corner", "Piața 700, Timișoara", 45.7562, 21.2291,
         {"type": "market", "amenities": ["outdoor", "family friendly"], "extras": ["local produce"]}),
    ]

    buc = [
        ("Control Club", "Str. Constantin Mille 4, București", 44.4358, 26.0987,
         {"type": "club", "amenities": ["indoor", "bar", "smoking area"], "extras": ["late night"]}),
        ("Kretzulescu Hall", "Calea Victoriei 45, București", 44.4372, 26.0969,
         {"type": "concert_hall", "amenities": ["indoor", "seated", "restrooms"], "accessibility": ["wheelchair access"]}),
        ("Gradina Verona", "Str. Pictor Arthur Verona 13-15, București", 44.4440, 26.0978,
         {"type": "outdoor", "amenities": ["outdoor", "bar", "garden"], "extras": ["afterwork"]}),
        ("Lokal Gallery Night", "Str. Popa Petre 12, București", 44.4506, 26.1008,
         {"type": "gallery", "amenities": ["indoor"], "extras": ["gallery"]}),
        ("Herăstrău Lakeside Start", "Parcul Regele Mihai I, București", 44.4760, 26.0786,
         {"type": "park", "amenities": ["outdoor", "family friendly", "pet friendly"], "extras": ["park"]}),
        ("Hala Obor Tasting Corner", "Șos. Colentina 2, București", 44.4473, 26.1300,
         {"type": "market", "amenities": ["indoor", "food", "restrooms"], "extras": ["market"]}),
    ]

    all_locations = [("tm",) + x for x in tm] + [("buc",) + x for x in buc]

    out: List[Tuple[str, str, str, str]] = []
    for idx, (city_key, name, addr, lat, lon, features) in enumerate(all_locations, start=1):
        venue_type = str(features.get("type") or "")
        rating_avg, rating_count = pick_location_rating(
            seed=20260208 + idx * 73 + (1 if city_key == "tm" else 2),
            venue_type=venue_type,
        )
        loc_id = get_or_create_location(
            cur,
            name=name,
            address=addr,
            latitude=float(lat),
            longitude=float(lon),
            features=features,
            cover_image_url=IMG.format(seed=f"ro-loc-{idx}"),
            rating_avg=rating_avg,
            rating_count=rating_count,
        )
        out.append((loc_id, city_key, name, venue_type))

    log(f"[seed] Locations done: {len(out)}.")
    return out


def choose_subcategory_for_events(subcat_ids: Dict[str, str]) -> List[str]:
    """
    Use a subset that has tags defined (so event_tags can always attach 2+ tags).
    """
    # Only subcategories with tags in taxonomy_spec:
    return [
        "electronic",
        "club-nights",
        "wine-events",
        "cultural-festivals",
        "comedy",
        "farmers-markets",
        "flea-markets",
        "food-markets",
    ]


def event_title_pool(city_key: str) -> Dict[str, List[str]]:
    """
    Fictional-but-plausible local listings for demos. No claims these are real official events.
    """
    if city_key == "tm":
        return {
            "electronic": [
                "Bega Beats: Techno Session",
                "Night Pulse: Techno Sessions",
                "Warehouse Vibes: House Edition",
                "Afterhours Drift",
                "Drum & Bass Sprint",
                "Trance & Lights Showcase",
            ],
            "club-nights": [
                "Friday Club Night",
                "Resident DJs: Late Set",
                "Late Set Marathon",
                "Underground Room Sessions",
                "Afterparty Social",
                "All Night Groove",
            ],
            "wine-events": [
                "Banat Wine Flight",
                "Wine Tasting: Romanian Regions",
                "Blind Tasting Night",
                "Pairing Lab: Cheese & Reds",
                "Sparkling Hour",
                "Sommelier Corner: Dry Whites",
            ],
            "cultural-festivals": [
                "Banat Culture Weekend",
                "Folk Evening: Stories & Songs",
                "Heritage Walk + Mini Fair",
                "Cultural Night Market",
                "Crafts & Music Courtyard",
                "Local Makers Mini-Fest",
            ],
            "comedy": [
                "Open Mic Comedy",
                "Stand-up: New Jokes Night",
                "Improv: Audience Prompts",
                "Comedy Club Showcase",
                "Late Laughs Session",
                "Roast Night (Lighthearted)",
            ],
            "farmers-markets": [
                "Piața 700 Weekend Market",
                "Farmers Market: Local Produce",
                "Seasonal Fruits Weekend",
                "Farm-to-Table Pop-up",
                "Local Pantry & Honey",
                "Fresh Greens Saturday",
            ],
            "flea-markets": [
                "Flea Market: Vintage Finds",
                "Antiques & Collectibles Sunday",
                "Second-hand Swap",
                "Vinyl & Retro Corner",
                "Vintage Clothes Pop-up",
                "Thrift Morning Market",
            ],
            "food-markets": [
                "Food Market: Local Cuisine",
                "Tasting Bites: International",
                "Street Food Weekend",
                "Vegan Street Corner",
                "Small Plates Night",
                "Dessert Lane Pop-up",
            ],
        }

    return {
        "electronic": [
            "Dâmbovița Bassline: Techno Session",
            "Night Pulse: Techno Sessions",
            "Victoriei Warehouse: House Edition",
            "Afterhours Drift",
            "Drum & Bass Sprint",
            "Trance & Lights Showcase",
        ],
        "club-nights": [
            "Old Town Club Night",
            "Resident DJs: Late Set",
            "Late Set Marathon",
            "Underground Beats",
            "Afterparty Social",
            "All Night Groove",
        ],
        "wine-events": [
            "Old Town Wine Flight",
            "Wine Tasting: Romanian Regions",
            "Blind Tasting Night",
            "Pairing Lab: Cheese & Reds",
            "Sparkling Hour",
            "Sommelier Corner: Reds",
        ],
        "cultural-festivals": [
            "Culture Weekend: Street Performances",
            "Folk Evening: Stories & Songs",
            "Heritage Walk + Mini Fair",
            "Cultural Night Market",
            "Artisans Courtyard",
            "Local Makers Mini-Fest",
        ],
        "comedy": [
            "Open Mic Comedy",
            "Stand-up: New Jokes Night",
            "Improv: Audience Prompts",
            "Comedy Club Showcase",
            "Late Laughs Session",
            "Crowd Work Night",
        ],
        "farmers-markets": [
            "Obor Weekend Market",
            "Farmers Market: Local Produce",
            "Seasonal Fruits Weekend",
            "Farm-to-Table Pop-up",
            "Local Cheese & Bread",
            "Fresh Greens Saturday",
        ],
        "flea-markets": [
            "Flea Market: Vintage Finds",
            "Antiques & Collectibles Sunday",
            "Second-hand Swap",
            "Vinyl & Retro Corner",
            "Vintage Clothes Pop-up",
            "Thrift Morning Market",
        ],
        "food-markets": [
            "Food Market: Local Cuisine",
            "Tasting Bites: International",
            "Street Food Weekend",
            "Vegan Street Corner",
            "Small Plates Night",
            "Dessert Lane Pop-up",
        ],
    }


def build_event_description(subcat_slug: str, city_key: str, location_name: str) -> str:
    city = "Timișoara" if city_key == "tm" else "București"
    base = (
        f"Fictional demo listing for {city}. Hosted at {location_name}. "
        "Times, line-ups, and ticket links are placeholders for app demos."
    )
    extras = {
        "electronic": " Expect a club-style set, warm-up + peak-time, and a late closing.",
        "club-nights": " Doors open early, DJs rotate through short sets. Dress casual.",
        "wine-events": " Guided tasting with small pours; pace yourself. Non-alcoholic options available.",
        "cultural-festivals": " Mini fair atmosphere: crafts, short performances, and local bites.",
        "comedy": " Mixed lineup format; audience participation may happen in the last section.",
        "farmers-markets": " Local vendors, seasonal produce, and small-batch pantry goods.",
        "flea-markets": " Bring cash for small items; negotiation-friendly vibe.",
        "food-markets": " Multiple stalls with tasting portions; arrive early for shorter queues.",
    }
    return base + extras.get(subcat_slug, "")


def pick_time_window(subcat_slug: str) -> Tuple[int, int]:
    """
    Returns (start_hour, duration_hours).
    """
    if subcat_slug in ("electronic", "club-nights"):
        return (22, 6)  # 22:00 -> 04:00/05:00
    if subcat_slug in ("comedy", "wine-events"):
        return (19, 2)
    if subcat_slug in ("cultural-festivals", "food-markets", "flea-markets", "farmers-markets"):
        return (11, 5)
    return (18, 2)


def seed_events_and_links(
    cur,
    *,
    locations: List[Tuple[str, str, str, str]],
    cat_ids: Dict[str, str],
    subcat_ids: Dict[str, str],
    tag_ids: Dict[str, str],
) -> List[str]:
    log("[seed] Events (next ~90 days)...")

    category_name_by_id: Dict[str, str] = {
        str(cat_id): name
        for cat_id, name in fetch_all(cur, "SELECT id, name FROM categories", ())
    }

    # Map subcategory -> category_id (via DB join for safety)
    rows = fetch_all(
        cur,
        """
        SELECT sc.slug, c.slug, sc.id, c.id
        FROM subcategories sc
        JOIN categories c ON c.id = sc.category_id
        """,
        (),
    )
    subcat_to_cat: Dict[str, str] = {r[0]: r[3] for r in rows}

    # tags grouped by subcategory_id (so we can satisfy your trigger constraint)
    tag_rows = fetch_all(
        cur,
        """
        SELECT t.id, t.slug, t.subcategory_id, sc.slug
        FROM tags t
        JOIN subcategories sc ON sc.id = t.subcategory_id
        """,
        (),
    )
    tags_by_subcat_slug: Dict[str, List[str]] = {}
    for tag_id, tag_slug, _subcat_id, subcat_slug in tag_rows:
        tags_by_subcat_slug.setdefault(subcat_slug, []).append(tag_id)

    eligible_subcats = choose_subcategory_for_events(subcat_ids)

    # 40–60 events target
    target_n = RNG.randint(40, 60)

    locations_by_city: Dict[str, List[Tuple[str, str, str]]] = {"tm": [], "buc": []}
    for loc_id, loc_city_key, loc_name, venue_type in locations:
        locations_by_city.setdefault(loc_city_key, []).append((loc_id, loc_name, venue_type))

    created_event_ids: List[str] = []
    days_horizon = 90

    for i in range(target_n):
        # Spread across days + cities
        day_offset = int((i / max(1, target_n - 1)) * (days_horizon - 1))
        event_date = (SEED_TODAY + timedelta(days=day_offset)).date()

        # Alternate cities for a consistent distribution
        city_key = "tm" if (i % 2 == 0) else "buc"

        # Pick subcategory (weighted by "fun variety")
        subcat_slug = eligible_subcats[(i * 7) % len(eligible_subcats)]

        # Ensure tags exist for that subcategory (else fallback)
        if subcat_slug not in tags_by_subcat_slug or len(tags_by_subcat_slug[subcat_slug]) < 2:
            subcat_slug = "electronic"  # has 4 tags

        allowed_types_by_subcat: Dict[str, Tuple[str, ...]] = {
            "electronic": ("club", "venue", "outdoor"),
            "club-nights": ("club", "venue"),
            "wine-events": ("cafe", "market", "outdoor"),
            "cultural-festivals": ("cultural", "outdoor", "venue", "park", "market"),
            "comedy": ("venue", "cultural", "club"),
            "farmers-markets": ("market", "outdoor", "park"),
            "flea-markets": ("market", "outdoor", "park"),
            "food-markets": ("market", "outdoor", "park"),
        }
        candidates = locations_by_city.get(city_key, [])
        allowed_types = allowed_types_by_subcat.get(subcat_slug)
        if allowed_types:
            filtered = [item for item in candidates if item[2] in allowed_types]
            if filtered:
                candidates = filtered
        if not candidates:
            # fallback to any city if misconfigured
            candidates = [item for items in locations_by_city.values() for item in items]

        loc_id, location_name, _venue_type = candidates[(i * 5) % len(candidates)]

        category_id = subcat_to_cat[subcat_slug]
        category_name = category_name_by_id.get(str(category_id), "Other")
        subcategory_id = subcat_ids[subcat_slug]

        # Title pool per city/subcat; add suffix to avoid same title duplicates on same date
        title_options = event_title_pool(city_key).get(subcat_slug, [f"Demo Event {i+1}"])
        base_title = title_options[i % len(title_options)]
        title = f"{base_title} · {event_date.strftime('%d %b')}"

        start_hour, dur_hours = pick_time_window(subcat_slug)
        # small jitter
        minute = (i * 13) % 60
        start_dt = datetime.combine(event_date, time(start_hour, minute), tzinfo=APP_TZ)
        end_dt = start_dt + timedelta(hours=dur_hours)

        rating_avg, rating_count = pick_event_rating(
            seed=20260208 + (i + 1) * 1009 + day_offset * 37 + (1 if city_key == "tm" else 2),
            start_time=start_dt,
            subcategory_slug=subcat_slug,
        )

        # price
        if subcat_slug in ("farmers-markets", "flea-markets", "food-markets", "cultural-festivals"):
            price = RNG.choice([0, 0, 0, 15, 25])  # mostly free
        elif subcat_slug in ("comedy", "wine-events"):
            price = RNG.choice([35, 45, 60, 75, 90])
        else:
            price = RNG.choice([30, 50, 70, 90, 120])

        cover = f"https://picsum.photos/seed/ro-ev-{i+1}/1400/900"
        ticket_url = f"https://example.com/tickets/ro-demo-{i+1}"

        description = build_event_description(subcat_slug, city_key, location_name)

        ev_id = get_or_create_event(
            cur,
            location_id=loc_id,
            title=title,
            category=category_name,
            category_id=category_id,
            subcategory_id=subcategory_id,
            start_time=start_dt,
            end_time=end_dt,
            description=description,
            cover_image_url=cover,
            ticket_url=ticket_url,
            price=float(price),
            rating_avg=rating_avg,
            rating_count=rating_count,
        )
        created_event_ids.append(ev_id)

        # Attach 2–6 tags, but ONLY tags from same subcategory (trigger requirement)
        available_tags = tags_by_subcat_slug[subcat_slug]
        k = min(len(available_tags), RNG.randint(2, 6))
        chosen = RNG.sample(available_tags, k=k)
        for tag_id in chosen:
            link_event_tag(cur, event_id=ev_id, tag_id=tag_id)

    log(f"[seed] Events done: {len(created_event_ids)}.")
    return created_event_ids


def seed_artists_and_links(cur, event_ids: List[str]) -> List[str]:
    log("[seed] Artists + event_artists (optional)...")

    IMG = "https://picsum.photos/seed/{seed}/800/800"

    artist_defs = [
        ("Neon Meridian", "Electronic producer for fictional demo line-ups."),
        ("Dana Varga", "Stand-up comedian (fictional)."),
        ("Blue Tram Quartet", "Jazz-infused live act (fictional)."),
        ("Luca Sava", "House/techno DJ (fictional)."),
        ("Mara & The Echoes", "Indie-leaning project (fictional)."),
        ("Sarma Sessions", "Comedy + improv duo (fictional)."),
        ("Cernăuți Strings", "Classical crossover ensemble (fictional)."),
        ("Vine Notes", "Wine educator (fictional)."),
        ("Market Makers", "Food market curator collective (fictional)."),
        ("Nightline Residents", "Rotating club residents (fictional)."),
        ("Folk Lantern", "Folk project for festivals (fictional)."),
        ("Paper Kite", "Chill electronic set (fictional)."),
        ("Grindhouse Host", "Cinema night host (fictional)."),
        ("Vintage Selector", "Flea-market DJ set (fictional)."),
        ("Run Crew TM/B", "Outdoor run crew (fictional)."),
    ]

    artist_ids: List[str] = []
    for idx, (name, bio) in enumerate(artist_defs, start=1):
        a_id = get_or_create_artist(
            cur,
            name=name,
            bio=bio,
            image_url=IMG.format(seed=f"ro-artist-{idx}"),
            social_links={"instagram": f"https://example.com/{name.replace(' ', '').lower()}"},
        )
        artist_ids.append(a_id)

    # Link 0–3 artists per event (deterministic)
    for i, ev_id in enumerate(event_ids):
        k = (i * 5) % 4  # 0..3
        if k == 0:
            continue
        chosen = RNG.sample(artist_ids, k=k)
        for a_id in chosen:
            link_event_artist(cur, event_id=ev_id, artist_id=a_id)

    log(f"[seed] Artists done: {len(artist_ids)}.")
    return artist_ids


def seed_event_photos(cur, event_ids: List[str]) -> None:
    log("[seed] Event photos (optional)...")

    # add photos to first ~12 events
    for i, ev_id in enumerate(event_ids[:12], start=1):
        add_event_photo(cur, event_id=ev_id, photo_url=f"https://picsum.photos/seed/ro-evphoto-{i}/1200/800")
    log("[seed] Event photos done.")


# -----------------------------
# Main
# -----------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="Reset + reseed Romanian demo data (TM + București).")
    reset_group = parser.add_mutually_exclusive_group()
    reset_group.add_argument("--reset", action="store_true", help="TRUNCATE all app tables before seeding.")
    reset_group.add_argument(
        "--reset-content",
        action="store_true",
        help="TRUNCATE all non-taxonomy tables (keeps categories/subcategories/tags).",
    )
    parser.add_argument("--no-optional", action="store_true", help="Skip optional artists/photos.")
    args = parser.parse_args()

    try:
        conn = connect()
    except Exception as e:
        print(f"[fatal] DB connection failed: {e}", file=sys.stderr)
        return 1

    try:
        with conn:
            with conn.cursor() as cur:
                if args.reset:
                    reset_all(cur)
                elif args.reset_content:
                    reset_content_keep_taxonomy(cur)

                cat_ids, subcat_ids, tag_ids = seed_taxonomy(cur)
                locations = seed_locations(cur)
                event_ids = seed_events_and_links(
                    cur,
                    locations=locations,
                    cat_ids=cat_ids,
                    subcat_ids=subcat_ids,
                    tag_ids=tag_ids,
                )

                if not args.no_optional:
                    seed_artists_and_links(cur, event_ids)
                    seed_event_photos(cur, event_ids)

        log("[done] Commit successful.")
        return 0

    except Exception as e:
        conn.rollback()
        print(f"[fatal] Reseed failed, rolled back: {e}", file=sys.stderr)
        return 2

    finally:
        try:
            conn.close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
