#!/usr/bin/env python3
"""
Interactive taxonomy assignment for existing events.

What it does:
- Loads taxonomy (categories/subcategories/tags) from DB.
- Loads existing events (broken only by default).
- Lets you choose category, subcategory, and tags per event.
- Applies all accepted edits in one transaction after final confirmation.

Examples:
  server/venv/bin/python server/scripts/interactive_event_taxonomy.py
  server/venv/bin/python server/scripts/interactive_event_taxonomy.py --all --limit 100
  server/venv/bin/python server/scripts/interactive_event_taxonomy.py --event-id <uuid>
"""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import psycopg2
from dotenv import load_dotenv


@dataclass(frozen=True)
class Category:
    id: str
    name: str
    slug: str


@dataclass(frozen=True)
class Subcategory:
    id: str
    category_id: str
    name: str
    slug: str


@dataclass(frozen=True)
class Tag:
    id: str
    subcategory_id: str
    name: str
    slug: str


@dataclass
class EventRow:
    id: str
    title: str
    start_time: str | None
    end_time: str | None
    category_id: str | None
    category_name: str | None
    subcategory_id: str | None
    subcategory_name: str | None
    tag_ids: list[str]
    tag_names: list[str]
    has_cross_branch_tags: bool

    @property
    def broken_flags(self) -> list[str]:
        flags: list[str] = []
        if self.category_id is None:
            flags.append("missing_category_id")
        if self.subcategory_id is None:
            flags.append("missing_subcategory_id")
        if not self.tag_ids:
            flags.append("missing_tags")
        if self.has_cross_branch_tags:
            flags.append("cross_branch_tags")
        return flags

    @property
    def is_broken(self) -> bool:
        return bool(self.broken_flags)


def load_env() -> None:
    server_dir = Path(__file__).resolve().parents[1]
    load_dotenv(server_dir / ".env")


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
        return psycopg2.connect(**connect_kwargs)

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
            f"{', '.join(missing)}. Configure DATABASE_URL or DB_USER/DB_PASSWORD/DB_HOST/DB_PORT/DB_NAME."
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


def load_taxonomy(cur) -> tuple[list[Category], list[Subcategory], list[Tag]]:
    cur.execute(
        """
        SELECT id::text, name, slug
        FROM categories
        ORDER BY name ASC
        """
    )
    categories = [Category(id=row[0], name=row[1], slug=row[2]) for row in cur.fetchall()]

    cur.execute(
        """
        SELECT id::text, category_id::text, name, slug
        FROM subcategories
        ORDER BY name ASC
        """
    )
    subcategories = [Subcategory(id=row[0], category_id=row[1], name=row[2], slug=row[3]) for row in cur.fetchall()]

    cur.execute(
        """
        SELECT id::text, subcategory_id::text, name, COALESCE(slug, '')
        FROM tags
        ORDER BY name ASC
        """
    )
    tags = [Tag(id=row[0], subcategory_id=row[1], name=row[2], slug=row[3]) for row in cur.fetchall()]

    if not categories or not subcategories:
        raise RuntimeError("Taxonomy is empty. Seed categories/subcategories first.")
    return categories, subcategories, tags


def load_events(cur, *, all_events: bool, limit: int, offset: int, event_ids: list[str]) -> list[EventRow]:
    where_sql = ""
    params: list[Any] = []
    if event_ids:
        where_sql = "WHERE e.id = ANY(%s::uuid[])"
        params.append(event_ids)

    params.extend([limit, offset])
    cur.execute(
        f"""
        SELECT
            e.id::text,
            e.title,
            e.start_time::text,
            e.end_time::text,
            e.category_id::text,
            c.name,
            e.subcategory_id::text,
            sc.name,
            COALESCE(array_remove(array_agg(DISTINCT et.tag_id::text), NULL), '{{}}') AS tag_ids,
            COALESCE(array_remove(array_agg(DISTINCT t.name), NULL), '{{}}') AS tag_names,
            COALESCE(
                BOOL_OR(
                    e.subcategory_id IS NOT NULL
                    AND t.subcategory_id IS NOT NULL
                    AND e.subcategory_id <> t.subcategory_id
                ),
                FALSE
            ) AS has_cross_branch_tags
        FROM events e
        LEFT JOIN categories c ON c.id = e.category_id
        LEFT JOIN subcategories sc ON sc.id = e.subcategory_id
        LEFT JOIN event_tags et ON et.event_id = e.id
        LEFT JOIN tags t ON t.id = et.tag_id
        {where_sql}
        GROUP BY e.id, c.name, sc.name
        ORDER BY e.start_time ASC NULLS LAST, e.id ASC
        LIMIT %s OFFSET %s
        """,
        tuple(params),
    )
    rows = cur.fetchall()

    events = [
        EventRow(
            id=row[0],
            title=row[1],
            start_time=row[2],
            end_time=row[3],
            category_id=row[4],
            category_name=row[5],
            subcategory_id=row[6],
            subcategory_name=row[7],
            tag_ids=list(row[8] or []),
            tag_names=list(row[9] or []),
            has_cross_branch_tags=bool(row[10]),
        )
        for row in rows
    ]
    if all_events:
        return events
    return [event for event in events if event.is_broken]


def choose_one(prompt: str, count: int, default_index: int | None = None) -> int | None:
    while True:
        suffix = ""
        if default_index is not None:
            suffix = f" [default {default_index + 1}]"
        raw = input(f"{prompt}{suffix}: ").strip().lower()
        if raw == "q":
            return None
        if raw == "" and default_index is not None:
            return default_index
        if raw.isdigit():
            idx = int(raw) - 1
            if 0 <= idx < count:
                return idx
        print("Invalid choice. Enter a number, empty for default, or 'q' to quit.")


def choose_many_tags(
    tags: list[Tag],
    current_tag_ids: set[str],
) -> tuple[list[str] | None, str]:
    if not tags:
        print("  No tags exist in this subcategory. Tag list will be empty.")
        return [], "no-tags-in-subcategory"

    print("  Tags:")
    id_by_index: list[str] = []
    for idx, tag in enumerate(tags, start=1):
        selected_mark = "*" if tag.id in current_tag_ids else " "
        label = tag.slug if tag.slug else tag.name
        print(f"   {idx:>2}. [{selected_mark}] {tag.name} ({label})")
        id_by_index.append(tag.id)

    while True:
        raw = input(
            "  Tag indexes (comma separated), blank=keep current if possible, '-'=clear, 'q'=quit: "
        ).strip().lower()
        if raw == "q":
            return None, "quit"
        if raw == "-":
            return [], "clear"
        if raw == "":
            kept = [tag.id for tag in tags if tag.id in current_tag_ids]
            if kept:
                return kept, "kept-current"
            return [tags[0].id], "default-first"

        picks: list[int] = []
        ok = True
        for token in raw.split(","):
            token = token.strip()
            if not token.isdigit():
                ok = False
                break
            number = int(token)
            if number < 1 or number > len(id_by_index):
                ok = False
                break
            picks.append(number - 1)

        if not ok:
            print("  Invalid tag list. Example: 1,3")
            continue

        deduped: list[str] = []
        seen: set[str] = set()
        for idx in picks:
            tag_id = id_by_index[idx]
            if tag_id in seen:
                continue
            seen.add(tag_id)
            deduped.append(tag_id)
        return deduped, "manual"


def apply_event_update(cur, *, event_id: str, category: Category, subcategory: Subcategory, tag_ids: list[str]) -> None:
    cur.execute(
        """
        UPDATE events
        SET category = %s, category_id = %s, subcategory_id = %s
        WHERE id = %s
        """,
        (category.name, category.id, subcategory.id, event_id),
    )
    cur.execute("DELETE FROM event_tags WHERE event_id = %s", (event_id,))
    for tag_id in tag_ids:
        cur.execute(
            """
            INSERT INTO event_tags (event_id, tag_id)
            VALUES (%s, %s)
            ON CONFLICT (event_id, tag_id) DO NOTHING
            """,
            (event_id, tag_id),
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Interactive taxonomy assignment for existing events.")
    parser.add_argument("--all", action="store_true", help="Include non-broken events too.")
    parser.add_argument("--limit", type=int, default=50, help="Maximum events to load.")
    parser.add_argument("--offset", type=int, default=0, help="Offset for pagination.")
    parser.add_argument(
        "--event-id",
        action="append",
        dest="event_ids",
        default=[],
        help="Specific event UUID to process (can be repeated).",
    )
    parser.add_argument(
        "--auto-commit",
        action="store_true",
        help="Commit accepted changes without final confirmation prompt.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.limit <= 0:
        raise ValueError("--limit must be > 0")
    if args.offset < 0:
        raise ValueError("--offset must be >= 0")

    load_env()
    conn = get_connection()
    conn.autocommit = False
    cur = conn.cursor()

    try:
        categories, subcategories, tags = load_taxonomy(cur)
        events = load_events(
            cur,
            all_events=args.all,
            limit=args.limit,
            offset=args.offset,
            event_ids=args.event_ids,
        )
        if not events:
            print("[info] No events found for selected filter.")
            conn.rollback()
            return 0

        categories_sorted = sorted(categories, key=lambda item: item.name.lower())
        category_by_id = {item.id: item for item in categories_sorted}
        subcategories_by_category_id: dict[str, list[Subcategory]] = {}
        for category in categories_sorted:
            bucket = [sub for sub in subcategories if sub.category_id == category.id]
            subcategories_by_category_id[category.id] = sorted(bucket, key=lambda item: item.name.lower())
        tags_by_subcategory_id: dict[str, list[Tag]] = {}
        for subcategory in subcategories:
            bucket = [tag for tag in tags if tag.subcategory_id == subcategory.id]
            tags_by_subcategory_id[subcategory.id] = sorted(bucket, key=lambda item: item.name.lower())
        subcategory_by_id = {item.id: item for item in subcategories}

        pending_updates: list[tuple[str, Category, Subcategory, list[str]]] = []

        print(
            f"[info] Loaded {len(events)} events "
            f"({'all' if args.all else 'broken-only'} mode)."
        )
        print("Type 'q' during prompts to stop reviewing.")

        for idx, event in enumerate(events, start=1):
            print("")
            print("=" * 80)
            print(f"[{idx}/{len(events)}] {event.title}")
            print(f"  event_id: {event.id}")
            print(f"  time: {event.start_time or '-'} -> {event.end_time or '-'}")
            print(f"  current category: {event.category_name or '-'}")
            print(f"  current subcategory: {event.subcategory_name or '-'}")
            print(f"  current tags: {', '.join(event.tag_names) if event.tag_names else '-'}")
            if event.broken_flags:
                print(f"  flags: {', '.join(event.broken_flags)}")

            choice = input("  Action [e=edit, s=skip, q=quit]: ").strip().lower()
            if choice == "q":
                break
            if choice == "s":
                continue
            if choice not in ("", "e"):
                print("  Skipped (invalid action).")
                continue

            print("  Categories:")
            default_category_index = None
            for cidx, category in enumerate(categories_sorted, start=1):
                marker = "*" if event.category_id == category.id else " "
                print(f"   {cidx:>2}. [{marker}] {category.name} ({category.slug})")
                if event.category_id == category.id:
                    default_category_index = cidx - 1

            picked_category_index = choose_one("  Choose category", len(categories_sorted), default_category_index)
            if picked_category_index is None:
                break
            category = categories_sorted[picked_category_index]

            options_subcategories = subcategories_by_category_id.get(category.id, [])
            if not options_subcategories:
                print("  Selected category has no subcategories. Skipping event.")
                continue

            print("  Subcategories:")
            default_subcategory_index = None
            for sidx, subcategory in enumerate(options_subcategories, start=1):
                marker = "*" if event.subcategory_id == subcategory.id else " "
                print(f"   {sidx:>2}. [{marker}] {subcategory.name} ({subcategory.slug})")
                if event.subcategory_id == subcategory.id:
                    default_subcategory_index = sidx - 1

            picked_subcategory_index = choose_one(
                "  Choose subcategory",
                len(options_subcategories),
                default_subcategory_index,
            )
            if picked_subcategory_index is None:
                break
            subcategory = options_subcategories[picked_subcategory_index]

            chosen_tag_ids, tag_choice_reason = choose_many_tags(
                tags_by_subcategory_id.get(subcategory.id, []),
                current_tag_ids=set(event.tag_ids),
            )
            if chosen_tag_ids is None:
                break

            chosen_tag_labels = []
            tag_lookup = {tag.id: tag for tag in tags_by_subcategory_id.get(subcategory.id, [])}
            for tag_id in chosen_tag_ids:
                tag = tag_lookup.get(tag_id)
                if tag:
                    chosen_tag_labels.append(tag.slug or tag.name)

            print(
                "  Proposed update -> "
                f"{category.slug}/{subcategory.slug} "
                f"tags=[{', '.join(chosen_tag_labels) if chosen_tag_labels else 'none'}] "
                f"(tag mode: {tag_choice_reason})"
            )

            confirm = input("  Accept this event update? [y/N]: ").strip().lower()
            if confirm == "y":
                pending_updates.append((event.id, category, subcategory, chosen_tag_ids))
                print("  queued")
            else:
                print("  skipped")

        if not pending_updates:
            conn.rollback()
            print("[done] No updates queued. Rolled back.")
            return 0

        print("")
        print(f"[summary] queued_updates={len(pending_updates)}")
        if not args.auto_commit:
            final_confirm = input("Commit all queued updates to DB? [y/N]: ").strip().lower()
            if final_confirm != "y":
                conn.rollback()
                print("[done] Cancelled. Rolled back.")
                return 0

        for event_id, category, subcategory, tag_ids in pending_updates:
            # Safety guard to avoid accidental cross-category choices.
            expected = subcategory_by_id.get(subcategory.id)
            if not expected or expected.category_id != category.id:
                raise RuntimeError(
                    f"Invalid taxonomy selection for event {event_id}: category/subcategory mismatch."
                )
            apply_event_update(
                cur,
                event_id=event_id,
                category=category,
                subcategory=subcategory,
                tag_ids=tag_ids,
            )

        conn.commit()
        print(f"[done] Applied {len(pending_updates)} event updates.")
        return 0
    except KeyboardInterrupt:
        conn.rollback()
        print("\n[done] Interrupted. Rolled back.")
        return 130
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
