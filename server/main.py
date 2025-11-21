from datetime import datetime
from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv
from psycopg2.pool import SimpleConnectionPool
from decimal import Decimal
import logging
import os
from pathlib import Path

app = Flask(__name__)
CORS(app)

# Configure basic logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# load .env from the same folder as main.py
dotenv_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path)

# Load environment variables 
DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_HOST = os.getenv("DB_HOST")
DB_PORT = os.getenv("DB_PORT")
DB_NAME = os.getenv("DB_NAME")

REQUIRED_ENV_VARS = {
    "DB_USER": DB_USER,
    "DB_PASSWORD": DB_PASSWORD,
    "DB_HOST": DB_HOST,
    "DB_PORT": DB_PORT,
    "DB_NAME": DB_NAME,
}

missing_env = [name for name, value in REQUIRED_ENV_VARS.items() if not value]
if missing_env:
    missing_list = ", ".join(missing_env)
    logger.error("Missing required environment variables: %s", missing_list)
    raise RuntimeError(f"Missing required environment variables: {missing_list}")

logger.info("Loaded database configuration for host=%s port=%s db=%s", DB_HOST, DB_PORT, DB_NAME)

db_pool: SimpleConnectionPool | None = None


def init_db_pool() -> None:
    """Initialize a global connection pool."""
    global db_pool
    if db_pool:
        return
    try:
        db_pool = SimpleConnectionPool(
            minconn=1,
            maxconn=5,
            user=DB_USER,
            password=DB_PASSWORD,
            host=DB_HOST,
            port=DB_PORT,
            dbname=DB_NAME,
        )
        logger.info("Database connection pool initialized")
    except Exception:
        logger.exception("Unable to initialize database connection pool")
        raise


def get_db_connection():
    """Get a connection from the pool."""
    if not db_pool:
        init_db_pool()
    return db_pool.getconn()


def release_db_connection(connection) -> None:
    """Return a connection to the pool."""
    if db_pool and connection:
        db_pool.putconn(connection)


# Initialize pool on startup to fail fast if DB is unreachable
init_db_pool()


@app.route("/health")
def health():
    connection = None
    cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute("SELECT 1;")
        cursor.fetchone()
        return jsonify({"status": "ok", "db": "up"})
    except Exception as exc:
        logger.exception("Health check failed")
        return jsonify({"status": "degraded", "db": "error", "error": str(exc)}), 503
    finally:
        if cursor:
            cursor.close()
        if connection:
            release_db_connection(connection)

@app.route("/api/test-db")
def test_db():
    connection = None
    cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute("SELECT NOW();")
        result = cursor.fetchone()

        return jsonify({
            "success": True,
            "time": str(result[0])
        })

    except Exception as e:
        logger.exception("Database test failed")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500
    finally:
        if cursor:
            cursor.close()
        if connection:
            release_db_connection(connection)

@app.route("/api/events")
def list_events():
    connection = None
    cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()

        query = """
            WITH tag_agg AS (
                SELECT et.event_id, array_remove(array_agg(DISTINCT t.name), NULL) AS tags
                FROM event_tags et
                JOIN tags t ON t.id = et.tag_id
                GROUP BY et.event_id
            ),
            review_agg AS (
                SELECT event_id, COUNT(*) AS review_count, AVG(rating) AS review_avg
                FROM reviews
                GROUP BY event_id
            )
            SELECT
                e.id,
                e.title,
                e.category,
                e.start_time,
                e.end_time,
                e.description,
                e.cover_image_url,
                e.price,
                e.rating_avg,
                e.rating_count,
                l.id AS location_id,
                l.name AS location_name,
                l.address AS location_address,
                l.latitude AS location_latitude,
                l.longitude AS location_longitude,
                l.features AS location_features,
                l.cover_image_url AS location_cover_image_url,
                l.rating_avg AS location_rating_avg,
                l.rating_count AS location_rating_count,
                COALESCE(ta.tags, '{}') AS tags,
                ra.review_avg,
                ra.review_count
            FROM events e
            LEFT JOIN locations l ON e.location_id = l.id
            LEFT JOIN tag_agg ta ON ta.event_id = e.id
            LEFT JOIN review_agg ra ON ra.event_id = e.id
            WHERE 1=1
        """

        filters = []
        params = []

        category = request.args.get("category")
        if category:
            filters.append("e.category ILIKE %s")
            params.append(f"%{category}%")

        tag = request.args.get("tag")
        if tag:
            filters.append("%s = ANY(COALESCE(ta.tags, '{}'))")
            params.append(tag)

        date_str = request.args.get("date")
        if date_str:
            try:
                parsed = datetime.fromisoformat(date_str).date()
                filters.append("DATE(e.start_time) = %s")
                params.append(parsed)
            except ValueError:
                return jsonify({"error": "Invalid date format. Use YYYY-MM-DD."}), 400

        min_rating = request.args.get("min_rating")
        if min_rating:
            try:
                min_rating_val = float(min_rating)
                filters.append("COALESCE(ra.review_avg, e.rating_avg) >= %s")
                params.append(min_rating_val)
            except ValueError:
                return jsonify({"error": "min_rating must be a number"}), 400

        if filters:
            query += " AND " + " AND ".join(filters)

        sort = request.args.get("sort", "soonest")
        if sort == "toprated":
            query += " ORDER BY COALESCE(ra.review_avg, e.rating_avg) DESC NULLS LAST, e.start_time ASC"
        elif sort == "price":
            query += " ORDER BY e.price ASC NULLS LAST, e.start_time ASC"
        else:
            query += " ORDER BY e.start_time ASC"

        cursor.execute(query, tuple(params))
        rows = cursor.fetchall()

        events = []
        for row in rows:
            (
                event_id,
                title,
                category,
                start_time,
                end_time,
                description,
                cover_image_url,
                price,
                rating_avg,
                rating_count,
                location_id,
                location_name,
                location_address,
                location_latitude,
                location_longitude,
                location_features,
                location_cover_image_url,
                location_rating_avg,
                location_rating_count,
                tags,
                review_avg,
                review_count,
            ) = row

            location = None
            if location_id:
                location = {
                    "id": str(location_id),
                    "name": location_name,
                    "address": location_address,
                    "latitude": float(location_latitude) if location_latitude is not None else None,
                    "longitude": float(location_longitude) if location_longitude is not None else None,
                    "features": location_features,
                    "cover_image_url": location_cover_image_url,
                    "rating_avg": float(location_rating_avg) if location_rating_avg is not None else None,
                    "rating_count": location_rating_count,
                }

            events.append(
                {
                    "id": str(event_id),
                    "title": title,
                    "category": category,
                    "start_time": start_time.isoformat() if start_time else None,
                    "end_time": end_time.isoformat() if end_time else None,
                    "description": description,
                    "cover_image_url": cover_image_url,
                    "price": float(price) if isinstance(price, Decimal) or isinstance(price, (int, float)) else None,
                    "rating_avg": float(review_avg) if review_avg is not None else float(rating_avg) if rating_avg is not None else None,
                    "rating_count": review_count if review_count is not None else rating_count,
                    "tags": tags or [],
                    "location": location,
                }
            )

        return jsonify({"events": events})
    except Exception:
        logger.exception("Failed to fetch events")
        return jsonify({"error": "Unable to fetch events"}), 500
    finally:
        if cursor:
            cursor.close()
        if connection:
            release_db_connection(connection)


@app.route("/api/events/<event_id>")
def event_detail(event_id: str):
    connection = None
    cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()

        cursor.execute(
            """
            SELECT
                e.id,
                e.title,
                e.category,
                e.start_time,
                e.end_time,
                e.description,
                e.cover_image_url,
                e.price,
                e.rating_avg,
                e.rating_count,
                l.id AS location_id,
                l.name AS location_name,
                l.address AS location_address,
                l.latitude AS location_latitude,
                l.longitude AS location_longitude,
                l.features AS location_features,
                l.cover_image_url AS location_cover_image_url,
                l.rating_avg AS location_rating_avg,
                l.rating_count AS location_rating_count
            FROM events e
            LEFT JOIN locations l ON e.location_id = l.id
            WHERE e.id = %s
            """,
            (event_id,),
        )
        row = cursor.fetchone()
        if not row:
            return jsonify({"error": "Event not found"}), 404

        (
            event_id,
            title,
            category,
            start_time,
            end_time,
            description,
            cover_image_url,
            price,
            rating_avg,
            rating_count,
            location_id,
            location_name,
            location_address,
            location_latitude,
            location_longitude,
            location_features,
            location_cover_image_url,
            location_rating_avg,
            location_rating_count,
        ) = row

        location = None
        if location_id:
            location = {
                "id": str(location_id),
                "name": location_name,
                "address": location_address,
                "latitude": float(location_latitude) if location_latitude is not None else None,
                "longitude": float(location_longitude) if location_longitude is not None else None,
                "features": location_features,
                "cover_image_url": location_cover_image_url,
                "rating_avg": float(location_rating_avg) if location_rating_avg is not None else None,
                "rating_count": location_rating_count,
            }

        cursor.execute(
            """
            SELECT t.name
            FROM event_tags et
            JOIN tags t ON t.id = et.tag_id
            WHERE et.event_id = %s
            ORDER BY t.name ASC
            """,
            (event_id,),
        )
        tags = [r[0] for r in cursor.fetchall()]

        cursor.execute(
            """
            SELECT a.id, a.name, a.bio, a.image_url, a.social_links
            FROM event_artists ea
            JOIN artists a ON a.id = ea.artist_id
            WHERE ea.event_id = %s
            ORDER BY a.name ASC
            """,
            (event_id,),
        )
        artists = []
        for a in cursor.fetchall():
            artists.append(
                {
                    "id": str(a[0]),
                    "name": a[1],
                    "bio": a[2],
                    "image_url": a[3],
                    "social_links": a[4],
                }
            )

        cursor.execute(
            """
            SELECT photo_url
            FROM event_photos
            WHERE event_id = %s
            ORDER BY id ASC
            """,
            (event_id,),
        )
        photos = [p[0] for p in cursor.fetchall()]

        cursor.execute(
            """
            SELECT COUNT(*) AS review_count,
                   COALESCE(AVG(rating), 0) AS rating_avg
            FROM reviews
            WHERE event_id = %s
            """,
            (event_id,),
        )
        review_row = cursor.fetchone()
        review_summary = {
            "count": review_row[0] if review_row else 0,
            "rating_avg": float(review_row[1]) if review_row and review_row[1] is not None else 0,
        }

        cursor.execute(
            """
            SELECT rating, comment, photos, created_at
            FROM reviews
            WHERE event_id = %s
            ORDER BY created_at DESC
            LIMIT 3
            """,
            (event_id,),
        )
        reviews = []
        for r in cursor.fetchall():
            reviews.append(
                {
                    "rating": r[0],
                    "comment": r[1],
                    "photos": r[2],
                    "created_at": r[3].isoformat() if r[3] else None,
                }
            )

        event_payload = {
            "id": str(event_id),
            "title": title,
            "category": category,
            "start_time": start_time.isoformat() if start_time else None,
            "end_time": end_time.isoformat() if end_time else None,
            "description": description,
            "cover_image_url": cover_image_url,
            "price": float(price) if isinstance(price, Decimal) or isinstance(price, (int, float)) else None,
            "rating_avg": float(rating_avg) if rating_avg is not None else None,
            "rating_count": rating_count,
            "tags": tags,
            "location": location,
            "artists": artists,
            "photos": photos,
            "reviews": {
                "summary": review_summary,
                "latest": reviews,
            },
        }

        return jsonify({"event": event_payload})
    except Exception:
        logger.exception("Failed to fetch event detail")
        return jsonify({"error": "Unable to fetch event detail"}), 500
    finally:
        if cursor:
            cursor.close()
        if connection:
            release_db_connection(connection)

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
