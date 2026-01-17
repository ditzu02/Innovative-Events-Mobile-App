import logging
import os
from pathlib import Path
from typing import Any, Dict, List

import psycopg2
from psycopg2.extras import Json
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

dotenv_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path)

DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_HOST = os.getenv("DB_HOST")
DB_PORT = os.getenv("DB_PORT")
DB_NAME = os.getenv("DB_NAME")

REQUIRED_ENV_VARS = (DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME)
if not all(REQUIRED_ENV_VARS):
  raise RuntimeError("Missing one or more DB env vars (DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME)")


def get_conn():
  return psycopg2.connect(
      user=DB_USER,
      password=DB_PASSWORD,
      host=DB_HOST,
      port=DB_PORT,
      dbname=DB_NAME,
  )


def get_or_create_location(cur, data: Dict[str, Any]):
  cur.execute(
      """
      SELECT id FROM locations
      WHERE name = %s AND address IS NOT DISTINCT FROM %s
      """,
      (data["name"], data.get("address")),
  )
  row = cur.fetchone()
  if row:
      return row[0]

  cur.execute(
      """
      INSERT INTO locations (name, address, latitude, longitude, features, cover_image_url, rating_avg, rating_count)
      VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
      RETURNING id;
      """,
      (
          data["name"],
          data.get("address"),
          data["latitude"],
          data["longitude"],
          Json(data.get("features")) if data.get("features") is not None else None,
          data.get("cover_image_url"),
          data.get("rating_avg", 0),
          data.get("rating_count", 0),
      ),
  )
  return cur.fetchone()[0]


def get_or_create_tag(cur, name: str):
  cur.execute("SELECT id FROM tags WHERE name = %s", (name,))
  row = cur.fetchone()
  if row:
      return row[0]
  cur.execute(
      "INSERT INTO tags (name) VALUES (%s) ON CONFLICT (name) DO NOTHING RETURNING id;",
      (name,),
  )
  inserted = cur.fetchone()
  if inserted:
      return inserted[0]
  # If conflict, fetch again
  cur.execute("SELECT id FROM tags WHERE name = %s", (name,))
  return cur.fetchone()[0]


def get_or_create_event(cur, data: Dict[str, Any], location_id):
  cur.execute(
      """
      SELECT id FROM events WHERE title = %s AND start_time = %s
      """,
      (data["title"], data["start_time"]),
  )
  row = cur.fetchone()
  if row:
      return row[0]

  cur.execute(
      """
      INSERT INTO events (
          location_id,
          title,
          category,
          start_time,
          end_time,
          description,
          cover_image_url,
          ticket_url,
          price,
          rating_avg,
          rating_count
      ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
      RETURNING id;
      """,
      (
          location_id,
          data["title"],
          data.get("category"),
          data["start_time"],
          data["end_time"],
          data.get("description"),
          data.get("cover_image_url"),
          data.get("ticket_url"),
          data.get("price"),
          data.get("rating_avg", 0),
          data.get("rating_count", 0),
      ),
  )
  return cur.fetchone()[0]


def link_event_tags(cur, event_id, tag_ids: List[str]):
  for tag_id in tag_ids:
      cur.execute(
          """
          INSERT INTO event_tags (event_id, tag_id)
          VALUES (%s, %s)
          ON CONFLICT (event_id, tag_id) DO NOTHING;
          """,
          (event_id, tag_id),
      )


def main():
  locations = [
      {
          "name": "Pulse Arena",
          "address": "123 Market St, San Francisco, CA",
          "latitude": 37.7893,
          "longitude": -122.4015,
          "features": {"amenities": ["food trucks", "restrooms"], "accessibility": ["wheelchair"]},
          "cover_image_url": "https://example.com/pulse-arena.jpg",
          "rating_avg": 4.6,
          "rating_count": 188,
      },
      {
          "name": "Harborfront Pavilion",
          "address": "500 Embarcadero, San Francisco, CA",
          "latitude": 37.7965,
          "longitude": -122.395,
          "features": {"amenities": ["indoor", "outdoor"], "accessibility": ["wheelchair"]},
          "cover_image_url": "https://example.com/harborfront.jpg",
          "rating_avg": 4.4,
          "rating_count": 142,
      },
      {
          "name": "Skyline Rooftop",
          "address": "77 Howard St, San Francisco, CA",
          "latitude": 37.7912,
          "longitude": -122.3934,
          "features": {"amenities": ["bar", "lounge"], "accessibility": []},
          "cover_image_url": "https://example.com/skyline.jpg",
          "rating_avg": 4.7,
          "rating_count": 203,
      },
  ]

  tags = ["electronic", "live", "outdoor", "indoor", "vip", "family", "art", "tech"]

  events = [
      {
          "title": "Sunset Synthwave",
          "category": "Music",
          "start_time": "2025-05-12T18:00:00Z",
          "end_time": "2025-05-12T22:30:00Z",
          "description": "Retro-future synthwave night with live visuals and guest DJs.",
          "cover_image_url": "https://example.com/synthwave.jpg",
          "ticket_url": "https://www.livetickets.ro/bilete/una-noche-caliente-14-feb-little-club-targu-mures",
          "price": 35,
          "rating_avg": 4.8,
          "rating_count": 95,
          "location_name": "Pulse Arena",
          "tags": ["electronic", "vip"],
      },
      {
          "title": "Harbor Lights Art Walk",
          "category": "Art",
          "start_time": "2025-06-02T17:00:00Z",
          "end_time": "2025-06-02T20:00:00Z",
          "description": "Curated waterfront art exhibits with live music and local vendors.",
          "cover_image_url": "https://example.com/art-walk.jpg",
          "ticket_url": "https://example.com/tickets/harbor-lights",
          "price": 20,
          "rating_avg": 4.5,
          "rating_count": 64,
          "location_name": "Harborfront Pavilion",
          "tags": ["art", "outdoor", "family"],
      },
      {
          "title": "Skyline Sessions: Live Acoustic",
          "category": "Music",
          "start_time": "2025-07-15T19:30:00Z",
          "end_time": "2025-07-15T22:00:00Z",
          "description": "Acoustic sets from emerging artists with panoramic city views.",
          "cover_image_url": "https://example.com/skyline-sessions.jpg",
          "ticket_url": "https://example.com/tickets/skyline-sessions",
          "price": 28,
          "rating_avg": 4.6,
          "rating_count": 81,
          "location_name": "Skyline Rooftop",
          "tags": ["live", "indoor", "vip"],
      },
  ]

  conn = get_conn()
  cur = conn.cursor()
  try:
      logger.info("Seeding locations...")
      location_ids = {}
      for loc in locations:
          l_id = get_or_create_location(cur, loc)
          location_ids[loc["name"]] = l_id

      logger.info("Seeding tags...")
      tag_ids = {name: get_or_create_tag(cur, name) for name in tags}

      logger.info("Seeding events and event_tags...")
      for ev in events:
          loc_id = location_ids[ev["location_name"]]
          event_id = get_or_create_event(cur, ev, loc_id)
          tag_list = ev.get("tags", [])
          link_event_tags(cur, event_id, [tag_ids[t] for t in tag_list if t in tag_ids])

      conn.commit()
      logger.info("Seeding complete.")
  except Exception:
      conn.rollback()
      logger.exception("Seeding failed; rolled back.")
      raise
  finally:
      cur.close()
      conn.close()


if __name__ == "__main__":
  main()
