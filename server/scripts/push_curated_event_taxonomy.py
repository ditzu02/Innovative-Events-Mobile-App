#!/usr/bin/env python3
"""
Apply curated taxonomy assignments for specific events in one DB transaction.

Default mode is dry-run (rolls back). Use --apply to commit.

Usage:
  server/venv/bin/python server/scripts/push_curated_event_taxonomy.py
  server/venv/bin/python server/scripts/push_curated_event_taxonomy.py --apply
  server/venv/bin/python server/scripts/push_curated_event_taxonomy.py --apply --event-id <uuid>
"""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import psycopg2
from dotenv import load_dotenv


@dataclass(frozen=True)
class EventClassification:
    event_id: str
    title_hint: str
    category_slug: str
    subcategory_slug: str
    tag_slugs: tuple[str, ...]
    end_time_iso: str | None = None


@dataclass(frozen=True)
class TagSeed:
    slug: str
    name: str
    subcategory_slug: str


@dataclass(frozen=True)
class SubcategorySeed:
    slug: str
    name: str
    category_slug: str


# Curated taxonomy additions for your current events.
# These are upserted only if missing (or updated if they already exist).
CURATED_SUBCATEGORY_UPSERTS: tuple[SubcategorySeed, ...] = (
    SubcategorySeed(slug="rap-rnb", name="Rap / R&B", category_slug="music"),
)

CURATED_TAG_UPSERTS: tuple[TagSeed, ...] = (
    TagSeed(slug="student-competition", name="Student Competition", subcategory_slug="exhibitions"),
    TagSeed(slug="ai", name="AI", subcategory_slug="exhibitions"),
    TagSeed(slug="innovation", name="Innovation", subcategory_slug="exhibitions"),
    TagSeed(slug="live-music", name="Live Music", subcategory_slug="rap-rnb"),
    TagSeed(slug="hip-hop", name="Hip Hop", subcategory_slug="rap-rnb"),
    TagSeed(slug="indie-rock", name="Indie Rock", subcategory_slug="rock-indie"),
    TagSeed(slug="alt-rock", name="Alt Rock", subcategory_slug="rock-indie"),
)


# Curated per-event mapping (edit here if you want to change choices).
CURATED_CLASSIFICATIONS: tuple[EventClassification, ...] = (
    EventClassification(
        event_id="b1ab4c70-a943-497c-9e5e-14606bf9f3c6",
        title_hint="SCMUPT",
        category_slug="arts-culture",
        subcategory_slug="exhibitions",
        tag_slugs=("student-competition", "ai", "innovation"),
    ),
    EventClassification(
        event_id="abc877dd-4528-49b3-b3dc-9a2b210e1b1b",
        title_hint="Valentine Wine Tasting",
        category_slug="food-drink",
        subcategory_slug="wine-events",
        tag_slugs=("wine-tasting",),
    ),
    EventClassification(
        event_id="d9bf728d-4b7c-4427-a224-f08b8f0c2697",
        title_hint="NOUL NORMAL",
        category_slug="music",
        subcategory_slug="rap-rnb",
        tag_slugs=("hip-hop", "live-music"),
    ),
    EventClassification(
        event_id="4560c856-83b7-4652-914c-5c350312d2c0",
        title_hint="Piata de vechituri",
        category_slug="markets",
        subcategory_slug="flea-markets",
        tag_slugs=("second-hand", "vintage-clothes"),
        # Fix invalid end<start that appeared in your output.
        end_time_iso="2026-02-14T11:00:00+00:00",
    ),
    EventClassification(
        event_id="569af1bf-5c71-4027-898d-e20f55c208f3",
        title_hint="Bosquito LIVE",
        category_slug="music",
        subcategory_slug="rock-indie",
        tag_slugs=("indie-rock", "alt-rock"),
    ),
)


def load_env() -> None:
    server_dir = Path(__file__).resolve().parents[1]
    load_dotenv(server_dir / ".env")


def get_connection():
    connect_timeout = int(os.getenv("DB_CONNECT_TIMEOUT", "8"))
    database_url = os.getenv("DATABASE_URL")
    sslmode = os.getenv("DB_SSLMODE", "require")

    if database_url:
        kwargs: dict[str, Any] = {"dsn": database_url, "connect_timeout": connect_timeout}
        if "sslmode=" not in database_url and sslmode:
            kwargs["sslmode"] = sslmode
        return psycopg2.connect(**kwargs)

    required = {
        "DB_USER": os.getenv("DB_USER"),
        "DB_PASSWORD": os.getenv("DB_PASSWORD"),
        "DB_HOST": os.getenv("DB_HOST"),
        "DB_PORT": os.getenv("DB_PORT"),
        "DB_NAME": os.getenv("DB_NAME"),
    }
    missing = [key for key, value in required.items() if not value]
    if missing:
        raise RuntimeError(
            "Missing DB env vars: "
            f"{', '.join(missing)}. Set DATABASE_URL or DB_USER/DB_PASSWORD/DB_HOST/DB_PORT/DB_NAME."
        )

    return psycopg2.connect(
        user=required["DB_USER"],
        password=required["DB_PASSWORD"],
        host=required["DB_HOST"],
        port=required["DB_PORT"],
        dbname=required["DB_NAME"],
        sslmode=sslmode,
        connect_timeout=connect_timeout,
    )


def upsert_tag(cur, *, name: str, slug: str, subcategory_id: str) -> str:
    cur.execute(
        """
        INSERT INTO tags (subcategory_id, name, slug)
        VALUES (%s, %s, %s)
        ON CONFLICT (slug) DO UPDATE
            SET name = EXCLUDED.name,
                subcategory_id = EXCLUDED.subcategory_id
        RETURNING id::text
        """,
        (subcategory_id, name, slug),
    )
    return str(cur.fetchone()[0])


def upsert_subcategory(cur, *, name: str, slug: str, category_id: str) -> str:
    cur.execute(
        """
        INSERT INTO subcategories (category_id, name, slug)
        VALUES (%s, %s, %s)
        ON CONFLICT (slug) DO UPDATE
            SET name = EXCLUDED.name,
                category_id = EXCLUDED.category_id
        RETURNING id::text
        """,
        (category_id, name, slug),
    )
    return str(cur.fetchone()[0])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Apply curated event taxonomy assignments in one transaction.")
    parser.add_argument("--apply", action="store_true", help="Commit changes. Default is dry-run rollback.")
    parser.add_argument(
        "--event-id",
        action="append",
        dest="event_ids",
        default=[],
        help="Only apply to specific event UUID (can be repeated).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    selected = list(CURATED_CLASSIFICATIONS)
    if args.event_ids:
        wanted = set(args.event_ids)
        selected = [item for item in selected if item.event_id in wanted]
        if not selected:
            raise RuntimeError("None of the provided --event-id values exist in CURATED_CLASSIFICATIONS.")

    load_env()
    conn = get_connection()
    conn.autocommit = False
    cur = conn.cursor()

    try:
        cur.execute("SELECT id::text, slug, name FROM categories")
        category_rows = cur.fetchall()
        category_id_by_slug = {str(row[1]): str(row[0]) for row in category_rows}
        category_name_by_slug = {str(row[1]): str(row[2]) for row in category_rows}

        # Ensure curated subcategories exist before loading subcategory maps.
        for seed in CURATED_SUBCATEGORY_UPSERTS:
            category_id = category_id_by_slug.get(seed.category_slug)
            if not category_id:
                raise RuntimeError(
                    f"Category '{seed.category_slug}' not found for curated subcategory '{seed.slug}'."
                )
            upsert_subcategory(
                cur,
                name=seed.name,
                slug=seed.slug,
                category_id=category_id,
            )

        cur.execute("SELECT id::text, slug, category_id::text FROM subcategories")
        subcategory_rows = cur.fetchall()
        subcategory_id_by_slug = {str(row[1]): str(row[0]) for row in subcategory_rows}
        category_id_by_subcategory_slug = {str(row[1]): str(row[2]) for row in subcategory_rows}

        # Ensure curated tags exist.
        cur.execute("SELECT id::text, slug FROM tags")
        tag_id_by_slug = {row[1]: str(row[0]) for row in cur.fetchall()}
        for seed in CURATED_TAG_UPSERTS:
            subcategory_id = subcategory_id_by_slug.get(seed.subcategory_slug)
            if not subcategory_id:
                raise RuntimeError(
                    f"Subcategory '{seed.subcategory_slug}' not found. Seed taxonomy first."
                )
            tag_id_by_slug[seed.slug] = upsert_tag(
                cur,
                name=seed.name,
                slug=seed.slug,
                subcategory_id=subcategory_id,
            )

        updated = 0
        for item in selected:
            category_id = category_id_by_slug.get(item.category_slug)
            subcategory_id = subcategory_id_by_slug.get(item.subcategory_slug)
            if not category_id:
                raise RuntimeError(f"Category slug '{item.category_slug}' not found.")
            if not subcategory_id:
                raise RuntimeError(f"Subcategory slug '{item.subcategory_slug}' not found.")
            if category_id_by_subcategory_slug.get(item.subcategory_slug) != category_id:
                raise RuntimeError(
                    f"Subcategory '{item.subcategory_slug}' is not in category '{item.category_slug}'."
                )

            cur.execute("SELECT title FROM events WHERE id = %s::uuid", (item.event_id,))
            row = cur.fetchone()
            if not row:
                raise RuntimeError(f"Event not found: {item.event_id}")
            title = str(row[0] or "")

            if item.title_hint and item.title_hint.lower() not in title.lower():
                print(
                    f"[warn] title hint '{item.title_hint}' not found in event title '{title}' "
                    f"for {item.event_id}"
                )

            event_end_time = None
            if item.end_time_iso:
                event_end_time = datetime.fromisoformat(item.end_time_iso)

            if event_end_time is None:
                cur.execute(
                    """
                    UPDATE events
                    SET category = %s, category_id = %s::uuid, subcategory_id = %s::uuid
                    WHERE id = %s::uuid
                    """,
                    (
                        category_name_by_slug[item.category_slug],
                        category_id,
                        subcategory_id,
                        item.event_id,
                    ),
                )
            else:
                cur.execute(
                    """
                    UPDATE events
                    SET category = %s,
                        category_id = %s::uuid,
                        subcategory_id = %s::uuid,
                        end_time = %s
                    WHERE id = %s::uuid
                    """,
                    (
                        category_name_by_slug[item.category_slug],
                        category_id,
                        subcategory_id,
                        event_end_time,
                        item.event_id,
                    ),
                )

            cur.execute("DELETE FROM event_tags WHERE event_id = %s::uuid", (item.event_id,))

            for tag_slug in item.tag_slugs:
                tag_id = tag_id_by_slug.get(tag_slug)
                if not tag_id:
                    raise RuntimeError(f"Tag slug '{tag_slug}' not found after upsert.")
                cur.execute(
                    """
                    INSERT INTO event_tags (event_id, tag_id)
                    VALUES (%s::uuid, %s::uuid)
                    ON CONFLICT (event_id, tag_id) DO NOTHING
                    """,
                    (item.event_id, tag_id),
                )

            print(
                f"[plan] {item.event_id[:8]} -> {item.category_slug}/{item.subcategory_slug} "
                f"tags={list(item.tag_slugs)}"
            )
            updated += 1

        if args.apply:
            conn.commit()
            print(f"[done] Committed curated taxonomy for {updated} events.")
        else:
            conn.rollback()
            print(f"[done] Dry-run complete for {updated} events. No changes committed.")

        return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
