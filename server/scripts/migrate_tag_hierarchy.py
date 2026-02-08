import argparse
import logging
import os
from pathlib import Path
import re
from typing import Any

import psycopg2
from dotenv import load_dotenv


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("migrate_tag_hierarchy")


CATEGORY_PRIORITY = [
    "music",
    "nightlife",
    "food-drink",
    "arts-culture",
    "entertainment",
    "outdoor",
    "other",
]


TAXONOMY_SPEC = {
    "music": {
        "name": "Music",
        "subcategories": {
            "electronic": {"name": "Electronic", "tags": ["techno", "house", "drum-bass", "trance", "electronic"]},
            "rock-indie": {"name": "Rock & Indie", "tags": ["live", "rock", "indie"]},
            "jazz-blues": {"name": "Jazz & Blues", "tags": ["jazz", "blues"]},
            "classical": {"name": "Classical", "tags": ["orchestra", "chamber-music"]},
        },
    },
    "nightlife": {
        "name": "Nightlife",
        "subcategories": {
            "clubs": {"name": "Clubs", "tags": ["vip", "dance-night"]},
            "bars-lounges": {"name": "Bars & Lounges", "tags": ["cocktail", "afterwork"]},
        },
    },
    "food-drink": {
        "name": "Food & Drink",
        "subcategories": {
            "wine": {"name": "Wine", "tags": ["wine-tasting", "vineyard-tour"]},
            "beer": {"name": "Beer", "tags": ["craft-beer", "beer-pairing"]},
            "street-food": {"name": "Street Food", "tags": ["food-truck", "tasting-menu"]},
        },
    },
    "arts-culture": {
        "name": "Arts & Culture",
        "subcategories": {
            "theater": {"name": "Theater", "tags": ["improvisation", "drama"]},
            "visual-arts": {"name": "Visual Arts", "tags": ["art", "gallery-night"]},
            "museums-heritage": {"name": "Museums & Heritage", "tags": ["museum-tour", "heritage-walk"]},
        },
    },
    "entertainment": {
        "name": "Entertainment",
        "subcategories": {
            "comedy-shows": {"name": "Comedy Shows", "tags": ["stand-up", "family"]},
            "film-media": {"name": "Film & Media", "tags": ["cinema", "tech"]},
            "gaming": {"name": "Gaming", "tags": ["esports", "board-games", "indoor"]},
        },
    },
    "outdoor": {
        "name": "Outdoor",
        "subcategories": {
            "adventure-outdoors": {"name": "Adventure & Outdoors", "tags": ["hiking", "outdoor"]},
            "festivals-markets": {"name": "Festivals & Markets", "tags": ["farmers-market", "open-air"]},
        },
    },
    "other": {
        "name": "Other",
        "subcategories": {
            "other": {"name": "Other", "tags": ["unmapped"]},
        },
    },
}


DEFAULT_SUBCATEGORY_BY_CATEGORY = {
    "music": "electronic",
    "nightlife": "clubs",
    "food-drink": "wine",
    "arts-culture": "theater",
    "entertainment": "comedy-shows",
    "outdoor": "adventure-outdoors",
    "other": "other",
}


LEGACY_CATEGORY_ALIASES = {
    "music": "music",
    "party": "nightlife",
    "nightlife": "nightlife",
    "food": "food-drink",
    "food-drink": "food-drink",
    "arts-culture": "arts-culture",
    "art": "arts-culture",
    "entertainment": "entertainment",
    "outdoor": "outdoor",
}


LEGACY_TAG_HINTS = {
    "electronic": ("music", "electronic", "electronic"),
    "live": ("music", "rock-indie", "live"),
    "outdoor": ("outdoor", "adventure-outdoors", "outdoor"),
    "indoor": ("entertainment", "gaming", "indoor"),
    "vip": ("nightlife", "clubs", "vip"),
    "family": ("entertainment", "comedy-shows", "family"),
    "art": ("arts-culture", "visual-arts", "art"),
    "tech": ("entertainment", "film-media", "tech"),
}


def slugify(value: str) -> str:
    lowered = value.strip().lower()
    lowered = re.sub(r"[^a-z0-9]+", "-", lowered)
    return lowered.strip("-")


def load_env() -> None:
    server_dir = Path(__file__).resolve().parents[1]
    dotenv_path = server_dir / ".env"
    load_dotenv(dotenv_path)


def get_connection():
    connect_timeout = int(os.getenv("DB_CONNECT_TIMEOUT", "8"))
    database_url = os.getenv("DATABASE_URL")
    sslmode = os.getenv("DB_SSLMODE", "require")

    if database_url:
        connect_kwargs: dict[str, Any] = {
            "dsn": database_url,
            "connect_timeout": connect_timeout,
        }
        if "sslmode=" not in database_url and sslmode:
            connect_kwargs["sslmode"] = sslmode
        try:
            return psycopg2.connect(**connect_kwargs)
        except psycopg2.OperationalError as exc:
            raise RuntimeError(
                "Database connection failed using DATABASE_URL. "
                "Verify the URL, SSL mode, and network access."
            ) from exc

    required = {
        "DB_USER": os.getenv("DB_USER"),
        "DB_PASSWORD": os.getenv("DB_PASSWORD"),
        "DB_HOST": os.getenv("DB_HOST"),
        "DB_PORT": os.getenv("DB_PORT"),
        "DB_NAME": os.getenv("DB_NAME"),
    }
    missing = [key for key, val in required.items() if not val]
    if missing:
        raise RuntimeError(
            "Missing DB env vars: "
            f"{', '.join(missing)}. Set DATABASE_URL or DB_USER/DB_PASSWORD/DB_HOST/DB_PORT/DB_NAME."
        )
    try:
        return psycopg2.connect(
            user=required["DB_USER"],
            password=required["DB_PASSWORD"],
            host=required["DB_HOST"],
            port=required["DB_PORT"],
            dbname=required["DB_NAME"],
            sslmode=sslmode,
            connect_timeout=connect_timeout,
        )
    except psycopg2.OperationalError as exc:
        host = required["DB_HOST"]
        port = required["DB_PORT"]
        raise RuntimeError(
            f"Database connection failed for {host}:{port}. "
            "Check DB_HOST/DB_PORT, credentials, SSL mode, and network access."
        ) from exc


def ensure_schema(cur) -> None:
    cur.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto";')
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS categories (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            icon TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS subcategories (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )
    cur.execute("ALTER TABLE events ADD COLUMN IF NOT EXISTS category_id UUID")
    cur.execute("ALTER TABLE events ADD COLUMN IF NOT EXISTS subcategory_id UUID")
    cur.execute("ALTER TABLE tags ADD COLUMN IF NOT EXISTS subcategory_id UUID")
    cur.execute("ALTER TABLE tags ADD COLUMN IF NOT EXISTS slug TEXT")
    cur.execute("ALTER TABLE tags ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()")

    cur.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'tags_name_key'
            ) THEN
                ALTER TABLE tags DROP CONSTRAINT tags_name_key;
            END IF;
        END
        $$;
        """
    )

    cur.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'events_category_id_fkey'
            ) THEN
                ALTER TABLE events
                ADD CONSTRAINT events_category_id_fkey
                FOREIGN KEY (category_id) REFERENCES categories(id);
            END IF;
        END
        $$;
        """
    )
    cur.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'events_subcategory_id_fkey'
            ) THEN
                ALTER TABLE events
                ADD CONSTRAINT events_subcategory_id_fkey
                FOREIGN KEY (subcategory_id) REFERENCES subcategories(id);
            END IF;
        END
        $$;
        """
    )
    cur.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'tags_subcategory_id_fkey'
            ) THEN
                ALTER TABLE tags
                ADD CONSTRAINT tags_subcategory_id_fkey
                FOREIGN KEY (subcategory_id) REFERENCES subcategories(id) ON DELETE CASCADE;
            END IF;
        END
        $$;
        """
    )

    cur.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'tags_slug_key'
                  AND conrelid = 'tags'::regclass
            ) THEN
                ALTER TABLE tags
                ADD CONSTRAINT tags_slug_key UNIQUE (slug);
            END IF;
        END
        $$;
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_tags_subcategory ON tags(subcategory_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_subcategories_category ON subcategories(category_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_event_tags_event ON event_tags(event_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_event_tags_tag_event ON event_tags(tag_id, event_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_events_category_subcategory ON events(category_id, subcategory_id)")

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS taxonomy_migration_audit (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            event_id UUID,
            legacy_tag TEXT,
            mapped_tag_id UUID,
            chosen_category_slug TEXT,
            chosen_subcategory_slug TEXT,
            reason TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )


def upsert_category(cur, name: str, slug: str) -> str:
    cur.execute(
        """
        INSERT INTO categories (name, slug)
        VALUES (%s, %s)
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
        """,
        (name, slug),
    )
    return str(cur.fetchone()[0])


def upsert_subcategory(cur, category_id: str, name: str, slug: str) -> str:
    cur.execute(
        """
        INSERT INTO subcategories (category_id, name, slug)
        VALUES (%s, %s, %s)
        ON CONFLICT (slug) DO UPDATE
            SET name = EXCLUDED.name,
                category_id = EXCLUDED.category_id
        RETURNING id
        """,
        (category_id, name, slug),
    )
    return str(cur.fetchone()[0])


def upsert_tag(cur, subcategory_id: str, name: str, slug: str) -> str:
    cur.execute(
        """
        INSERT INTO tags (subcategory_id, name, slug, created_at)
        VALUES (%s, %s, %s, NOW())
        ON CONFLICT ON CONSTRAINT tags_slug_key DO UPDATE
            SET
                name = EXCLUDED.name,
                subcategory_id = EXCLUDED.subcategory_id
        RETURNING id
        """,
        (subcategory_id, name, slug),
    )
    return str(cur.fetchone()[0])


def seed_taxonomy(cur) -> dict[str, Any]:
    category_ids: dict[str, str] = {}
    category_name_by_slug: dict[str, str] = {}
    subcategory_ids: dict[tuple[str, str], str] = {}
    tag_ids: dict[tuple[str, str, str], str] = {}
    tag_slug_index: dict[str, list[tuple[str, str, str]]] = {}
    legacy_unmapped_by_branch: dict[tuple[str, str], str] = {}

    for category_slug, category_payload in TAXONOMY_SPEC.items():
        category_name = category_payload["name"]
        category_id = upsert_category(cur, category_name, category_slug)
        category_ids[category_slug] = category_id
        category_name_by_slug[category_slug] = category_name

        for subcategory_slug, subcategory_payload in category_payload["subcategories"].items():
            subcategory_name = subcategory_payload["name"]
            subcategory_id = upsert_subcategory(cur, category_id, subcategory_name, subcategory_slug)
            subcategory_ids[(category_slug, subcategory_slug)] = subcategory_id

            for tag_slug in subcategory_payload["tags"]:
                tag_name = tag_slug.replace("-", " ").title()
                tag_id = upsert_tag(cur, subcategory_id, tag_name, tag_slug)
                tag_ids[(category_slug, subcategory_slug, tag_slug)] = tag_id
                tag_slug_index.setdefault(tag_slug, []).append((category_slug, subcategory_slug, tag_id))

            fallback_slug = f"legacy-unmapped-{subcategory_slug}"
            fallback_id = upsert_tag(cur, subcategory_id, "Legacy Unmapped", fallback_slug)
            tag_ids[(category_slug, subcategory_slug, fallback_slug)] = fallback_id
            tag_slug_index.setdefault(fallback_slug, []).append((category_slug, subcategory_slug, fallback_id))
            legacy_unmapped_by_branch[(category_slug, subcategory_slug)] = fallback_id

    global_fallback_tag_id = tag_ids[("other", "other", "unmapped")]

    return {
        "category_ids": category_ids,
        "category_name_by_slug": category_name_by_slug,
        "subcategory_ids": subcategory_ids,
        "tag_ids": tag_ids,
        "tag_slug_index": tag_slug_index,
        "legacy_unmapped_by_branch": legacy_unmapped_by_branch,
        "global_fallback_tag_id": global_fallback_tag_id,
    }


def normalize_legacy_tag_keys(tag_names: list[str], tag_slugs: list[str]) -> set[str]:
    keys: set[str] = set()
    for item in tag_slugs or []:
        if item:
            keys.add(str(item).strip().lower())
    for item in tag_names or []:
        if item:
            keys.add(slugify(str(item)))
    return {key for key in keys if key}


def category_priority_index(category_slug: str) -> int:
    if category_slug in CATEGORY_PRIORITY:
        return CATEGORY_PRIORITY.index(category_slug)
    return len(CATEGORY_PRIORITY)


def choose_branch(
    mapped_targets: list[tuple[str, str, str]],
    event_category_text: str | None,
) -> tuple[str, str]:
    if mapped_targets:
        counts: dict[tuple[str, str], int] = {}
        for category_slug, subcategory_slug, _tag_id in mapped_targets:
            counts[(category_slug, subcategory_slug)] = counts.get((category_slug, subcategory_slug), 0) + 1

        max_count = max(counts.values())
        candidates = [branch for branch, count in counts.items() if count == max_count]
        candidates.sort(key=lambda item: (category_priority_index(item[0]), item[1]))
        return candidates[0]

    category_slug = LEGACY_CATEGORY_ALIASES.get(slugify(event_category_text or ""), "other")
    subcategory_slug = DEFAULT_SUBCATEGORY_BY_CATEGORY.get(category_slug, "other")
    return category_slug, subcategory_slug


def resolve_legacy_tag_target(
    legacy_key: str,
    taxonomy: dict[str, Any],
) -> tuple[str, str, str] | None:
    if legacy_key in LEGACY_TAG_HINTS:
        cat_slug, sub_slug, tag_slug = LEGACY_TAG_HINTS[legacy_key]
        tag_id = taxonomy["tag_ids"].get((cat_slug, sub_slug, tag_slug))
        if tag_id:
            return cat_slug, sub_slug, tag_id

    candidates = taxonomy["tag_slug_index"].get(legacy_key, [])
    if len(candidates) == 1:
        return candidates[0]
    return None


def process_batches(cur, taxonomy: dict[str, Any], batch_size: int) -> dict[str, int]:
    stats = {
        "events_total": 0,
        "events_updated": 0,
        "tag_replacements": 0,
        "unmapped_tags": 0,
        "mixed_branch_tags": 0,
        "events_with_no_tags": 0,
    }

    offset = 0
    while True:
        cur.execute(
            """
            SELECT
                e.id::text,
                e.category,
                COALESCE(array_remove(array_agg(DISTINCT t.name), NULL), '{}') AS tag_names,
                COALESCE(array_remove(array_agg(DISTINCT t.slug), NULL), '{}') AS tag_slugs
            FROM events e
            LEFT JOIN event_tags et ON et.event_id = e.id
            LEFT JOIN tags t ON t.id = et.tag_id
            GROUP BY e.id
            ORDER BY e.id
            LIMIT %s OFFSET %s
            """,
            (batch_size, offset),
        )
        rows = cur.fetchall()
        if not rows:
            break

        for event_id, category_text, tag_names, tag_slugs in rows:
            stats["events_total"] += 1
            legacy_keys = normalize_legacy_tag_keys(tag_names or [], tag_slugs or [])

            mapped_targets: list[tuple[str, str, str]] = []
            for key in legacy_keys:
                target = resolve_legacy_tag_target(key, taxonomy)
                if target:
                    mapped_targets.append(target)

            chosen_category_slug, chosen_subcategory_slug = choose_branch(mapped_targets, category_text)
            chosen_category_id = taxonomy["category_ids"][chosen_category_slug]
            chosen_subcategory_id = taxonomy["subcategory_ids"][(chosen_category_slug, chosen_subcategory_slug)]
            chosen_fallback_tag_id = taxonomy["legacy_unmapped_by_branch"][
                (chosen_category_slug, chosen_subcategory_slug)
            ]

            next_tag_ids: set[str] = set()
            if not legacy_keys:
                next_tag_ids.add(chosen_fallback_tag_id)
                stats["events_with_no_tags"] += 1
                cur.execute(
                    """
                    INSERT INTO taxonomy_migration_audit (
                        event_id, legacy_tag, mapped_tag_id, chosen_category_slug, chosen_subcategory_slug, reason
                    ) VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (
                        event_id,
                        None,
                        chosen_fallback_tag_id,
                        chosen_category_slug,
                        chosen_subcategory_slug,
                        "no-tags",
                    ),
                )
            else:
                for key in sorted(legacy_keys):
                    target = resolve_legacy_tag_target(key, taxonomy)
                    if target:
                        target_category_slug, target_subcategory_slug, target_tag_id = target
                        if (
                            target_category_slug == chosen_category_slug
                            and target_subcategory_slug == chosen_subcategory_slug
                        ):
                            next_tag_ids.add(target_tag_id)
                            continue
                        stats["mixed_branch_tags"] += 1
                        reason = "mixed-branch"
                    else:
                        stats["unmapped_tags"] += 1
                        reason = "unmapped"

                    next_tag_ids.add(chosen_fallback_tag_id)
                    cur.execute(
                        """
                        INSERT INTO taxonomy_migration_audit (
                            event_id, legacy_tag, mapped_tag_id, chosen_category_slug, chosen_subcategory_slug, reason
                        ) VALUES (%s, %s, %s, %s, %s, %s)
                        """,
                        (
                            event_id,
                            key,
                            chosen_fallback_tag_id,
                            chosen_category_slug,
                            chosen_subcategory_slug,
                            reason,
                        ),
                    )
                    stats["tag_replacements"] += 1

            if not next_tag_ids:
                next_tag_ids.add(taxonomy["global_fallback_tag_id"])

            cur.execute(
                """
                UPDATE events
                SET
                    category_id = %s,
                    subcategory_id = %s,
                    category = COALESCE(NULLIF(category, ''), %s)
                WHERE id = %s
                """,
                (
                    chosen_category_id,
                    chosen_subcategory_id,
                    taxonomy["category_name_by_slug"][chosen_category_slug],
                    event_id,
                ),
            )

            cur.execute("DELETE FROM event_tags WHERE event_id = %s", (event_id,))
            for tag_id in sorted(next_tag_ids):
                cur.execute(
                    """
                    INSERT INTO event_tags (event_id, tag_id)
                    VALUES (%s, %s)
                    ON CONFLICT (event_id, tag_id) DO NOTHING
                    """,
                    (event_id, tag_id),
                )

            stats["events_updated"] += 1

        offset += len(rows)
        logger.info("Processed %s events...", stats["events_total"])

    return stats


def validate_after_backfill(cur) -> tuple[int, int]:
    cur.execute(
        """
        SELECT COUNT(*)
        FROM events
        WHERE category_id IS NULL OR subcategory_id IS NULL
        """
    )
    null_events = int(cur.fetchone()[0])

    cur.execute(
        """
        SELECT COUNT(*)
        FROM event_tags et
        JOIN events e ON e.id = et.event_id
        JOIN tags t ON t.id = et.tag_id
        WHERE e.subcategory_id IS NOT NULL
          AND t.subcategory_id IS NOT NULL
          AND e.subcategory_id <> t.subcategory_id
        """
    )
    cross_branch = int(cur.fetchone()[0])
    return null_events, cross_branch


def enable_strict_enforcement(cur) -> None:
    cur.execute("ALTER TABLE events ALTER COLUMN category_id SET NOT NULL")
    cur.execute("ALTER TABLE events ALTER COLUMN subcategory_id SET NOT NULL")

    cur.execute(
        """
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
        """
    )
    cur.execute("DROP TRIGGER IF EXISTS trg_validate_event_branch_consistency ON events")
    cur.execute(
        """
        CREATE TRIGGER trg_validate_event_branch_consistency
        BEFORE INSERT OR UPDATE ON events
        FOR EACH ROW
        EXECUTE FUNCTION validate_event_branch_consistency()
        """
    )

    cur.execute(
        """
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
        """
    )
    cur.execute("DROP TRIGGER IF EXISTS trg_validate_event_tag_branch_consistency ON event_tags")
    cur.execute(
        """
        CREATE TRIGGER trg_validate_event_tag_branch_consistency
        BEFORE INSERT OR UPDATE ON event_tags
        FOR EACH ROW
        EXECUTE FUNCTION validate_event_tag_branch_consistency()
        """
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate legacy flat tags to hierarchical taxonomy.")
    parser.add_argument("--batch-size", type=int, default=200, help="Number of events to process per batch.")
    parser.add_argument("--dry-run", action="store_true", help="Run migration and roll back changes.")
    args = parser.parse_args()

    if args.batch_size <= 0:
        raise ValueError("--batch-size must be > 0")

    load_env()
    conn = get_connection()
    conn.autocommit = False
    cur = conn.cursor()
    try:
        logger.info("Ensuring additive schema is ready...")
        ensure_schema(cur)

        logger.info("Seeding taxonomy...")
        taxonomy = seed_taxonomy(cur)

        logger.info("Processing events in batches of %s...", args.batch_size)
        stats = process_batches(cur, taxonomy, args.batch_size)

        logger.info("Validating migrated data...")
        null_events, cross_branch = validate_after_backfill(cur)
        if null_events > 0:
            raise RuntimeError(
                f"Validation failed: {null_events} events still missing category_id/subcategory_id."
            )
        if cross_branch > 0:
            raise RuntimeError(
                f"Validation failed: {cross_branch} cross-branch event_tags rows still exist."
            )

        logger.info("Enabling strict constraints and triggers...")
        enable_strict_enforcement(cur)

        if args.dry_run:
            conn.rollback()
            logger.info("Dry run complete. Transaction rolled back.")
        else:
            conn.commit()
            logger.info("Migration committed successfully.")

        logger.info("Summary: %s", stats)
    except Exception:
        conn.rollback()
        logger.exception("Migration failed. Rolled back transaction.")
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
