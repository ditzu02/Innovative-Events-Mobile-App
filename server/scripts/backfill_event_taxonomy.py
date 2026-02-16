#!/usr/bin/env python3
"""
Suggest and backfill event taxonomy assignments.

What it does:
- Loads taxonomy (categories/subcategories/tags) from the DB.
- Fetches events + currently attached tags.
- Suggests category/subcategory/tags for each event using lightweight text matching.
- Runs as dry-run by default and can apply changes with --apply.

Typical usage:
  python server/scripts/backfill_event_taxonomy.py
  python server/scripts/backfill_event_taxonomy.py --all --limit 500
  python server/scripts/backfill_event_taxonomy.py --event-id <uuid> --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import psycopg2
from dotenv import load_dotenv


TOKEN_RE = re.compile(r"[a-z0-9]+")


# Category-level aliases that commonly appear in manually inserted data.
CATEGORY_ALIASES = {
    "music": "music",
    "live": "music",
    "concert": "music",
    "turneu": "music",
    "trupa": "music",
    "bilet": "music",
    "party": "nightlife",
    "night": "nightlife",
    "nightlife": "nightlife",
    "club": "nightlife",
    "bars": "nightlife",
    "bar": "nightlife",
    "food": "food-drink",
    "drink": "food-drink",
    "drinks": "food-drink",
    "wine": "food-drink",
    "vin": "food-drink",
    "degustare": "food-drink",
    "degustari": "food-drink",
    "beer": "food-drink",
    "art": "arts-culture",
    "arts": "arts-culture",
    "culture": "arts-culture",
    "cultural": "arts-culture",
    "museum": "arts-culture",
    "theatre": "arts-culture",
    "theater": "arts-culture",
    "entertainment": "entertainment",
    "comedy": "entertainment",
    "cinema": "entertainment",
    "game": "entertainment",
    "gaming": "entertainment",
    "outdoor": "outdoor",
    "hike": "outdoor",
    "hiking": "outdoor",
    "market": "markets",
    "piata": "markets",
    "vechituri": "markets",
    "targ": "markets",
    "markets": "markets",
    "flea": "markets",
    "farmers": "markets",
    "christmas": "markets",
}


# Extra hints by subcategory slug to improve suggestion quality.
SUBCATEGORY_HINTS = {
    "electronic": {"techno", "house", "trance", "dj", "rave", "edm", "dnb"},
    "rock-indie": {"rock", "indie", "band", "guitar", "live"},
    "jazz-blues": {"jazz", "blues", "sax", "swing"},
    "classical": {"classical", "orchestra", "symphony", "philharmonic"},
    "club-nights": {"club", "night", "dj", "afterparty", "dance"},
    "rooftop-parties": {"rooftop", "sunset", "terrace"},
    "boat-parties": {"boat", "river", "cruise", "deck"},
    "bar-crawls": {"crawl", "bars", "pub", "beer"},
    "museums": {"museum", "heritage", "history"},
    "exhibitions": {"exhibition", "gallery", "vernissage"},
    "theater": {"theater", "theatre", "play", "drama", "stage"},
    "cultural-festivals": {"festival", "culture", "folk", "tradition"},
    "wine-events": {"wine", "sommelier", "vineyard", "tasting"},
    "beer-events": {"beer", "brewery", "craft", "lager", "ipa"},
    "street-food": {"street", "food", "truck", "bites"},
    "dining-experiences": {"dining", "chef", "menu", "pairing"},
    "comedy": {"comedy", "standup", "stand-up", "improv", "jokes"},
    "cinema": {"cinema", "movie", "film", "screening"},
    "game-nights": {"game", "gaming", "board", "esports", "quiz"},
    "hiking": {"hike", "hiking", "trail", "trek"},
    "outdoor-cinema": {"outdoor", "cinema", "movie", "screening"},
    "outdoor-festivals": {"festival", "outdoor", "openair", "open-air"},
    "farmers-markets": {"farmers", "produce", "organic", "local"},
    "flea-markets": {"flea", "vintage", "antique", "thrift", "collectibles"},
    "christmas-markets": {"christmas", "xmas", "winter", "holiday"},
    "food-markets": {"food", "market", "tasting", "cuisine", "vegan"},
}


TAG_HINTS = {
    "drum-bass": {"dnb", "drum", "bass"},
    "dj-sets": {"dj", "set", "sets"},
    "standup-comedy": {"standup", "stand-up", "jokes"},
    "improv-shows": {"improv", "improvisation"},
    "local-produce": {"produce", "local", "fresh"},
    "farm-to-table": {"farm", "table", "seasonal"},
    "second-hand": {"second", "hand", "thrift"},
    "vintage-clothes": {"vintage", "clothes", "retro"},
    "international-cuisine": {"international", "world", "global"},
    "local-cuisine": {"local", "traditional", "regional"},
}

DEFAULT_TAG_BY_SUBCATEGORY_SLUG = {
    "electronic": "techno",
    "club-nights": "dj-sets",
    "wine-events": "wine-tasting",
    "cultural-festivals": "heritage-celebrations",
    "comedy": "standup-comedy",
    "farmers-markets": "local-produce",
    "flea-markets": "second-hand",
    "food-markets": "tasting-events",
}


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
class EventRecord:
    id: str
    title: str
    description: str | None
    category_text: str | None
    category_id: str | None
    subcategory_id: str | None
    start_time: str | None
    end_time: str | None
    existing_tag_ids: list[str]
    existing_tag_names: list[str]
    existing_tag_slugs: list[str]
    has_cross_branch_tags: bool
    has_branch_mismatch: bool

    @property
    def broken_flags(self) -> list[str]:
        flags: list[str] = []
        if self.category_id is None:
            flags.append("missing_category_id")
        if self.subcategory_id is None:
            flags.append("missing_subcategory_id")
        if not self.existing_tag_ids:
            flags.append("missing_tags")
        if self.has_cross_branch_tags:
            flags.append("cross_branch_tags")
        if self.has_branch_mismatch:
            flags.append("branch_mismatch")
        return flags

    @property
    def is_broken(self) -> bool:
        return bool(self.broken_flags)


@dataclass
class Suggestion:
    event: EventRecord
    category: Category
    subcategory: Subcategory
    tags: list[Tag]
    confidence: float
    score: float
    reasons: list[str] = field(default_factory=list)

    @property
    def changed_branch(self) -> bool:
        return (
            self.event.category_id != self.category.id
            or self.event.subcategory_id != self.subcategory.id
        )

    @property
    def changed_tags(self) -> bool:
        return set(self.event.existing_tag_ids) != {tag.id for tag in self.tags}

    @property
    def needs_update(self) -> bool:
        return self.changed_branch or self.changed_tags

    @property
    def has_tag_candidates(self) -> bool:
        return len(self.tags) > 0


class TaxonomyIndex:
    def __init__(self, categories: list[Category], subcategories: list[Subcategory], tags: list[Tag]) -> None:
        self.categories_by_id = {row.id: row for row in categories}
        self.categories_by_slug = {row.slug: row for row in categories}
        self.categories_by_name = {row.name.lower(): row for row in categories}

        self.subcategories_by_id = {row.id: row for row in subcategories}
        self.subcategories_by_slug = {row.slug: row for row in subcategories}
        self.subcategories_by_name = {row.name.lower(): row for row in subcategories}

        self.subcategories_by_category_id: dict[str, list[Subcategory]] = defaultdict(list)
        for subcategory in subcategories:
            self.subcategories_by_category_id[subcategory.category_id].append(subcategory)

        self.tags_by_id = {row.id: row for row in tags}
        self.tags_by_subcategory_id: dict[str, list[Tag]] = defaultdict(list)
        for tag in tags:
            self.tags_by_subcategory_id[tag.subcategory_id].append(tag)

        self.tag_ids_by_slug: dict[str, set[str]] = defaultdict(set)
        self.tag_ids_by_name: dict[str, set[str]] = defaultdict(set)
        for tag in tags:
            if tag.slug:
                self.tag_ids_by_slug[tag.slug].add(tag.id)
            self.tag_ids_by_name[tag.name.lower()].add(tag.id)

        self.subcategory_profiles = self._build_subcategory_profiles()
        self.tag_profiles = self._build_tag_profiles()
        self.preferred_tag_by_subcategory_id = self._build_preferred_tag_index()

        self.default_subcategory = self._choose_default_subcategory()

    def _build_subcategory_profiles(self) -> dict[str, dict[str, int]]:
        profiles: dict[str, dict[str, int]] = {}
        for subcategory_id, subcategory in self.subcategories_by_id.items():
            profile: dict[str, int] = defaultdict(int)
            category = self.categories_by_id[subcategory.category_id]

            for token in tokenize(category.name, category.slug):
                profile[token] = max(profile[token], 2)
            for token in tokenize(subcategory.name, subcategory.slug):
                profile[token] = max(profile[token], 5)
            for token in SUBCATEGORY_HINTS.get(subcategory.slug, set()):
                for hint_token in tokenize(token):
                    profile[hint_token] = max(profile[hint_token], 6)

            for tag in self.tags_by_subcategory_id.get(subcategory_id, []):
                for token in tokenize(tag.name, tag.slug):
                    profile[token] = max(profile[token], 3)

            profiles[subcategory_id] = dict(profile)
        return profiles

    def _build_tag_profiles(self) -> dict[str, set[str]]:
        profiles: dict[str, set[str]] = {}
        for tag_id, tag in self.tags_by_id.items():
            tokens = tokenize(tag.name, tag.slug)
            tokens |= {tok for tok in tokenize(*TAG_HINTS.get(tag.slug, set()))}
            profiles[tag_id] = tokens
        return profiles

    def _build_preferred_tag_index(self) -> dict[str, str]:
        preferred: dict[str, str] = {}
        for subcategory in self.subcategories_by_id.values():
            default_slug = DEFAULT_TAG_BY_SUBCATEGORY_SLUG.get(subcategory.slug)
            if not default_slug:
                continue
            candidates = self.tag_ids_by_slug.get(default_slug, set())
            if len(candidates) == 1:
                preferred[subcategory.id] = next(iter(candidates))
        return preferred

    def _choose_default_subcategory(self) -> Subcategory:
        ranked = sorted(
            self.subcategories_by_id.values(),
            key=lambda subcat: (
                len(self.tags_by_subcategory_id.get(subcat.id, [])),
                subcat.slug,
            ),
            reverse=True,
        )
        if not ranked:
            raise RuntimeError("No subcategories found in DB taxonomy.")
        return ranked[0]

    def resolve_category_hint(self, category_text: str | None, event_tokens: set[str]) -> Category | None:
        if category_text:
            normalized = str(category_text).strip().lower()
            if normalized in self.categories_by_name:
                return self.categories_by_name[normalized]

            text_slug = slugify(normalized)
            if text_slug in self.categories_by_slug:
                return self.categories_by_slug[text_slug]

        for token in event_tokens:
            mapped_slug = CATEGORY_ALIASES.get(token)
            if mapped_slug and mapped_slug in self.categories_by_slug:
                return self.categories_by_slug[mapped_slug]
        return None

    def resolve_existing_tag_ids(self, event: EventRecord) -> set[str]:
        keys: set[str] = set()
        keys.update(slugify(item) for item in event.existing_tag_names if item)
        keys.update(str(item).strip().lower() for item in event.existing_tag_slugs if item)

        resolved: set[str] = set()
        for key in keys:
            if not key:
                continue
            slug_candidates = self.tag_ids_by_slug.get(key, set())
            if len(slug_candidates) == 1:
                resolved |= slug_candidates
                continue

            name_candidates = self.tag_ids_by_name.get(key.replace("-", " "), set())
            if len(name_candidates) == 1:
                resolved |= name_candidates
        return resolved

    def pick_subcategory(
        self,
        event: EventRecord,
        event_tokens: set[str],
        mapped_existing_tag_ids: set[str],
        require_tags: bool,
    ) -> tuple[Subcategory, float, float, list[str]]:
        scores: list[tuple[float, Subcategory, list[str]]] = []
        tag_hit_counts: Counter[str] = Counter()
        for tag_id in mapped_existing_tag_ids:
            tag = self.tags_by_id.get(tag_id)
            if tag:
                tag_hit_counts[tag.subcategory_id] += 1

        category_hint = self.resolve_category_hint(event.category_text, event_tokens)

        for subcategory in self.subcategories_by_id.values():
            score = 0.0
            reasons: list[str] = []
            category = self.categories_by_id[subcategory.category_id]

            if event.subcategory_id == subcategory.id:
                score += 14
                reasons.append("keeps existing subcategory")
            if event.category_id == subcategory.category_id:
                score += 8
                reasons.append("matches existing category_id")
            if category_hint and category_hint.id == subcategory.category_id:
                score += 14
                reasons.append(f"category hint -> {category.slug}")

            tag_hits = tag_hit_counts.get(subcategory.id, 0)
            if tag_hits:
                score += float(tag_hits * 10)
                reasons.append(f"{tag_hits} existing tags align")

            profile = self.subcategory_profiles.get(subcategory.id, {})
            matched_tokens = [token for token in event_tokens if token in profile]
            if matched_tokens:
                keyword_score = min(34, sum(profile[token] for token in matched_tokens))
                score += float(keyword_score)
                sample = ", ".join(sorted(matched_tokens)[:4])
                reasons.append(f"keyword hits: {sample}")

            if require_tags and not self.tags_by_subcategory_id.get(subcategory.id):
                score -= 8
                reasons.append("no tags in subcategory")

            scores.append((score, subcategory, reasons))

        scores.sort(
            key=lambda item: (
                item[0],
                len(self.tags_by_subcategory_id.get(item[1].id, [])),
                item[1].slug,
            ),
            reverse=True,
        )

        best_score, best_subcategory, best_reasons = scores[0]
        second_score = scores[1][0] if len(scores) > 1 else 0.0

        # Low-signal fallback: pick best-tagged subcategory in hinted category if possible.
        if best_score <= 0 and category_hint:
            hinted_subcategories = self.subcategories_by_category_id.get(category_hint.id, [])
            hinted_subcategories = sorted(
                hinted_subcategories,
                key=lambda item: (
                    len(self.tags_by_subcategory_id.get(item.id, [])),
                    item.slug,
                ),
                reverse=True,
            )
            if hinted_subcategories:
                best_subcategory = hinted_subcategories[0]
                best_reasons = [f"fallback from category hint '{category_hint.slug}'"]

        if require_tags and not self.tags_by_subcategory_id.get(best_subcategory.id):
            same_category_options = sorted(
                self.subcategories_by_category_id.get(best_subcategory.category_id, []),
                key=lambda item: (
                    len(self.tags_by_subcategory_id.get(item.id, [])),
                    item.slug,
                ),
                reverse=True,
            )
            fallback = next(
                (item for item in same_category_options if self.tags_by_subcategory_id.get(item.id)),
                None,
            )
            best_subcategory = fallback or self.default_subcategory
            best_score = max(best_score, 0.0)
            best_reasons.append(f"fallback to '{best_subcategory.slug}' (has tags)")

        return best_subcategory, best_score, second_score, best_reasons

    def pick_tags(
        self,
        subcategory: Subcategory,
        event_tokens: set[str],
        mapped_existing_tag_ids: set[str],
        min_tags: int,
        max_tags: int,
    ) -> tuple[list[Tag], list[str]]:
        available_tags = self.tags_by_subcategory_id.get(subcategory.id, [])
        if not available_tags:
            return [], ["subcategory has no tags"]

        scored_tags: list[tuple[int, Tag, list[str]]] = []
        for tag in available_tags:
            score = 0
            reasons: list[str] = []
            if tag.id in mapped_existing_tag_ids:
                score += 18
                reasons.append("keeps existing tag")

            profile = self.tag_profiles.get(tag.id, set())
            matches = sorted(token for token in event_tokens if token in profile)
            if matches:
                score += min(12, len(matches) * 4)
                reasons.append(f"keyword hits: {', '.join(matches[:3])}")
            scored_tags.append((score, tag, reasons))

        scored_tags.sort(key=lambda item: (item[0], item[1].name.lower()), reverse=True)

        positive = [item for item in scored_tags if item[0] > 0]
        chosen = positive[:max_tags]
        chosen_ids = {item[1].id for item in chosen}

        # If no positive signals, prefer a subcategory-specific default tag over lexical fallback.
        if not chosen:
            preferred_id = self.preferred_tag_by_subcategory_id.get(subcategory.id)
            if preferred_id:
                preferred_item = next((item for item in scored_tags if item[1].id == preferred_id), None)
                if preferred_item:
                    chosen.append(preferred_item)
                    chosen_ids.add(preferred_id)

        if len(chosen) < min_tags:
            for candidate in scored_tags:
                if candidate[1].id in chosen_ids:
                    continue
                chosen.append(candidate)
                chosen_ids.add(candidate[1].id)
                if len(chosen) >= min(min_tags, max_tags):
                    break

        chosen = chosen[:max_tags]
        tag_reasons: list[str] = []
        tags: list[Tag] = []
        for score, tag, reasons in chosen:
            tags.append(tag)
            if reasons:
                tag_reasons.append(f"{tag.slug}: {', '.join(reasons)}")
            elif score == 0:
                tag_reasons.append(f"{tag.slug}: fallback")
        return tags, tag_reasons


def slugify(value: str) -> str:
    lowered = value.strip().lower()
    lowered = re.sub(r"[^a-z0-9]+", "-", lowered)
    return lowered.strip("-")


def tokenize(*values: str | None) -> set[str]:
    tokens: set[str] = set()
    for value in values:
        if not value:
            continue
        normalized = unicodedata.normalize("NFKD", str(value))
        normalized = normalized.encode("ascii", "ignore").decode("ascii").lower()
        for raw in TOKEN_RE.findall(normalized):
            token = raw.strip()
            if not token:
                continue
            tokens.add(token)
            # very light singularization for common plural forms
            if token.endswith("s") and len(token) >= 4:
                tokens.add(token[:-1])
    return tokens


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


def load_taxonomy(cur) -> TaxonomyIndex:
    cur.execute(
        """
        SELECT c.id::text, c.name, c.slug
        FROM categories c
        ORDER BY c.name ASC
        """
    )
    categories = [Category(id=row[0], name=row[1], slug=row[2]) for row in cur.fetchall()]

    cur.execute(
        """
        SELECT sc.id::text, sc.category_id::text, sc.name, sc.slug
        FROM subcategories sc
        ORDER BY sc.name ASC
        """
    )
    subcategories = [
        Subcategory(id=row[0], category_id=row[1], name=row[2], slug=row[3])
        for row in cur.fetchall()
    ]

    cur.execute(
        """
        SELECT t.id::text, t.subcategory_id::text, t.name, COALESCE(t.slug, '')
        FROM tags t
        ORDER BY t.name ASC
        """
    )
    tags = [Tag(id=row[0], subcategory_id=row[1], name=row[2], slug=row[3]) for row in cur.fetchall()]

    if not categories or not subcategories:
        raise RuntimeError(
            "Taxonomy tables are empty. Seed taxonomy first (e.g. `python server/scripts/reseed.py --tags`)."
        )
    return TaxonomyIndex(categories=categories, subcategories=subcategories, tags=tags)


def load_events(
    cur,
    *,
    limit: int,
    offset: int,
    event_ids: list[str],
) -> list[EventRecord]:
    where_sql = ""
    params: list[Any] = [limit, offset]
    if event_ids:
        where_sql = "WHERE e.id = ANY(%s::uuid[])"
        params.append(event_ids)

    cur.execute(
        f"""
        SELECT
            e.id::text,
            e.title,
            e.description,
            e.category,
            e.category_id::text,
            e.subcategory_id::text,
            e.start_time::text,
            e.end_time::text,
            COALESCE(array_remove(array_agg(DISTINCT et.tag_id::text), NULL), '{{}}') AS tag_ids,
            COALESCE(array_remove(array_agg(DISTINCT t.name), NULL), '{{}}') AS tag_names,
            COALESCE(array_remove(array_agg(DISTINCT t.slug), NULL), '{{}}') AS tag_slugs,
            COALESCE(
                BOOL_OR(
                    e.subcategory_id IS NOT NULL
                    AND t.subcategory_id IS NOT NULL
                    AND e.subcategory_id <> t.subcategory_id
                ),
                FALSE
            ) AS has_cross_branch_tags,
            COALESCE(
                (
                    e.category_id IS NOT NULL
                    AND sc.category_id IS NOT NULL
                    AND e.category_id <> sc.category_id
                ),
                FALSE
            ) AS has_branch_mismatch
        FROM events e
        LEFT JOIN event_tags et ON et.event_id = e.id
        LEFT JOIN tags t ON t.id = et.tag_id
        LEFT JOIN subcategories sc ON sc.id = e.subcategory_id
        {where_sql}
        GROUP BY e.id, sc.category_id
        ORDER BY e.start_time ASC NULLS LAST, e.id ASC
        LIMIT %s OFFSET %s
        """,
        tuple(params[2:] + params[:2]) if event_ids else tuple(params),
    )
    rows = cur.fetchall()

    records: list[EventRecord] = []
    for row in rows:
        records.append(
            EventRecord(
                id=row[0],
                title=row[1],
                description=row[2],
                category_text=row[3],
                category_id=row[4],
                subcategory_id=row[5],
                start_time=row[6],
                end_time=row[7],
                existing_tag_ids=list(row[8] or []),
                existing_tag_names=list(row[9] or []),
                existing_tag_slugs=[slug for slug in (row[10] or []) if slug],
                has_cross_branch_tags=bool(row[11]),
                has_branch_mismatch=bool(row[12]),
            )
        )
    return records


def confidence_from_scores(top_score: float, second_score: float) -> float:
    if top_score <= 0:
        return 0.0
    dominance = max(0.0, (top_score - second_score) / max(1.0, top_score))
    saturation = min(1.0, top_score / 35.0)
    confidence = 0.45 + 0.35 * dominance + 0.20 * saturation
    return max(0.0, min(0.98, confidence))


def build_suggestion(
    taxonomy: TaxonomyIndex,
    event: EventRecord,
    *,
    min_tags: int,
    max_tags: int,
    require_tags: bool,
    reclassify: bool,
) -> Suggestion:
    event_tokens = tokenize(
        event.title,
        event.description,
        event.category_text,
        *event.existing_tag_names,
        *event.existing_tag_slugs,
    )
    mapped_existing_tag_ids = taxonomy.resolve_existing_tag_ids(event)
    if not reclassify and event.category_id and event.subcategory_id and not event.has_branch_mismatch:
        subcategory = taxonomy.subcategories_by_id[event.subcategory_id]
        top_score = 100.0
        second_score = 0.0
        reasons = ["kept existing branch (tag-only mode)"]
    else:
        subcategory, top_score, second_score, reasons = taxonomy.pick_subcategory(
            event,
            event_tokens,
            mapped_existing_tag_ids,
            require_tags=require_tags,
        )
    category = taxonomy.categories_by_id[subcategory.category_id]
    tags, tag_reasons = taxonomy.pick_tags(
        subcategory,
        event_tokens,
        mapped_existing_tag_ids,
        min_tags=min_tags,
        max_tags=max_tags,
    )
    confidence = confidence_from_scores(top_score, second_score)
    if not tags:
        confidence = 0.0
        reasons = reasons + ["no tags exist in taxonomy for this subcategory"]
    return Suggestion(
        event=event,
        category=category,
        subcategory=subcategory,
        tags=tags,
        confidence=confidence,
        score=top_score,
        reasons=reasons + tag_reasons,
    )


def apply_suggestion(cur, suggestion: Suggestion, *, update_branch: bool) -> None:
    if update_branch:
        cur.execute(
            """
            UPDATE events
            SET category = %s, category_id = %s, subcategory_id = %s
            WHERE id = %s
            """,
            (
                suggestion.category.name,
                suggestion.category.id,
                suggestion.subcategory.id,
                suggestion.event.id,
            ),
        )

    cur.execute("DELETE FROM event_tags WHERE event_id = %s", (suggestion.event.id,))
    for tag in suggestion.tags:
        cur.execute(
            """
            INSERT INTO event_tags (event_id, tag_id)
            VALUES (%s, %s)
            ON CONFLICT (event_id, tag_id) DO NOTHING
            """,
            (suggestion.event.id, tag.id),
        )


def format_preview_line(index: int, suggestion: Suggestion) -> str:
    title = suggestion.event.title.strip()
    if len(title) > 58:
        title = title[:55] + "..."
    tag_slugs = ", ".join(tag.slug for tag in suggestion.tags) or "none"
    flags = ",".join(suggestion.event.broken_flags) or "ok"
    return (
        f"[{index}] {suggestion.event.id[:8]} \"{title}\" "
        f"-> {suggestion.category.slug}/{suggestion.subcategory.slug} "
        f"[{tag_slugs}] conf={suggestion.confidence:.2f} flags={flags}"
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Suggest/apply taxonomy category/subcategory/tag assignments to events.")
    parser.add_argument("--apply", action="store_true", help="Apply suggestions to DB. Default is dry-run.")
    parser.add_argument("--all", action="store_true", help="Process all fetched events, not only broken ones.")
    parser.add_argument(
        "--reclassify",
        action="store_true",
        help="Allow changing category/subcategory. Default mode is tag-only.",
    )
    parser.add_argument("--limit", type=int, default=200, help="Max events to fetch.")
    parser.add_argument("--offset", type=int, default=0, help="Offset for event fetch pagination.")
    parser.add_argument(
        "--event-id",
        action="append",
        dest="event_ids",
        default=[],
        help="Specific event UUID to process. Can be used multiple times.",
    )
    parser.add_argument("--min-tags", type=int, default=1, help="Minimum number of tags to assign.")
    parser.add_argument("--max-tags", type=int, default=3, help="Maximum number of tags to assign.")
    parser.add_argument(
        "--min-confidence",
        type=float,
        default=0.55,
        help="Minimum confidence required for updates in --apply mode.",
    )
    parser.add_argument(
        "--allow-subcategory-without-tags",
        action="store_true",
        help="Allow choosing a subcategory that currently has no tags.",
    )
    parser.add_argument(
        "--preview-limit",
        type=int,
        default=30,
        help="How many suggestion lines to print.",
    )
    parser.add_argument(
        "--json-out",
        help="Optional path to write suggestions as JSON for review.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.limit <= 0:
        raise ValueError("--limit must be > 0")
    if args.offset < 0:
        raise ValueError("--offset must be >= 0")
    if args.min_tags < 0:
        raise ValueError("--min-tags must be >= 0")
    if args.max_tags <= 0:
        raise ValueError("--max-tags must be > 0")
    if args.min_tags > args.max_tags:
        raise ValueError("--min-tags cannot be greater than --max-tags")
    if not (0.0 <= args.min_confidence <= 1.0):
        raise ValueError("--min-confidence must be between 0 and 1")

    load_env()
    conn = get_connection()
    conn.autocommit = False
    cur = conn.cursor()

    try:
        taxonomy = load_taxonomy(cur)
        events = load_events(
            cur,
            limit=args.limit,
            offset=args.offset,
            event_ids=args.event_ids,
        )

        if not events:
            print("[info] No events found for the selected filter.")
            conn.rollback()
            return 0

        considered = events if args.all else [event for event in events if event.is_broken]
        if not considered:
            print("[info] No broken events found in current selection.")
            conn.rollback()
            return 0

        if not args.reclassify:
            # Tag-only default mode: keep branch unchanged, only backfill tags.
            considered = [
                event
                for event in considered
                if event.category_id is not None and event.subcategory_id is not None and not event.has_branch_mismatch
            ]
            if not considered:
                print(
                    "[info] No tag-eligible events found. "
                    "Events need existing category_id/subcategory_id in default mode."
                )
                conn.rollback()
                return 0

        suggestions: list[Suggestion] = []
        for event in considered:
            suggestion = build_suggestion(
                taxonomy,
                event,
                min_tags=args.min_tags,
                max_tags=args.max_tags,
                require_tags=not args.allow_subcategory_without_tags,
                reclassify=args.reclassify,
            )
            suggestions.append(suggestion)

        if not args.reclassify:
            # In default mode, only tag changes are considered updates.
            updates = [item for item in suggestions if item.changed_tags]
        else:
            updates = [item for item in suggestions if item.needs_update]

        no_tag_candidates = [item for item in suggestions if not item.has_tag_candidates]
        actionable_updates = [item for item in updates if item.has_tag_candidates]
        eligible_updates = [item for item in actionable_updates if item.confidence >= args.min_confidence]

        print(f"[summary] fetched={len(events)} considered={len(considered)} updates={len(updates)}")
        print(
            f"[summary] eligible_updates(conf>={args.min_confidence:.2f})={len(eligible_updates)} "
            f"mode={'apply' if args.apply else 'dry-run'}"
        )
        if no_tag_candidates:
            print(
                "[summary] no_tag_candidates="
                f"{len(no_tag_candidates)} "
                "(subcategories with zero tags in current taxonomy)"
            )

        preview_count = min(args.preview_limit, len(suggestions))
        for index in range(preview_count):
            print(format_preview_line(index + 1, suggestions[index]))

        if args.json_out:
            payload = []
            for suggestion in suggestions:
                payload.append(
                    {
                        "event_id": suggestion.event.id,
                        "title": suggestion.event.title,
                        "start_time": suggestion.event.start_time,
                        "broken_flags": suggestion.event.broken_flags,
                        "current": {
                            "category_id": suggestion.event.category_id,
                            "subcategory_id": suggestion.event.subcategory_id,
                            "tag_ids": suggestion.event.existing_tag_ids,
                            "tag_names": suggestion.event.existing_tag_names,
                        },
                        "suggested": {
                            "category_id": suggestion.category.id,
                            "category_slug": suggestion.category.slug,
                            "subcategory_id": suggestion.subcategory.id,
                            "subcategory_slug": suggestion.subcategory.slug,
                            "tag_ids": [tag.id for tag in suggestion.tags],
                            "tag_slugs": [tag.slug for tag in suggestion.tags],
                        },
                        "confidence": round(suggestion.confidence, 4),
                        "score": round(suggestion.score, 2),
                        "reasons": suggestion.reasons,
                        "needs_update": suggestion.needs_update,
                    }
                )
            out_path = Path(args.json_out)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            print(f"[info] Wrote JSON suggestions to {out_path}")

        if not args.apply:
            conn.rollback()
            print("[done] Dry-run complete. No changes were committed.")
            return 0

        for suggestion in eligible_updates:
            apply_suggestion(cur, suggestion, update_branch=args.reclassify)

        conn.commit()
        print(f"[done] Applied {len(eligible_updates)} updates.")
        if len(updates) > len(eligible_updates):
            skipped = len(updates) - len(eligible_updates)
            print(
                f"[done] Skipped {skipped} low-confidence updates (< {args.min_confidence:.2f}). "
                "Review with --json-out and rerun with lower threshold if desired."
            )
        return 0
    except Exception as exc:
        conn.rollback()
        print(f"[fatal] Failed: {exc}")
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
