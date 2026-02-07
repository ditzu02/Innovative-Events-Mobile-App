from datetime import datetime, time, timedelta, timezone
import hashlib
import logging
import os
from pathlib import Path
from decimal import Decimal
import math
import secrets
import uuid

import psycopg2
from psycopg2 import OperationalError, InterfaceError, IntegrityError
from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv
from psycopg2.pool import SimpleConnectionPool, PoolError
import jwt
from passlib.context import CryptContext

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
DB_SSLMODE = os.getenv("DB_SSLMODE", "require")

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

JWT_SECRET = os.getenv("JWT_SECRET")
ACCESS_TOKEN_TTL_MIN = int(os.getenv("ACCESS_TOKEN_TTL_MIN", "15"))
REFRESH_TOKEN_TTL_DAYS = int(os.getenv("REFRESH_TOKEN_TTL_DAYS", "30"))

if not JWT_SECRET:
    logger.warning("JWT_SECRET is not set. Auth endpoints will not work until it is configured.")

pwd_context = CryptContext(
    schemes=["pbkdf2_sha256", "bcrypt"],
    default="pbkdf2_sha256",
    deprecated="auto",
)

db_pool: SimpleConnectionPool | None = None


def init_db_pool(force: bool = False) -> None:
    """Initialize a global connection pool."""
    global db_pool
    if db_pool and not force:
        return
    if db_pool and force:
        try:
            db_pool.closeall()
        except Exception:
            logger.exception("Error closing existing connection pool")
        db_pool = None
    try:
        db_pool = SimpleConnectionPool(
            minconn=1,
            maxconn=3,
            user=DB_USER,
            password=DB_PASSWORD,
            host=DB_HOST,
            port=DB_PORT,
            dbname=DB_NAME,
            sslmode=DB_SSLMODE,
            connect_timeout=5,
        )
        logger.info("Database connection pool initialized")
    except Exception:
        logger.exception("Unable to initialize database connection pool")
        raise


def get_db_connection():
    """Get a connection from the pool."""
    if not db_pool:
        init_db_pool()
    try:
        return db_pool.getconn()
    except PoolError:
        logger.warning("Pool exhausted; resetting pool")
        reset_db_pool()
        return db_pool.getconn()


def release_db_connection(connection) -> None:
    """Return a connection to the pool."""
    if db_pool and connection:
        try:
            db_pool.putconn(connection)
        except PoolError:
            logger.warning("Attempted to return a connection not tracked by the pool; closing it instead")
            try:
                connection.close()
            except Exception:
                logger.exception("Failed to close stray connection")


def reset_db_pool():
    """Force-close and recreate the connection pool."""
    init_db_pool(force=True)


def execute_with_retry(query: str, params: tuple = ()) -> tuple:
    """
    Execute a query with a retry if the connection drops.
    Returns (connection, cursor) so the caller can fetch and release.
    """
    connection = get_db_connection()
    cursor = connection.cursor()
    try:
        cursor.execute(query, params)
        return connection, cursor
    except (psycopg2.OperationalError, PoolError):
        logger.exception("DB connection lost, retrying once with fresh pool")
        try:
            cursor.close()
        except Exception:
            pass
        release_db_connection(connection)
        reset_db_pool()
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute(query, params)
        return connection, cursor
    except Exception:
        # Ensure we don't leak resources on unexpected errors
        try:
            cursor.close()
        except Exception:
            pass
        release_db_connection(connection)
        raise


def require_jwt_secret() -> None:
    if not JWT_SECRET:
        raise RuntimeError("JWT_SECRET is not set")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return pwd_context.verify(password, password_hash)
    except Exception:
        logger.exception("Password verification failed")
        return False


def create_access_token(user_id: str) -> str:
    require_jwt_secret()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=ACCESS_TOKEN_TTL_MIN)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def decode_access_token(token: str) -> dict:
    require_jwt_secret()
    payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    if payload.get("type") != "access":
        raise jwt.InvalidTokenError("Invalid token type")
    return payload


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_refresh_token(user_id: str, cursor) -> str:
    raw_token = secrets.token_urlsafe(48)
    token_hash = hash_refresh_token(raw_token)
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=REFRESH_TOKEN_TTL_DAYS)
    cursor.execute(
        """
        INSERT INTO refresh_tokens (user_id, token_hash, created_at, expires_at)
        VALUES (%s, %s, %s, %s)
        """,
        (user_id, token_hash, now, expires_at),
    )
    return raw_token


def get_auth_user_id():
    auth_header = request.headers.get("Authorization", "")
    if not auth_header:
        return None, (jsonify({"error": "Missing authorization"}), 401)
    parts = auth_header.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None, (jsonify({"error": "Invalid authorization header"}), 401)
    token = parts[1].strip()
    if not token:
        return None, (jsonify({"error": "Invalid authorization header"}), 401)
    try:
        payload = decode_access_token(token)
    except RuntimeError as exc:
        return None, (jsonify({"error": str(exc)}), 500)
    except jwt.ExpiredSignatureError:
        return None, (jsonify({"error": "Token expired"}), 401)
    except jwt.InvalidTokenError:
        return None, (jsonify({"error": "Invalid token"}), 401)
    user_id = payload.get("sub")
    if not user_id:
        return None, (jsonify({"error": "Invalid token"}), 401)
    try:
        uuid.UUID(user_id)
    except ValueError:
        return None, (jsonify({"error": "Invalid token"}), 401)
    return user_id, None


def extract_city(address: str | None) -> str | None:
    if not address:
        return None
    parts = [part.strip() for part in address.split(",") if part.strip()]
    if not parts:
        return None
    if len(parts) >= 2:
        return parts[-2]
    return parts[0]


def user_row_to_dict(row) -> dict:
    if not row:
        return {}
    user_id, email, display_name, avatar_url, created_at = row
    return {
        "id": str(user_id),
        "email": email,
        "display_name": display_name,
        "avatar_url": avatar_url,
        "created_at": created_at.isoformat() if created_at else None,
    }


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r_lat1 = math.radians(lat1)
    r_lon1 = math.radians(lon1)
    r_lat2 = math.radians(lat2)
    r_lon2 = math.radians(lon2)
    d_lat = r_lat2 - r_lat1
    d_lon = r_lon2 - r_lon1
    a = math.sin(d_lat / 2) ** 2 + math.cos(r_lat1) * math.cos(r_lat2) * math.sin(d_lon / 2) ** 2
    c = 2 * math.asin(math.sqrt(a))
    return 6371 * c


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

@app.route("/api/auth/register", methods=["POST"])
def register():
    payload = request.get_json(silent=True) or {}
    email = str(payload.get("email") or "").strip().lower()
    password = str(payload.get("password") or "")
    display_name = payload.get("display_name")
    if not email or "@" not in email:
        return jsonify({"error": "Valid email is required"}), 400
    if not password or len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400
    display_name = str(display_name).strip() if display_name is not None else None
    if display_name == "":
        display_name = None

    connection = None
    cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        password_hash = hash_password(password)
        cursor.execute(
            """
            INSERT INTO users (email, password_hash, display_name)
            VALUES (%s, %s, %s)
            RETURNING id, email, display_name, avatar_url, created_at
            """,
            (email, password_hash, display_name),
        )
        user_row = cursor.fetchone()
        refresh_token = create_refresh_token(str(user_row[0]), cursor)
        access_token = create_access_token(str(user_row[0]))
        connection.commit()
        return jsonify(
            {
                "access_token": access_token,
                "refresh_token": refresh_token,
                "user": user_row_to_dict(user_row),
            }
        )
    except IntegrityError:
        if connection:
            connection.rollback()
        return jsonify({"error": "Email already in use"}), 409
    except RuntimeError as exc:
        if connection:
            connection.rollback()
        return jsonify({"error": str(exc)}), 500
    except Exception:
        if connection:
            connection.rollback()
        logger.exception("Registration failed")
        return jsonify({"error": "Unable to register"}), 500
    finally:
        if cursor:
            cursor.close()
        if connection:
            release_db_connection(connection)


@app.route("/api/auth/login", methods=["POST"])
def login():
    payload = request.get_json(silent=True) or {}
    email = str(payload.get("email") or "").strip().lower()
    password = str(payload.get("password") or "")
    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    connection = None
    cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute(
            """
            SELECT id, email, password_hash, display_name, avatar_url, created_at
            FROM users
            WHERE email = %s
            """,
            (email,),
        )
        row = cursor.fetchone()
        if not row or not verify_password(password, row[2]):
            return jsonify({"error": "Invalid email or password"}), 401
        user_row = (row[0], row[1], row[3], row[4], row[5])
        refresh_token = create_refresh_token(str(row[0]), cursor)
        access_token = create_access_token(str(row[0]))
        connection.commit()
        return jsonify(
            {
                "access_token": access_token,
                "refresh_token": refresh_token,
                "user": user_row_to_dict(user_row),
            }
        )
    except RuntimeError as exc:
        if connection:
            connection.rollback()
        return jsonify({"error": str(exc)}), 500
    except Exception:
        if connection:
            connection.rollback()
        logger.exception("Login failed")
        return jsonify({"error": "Unable to login"}), 500
    finally:
        if cursor:
            cursor.close()
        if connection:
            release_db_connection(connection)


@app.route("/api/auth/refresh", methods=["POST"])
def refresh():
    payload = request.get_json(silent=True) or {}
    refresh_token = str(payload.get("refresh_token") or "").strip()
    if not refresh_token:
        return jsonify({"error": "refresh_token is required"}), 400

    connection = None
    cursor = None
    now = datetime.now(timezone.utc)
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        token_hash = hash_refresh_token(refresh_token)
        cursor.execute(
            """
            SELECT id, user_id, expires_at, revoked_at
            FROM refresh_tokens
            WHERE token_hash = %s
            """,
            (token_hash,),
        )
        row = cursor.fetchone()
        if not row:
            return jsonify({"error": "Invalid refresh token"}), 401
        token_id, user_id, expires_at, revoked_at = row
        if revoked_at is not None or (expires_at and expires_at < now):
            return jsonify({"error": "Refresh token expired"}), 401
        cursor.execute(
            """
            UPDATE refresh_tokens
            SET revoked_at = %s, last_used_at = %s
            WHERE id = %s
            """,
            (now, now, token_id),
        )
        new_refresh_token = create_refresh_token(str(user_id), cursor)
        access_token = create_access_token(str(user_id))
        connection.commit()
        return jsonify({"access_token": access_token, "refresh_token": new_refresh_token})
    except RuntimeError as exc:
        if connection:
            connection.rollback()
        return jsonify({"error": str(exc)}), 500
    except Exception:
        if connection:
            connection.rollback()
        logger.exception("Token refresh failed")
        return jsonify({"error": "Unable to refresh session"}), 500
    finally:
        if cursor:
            cursor.close()
        if connection:
            release_db_connection(connection)


@app.route("/api/auth/logout", methods=["POST"])
def logout():
    payload = request.get_json(silent=True) or {}
    refresh_token = str(payload.get("refresh_token") or "").strip()
    if not refresh_token:
        return jsonify({"error": "refresh_token is required"}), 400

    connection = None
    cursor = None
    now = datetime.now(timezone.utc)
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        token_hash = hash_refresh_token(refresh_token)
        cursor.execute(
            """
            UPDATE refresh_tokens
            SET revoked_at = %s, last_used_at = %s
            WHERE token_hash = %s AND revoked_at IS NULL
            """,
            (now, now, token_hash),
        )
        connection.commit()
        return jsonify({"ok": True})
    except Exception:
        if connection:
            connection.rollback()
        logger.exception("Logout failed")
        return jsonify({"error": "Unable to logout"}), 500
    finally:
        if cursor:
            cursor.close()
        if connection:
            release_db_connection(connection)


@app.route("/api/me", methods=["GET", "PATCH"])
def me():
    user_id, error_response = get_auth_user_id()
    if error_response:
        return error_response

    connection = None
    cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute(
            """
            SELECT id, email, display_name, avatar_url, created_at, password_hash
            FROM users
            WHERE id = %s
            """,
            (user_id,),
        )
        row = cursor.fetchone()
        if not row:
            return jsonify({"error": "User not found"}), 404

        if request.method == "GET":
            user_row = (row[0], row[1], row[2], row[3], row[4])
            return jsonify({"user": user_row_to_dict(user_row)})

        payload = request.get_json(silent=True) or {}
        display_name = payload.get("display_name")
        avatar_url = payload.get("avatar_url")
        password_current = payload.get("password_current")
        password_new = payload.get("password_new")

        updates = []
        params = []

        if display_name is not None:
            display_name = str(display_name).strip()
            updates.append("display_name = %s")
            params.append(display_name or None)
        if avatar_url is not None:
            avatar_url = str(avatar_url).strip()
            updates.append("avatar_url = %s")
            params.append(avatar_url or None)

        if password_new:
            if not password_current:
                return jsonify({"error": "password_current is required"}), 400
            if not verify_password(str(password_current), row[5]):
                return jsonify({"error": "Current password is incorrect"}), 400
            if len(str(password_new)) < 6:
                return jsonify({"error": "password_new must be at least 6 characters"}), 400
            new_hash = hash_password(str(password_new))
            updates.append("password_hash = %s")
            params.append(new_hash)

        if not updates:
            return jsonify({"error": "No updates provided"}), 400

        updates.append("updated_at = NOW()")
        query = f"UPDATE users SET {', '.join(updates)} WHERE id = %s RETURNING id, email, display_name, avatar_url, created_at"
        params.append(user_id)
        cursor.execute(query, params)
        updated_row = cursor.fetchone()
        connection.commit()
        return jsonify({"user": user_row_to_dict(updated_row)})
    except Exception:
        if connection:
            connection.rollback()
        logger.exception("User profile update failed")
        return jsonify({"error": "Unable to update profile"}), 500
    finally:
        if cursor:
            cursor.close()
        if connection:
            release_db_connection(connection)


@app.route("/api/filters")
def list_filters():
    connection = None
    cursor = None
    try:
        connection = get_db_connection()
        cursor = connection.cursor()

        cursor.execute(
            """
            SELECT DISTINCT category
            FROM events
            WHERE category IS NOT NULL
            ORDER BY category ASC
            """
        )
        categories = [row[0] for row in cursor.fetchall()]

        cursor.execute("SELECT name FROM tags ORDER BY name ASC")
        tags = [row[0] for row in cursor.fetchall()]

        cursor.execute(
            """
            SELECT address, latitude, longitude
            FROM locations
            WHERE address IS NOT NULL
            """
        )
        city_stats: dict[str, dict[str, float]] = {}
        for address, latitude, longitude in cursor.fetchall():
            city = extract_city(address)
            if not city:
                continue
            if latitude is None or longitude is None:
                continue
            if city not in city_stats:
                city_stats[city] = {"sum_lat": 0.0, "sum_lng": 0.0, "count": 0.0}
            city_stats[city]["sum_lat"] += float(latitude)
            city_stats[city]["sum_lng"] += float(longitude)
            city_stats[city]["count"] += 1.0

        cities = []
        for name, stats in city_stats.items():
            if stats["count"] <= 0:
                continue
            cities.append(
                {
                    "name": name,
                    "latitude": stats["sum_lat"] / stats["count"],
                    "longitude": stats["sum_lng"] / stats["count"],
                }
            )
        cities.sort(key=lambda item: item["name"].lower())

        return jsonify({"tags": tags, "categories": categories, "cities": cities})
    except Exception:
        logger.exception("Failed to fetch filters")
        return jsonify({"error": "Unable to fetch filters"}), 500
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
                e.ticket_url,
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
        lat_val = None
        lng_val = None
        radius_km = None

        lat_param = request.args.get("lat")
        lng_param = request.args.get("lng")
        if lat_param or lng_param:
            if not lat_param or not lng_param:
                return jsonify({"error": "lat and lng are required together"}), 400
            try:
                lat_val = float(lat_param)
                lng_val = float(lng_param)
            except ValueError:
                return jsonify({"error": "lat and lng must be numbers"}), 400

        radius_param = request.args.get("radius_km")
        if radius_param:
            if lat_val is None or lng_val is None:
                return jsonify({"error": "radius_km requires lat and lng"}), 400
            try:
                radius_km = float(radius_param)
            except ValueError:
                return jsonify({"error": "radius_km must be a number"}), 400
            if radius_km <= 0:
                return jsonify({"error": "radius_km must be greater than 0"}), 400

        category = request.args.get("category")
        if category:
            filters.append("e.category ILIKE %s")
            params.append(f"%{category}%")

        tag = request.args.get("tag")
        if tag:
            filters.append("%s = ANY(COALESCE(ta.tags, '{}'))")
            params.append(tag)

        city = request.args.get("city")
        if city:
            filters.append("COALESCE(l.address, '') ILIKE %s")
            params.append(f"%{city}%")

        search_query = request.args.get("q")
        if search_query:
            term = f"%{search_query}%"
            filters.append(
                "("
                "e.title ILIKE %s OR "
                "e.description ILIKE %s OR "
                "e.category ILIKE %s OR "
                "COALESCE(l.name, '') ILIKE %s OR "
                "COALESCE(l.address, '') ILIKE %s OR "
                "array_to_string(COALESCE(ta.tags, '{}'), ' ') ILIKE %s"
                ")"
            )
            params.extend([term, term, term, term, term, term])

        date_str = request.args.get("date")
        if date_str:
            try:
                parsed = datetime.fromisoformat(date_str).date()
                filters.append("DATE(e.start_time) = %s")
                params.append(parsed)
            except ValueError:
                return jsonify({"error": "Invalid date format. Use YYYY-MM-DD."}), 400

        target_time_param = request.args.get("time")
        if target_time_param:
            try:
                target_t = datetime.strptime(target_time_param, "%H:%M").time()
                filters.append("CAST(e.start_time AS time) <= %s AND CAST(e.end_time AS time) >= %s")
                params.extend([target_t, target_t])
            except ValueError:
                return jsonify({"error": "Invalid time. Use HH:MM (24h)."}), 400

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
        sort_distance = sort in ("distance", "nearest")
        if sort_distance:
            query += " ORDER BY e.start_time ASC"
        elif sort == "toprated":
            query += " ORDER BY COALESCE(ra.review_avg, e.rating_avg) DESC NULLS LAST, e.start_time ASC"
        elif sort == "price":
            query += " ORDER BY e.price ASC NULLS LAST, e.start_time ASC"
        else:
            query += " ORDER BY e.start_time ASC"

        try:
            connection = get_db_connection()
            cursor = connection.cursor()
            cursor.execute(query, tuple(params))
            rows = cursor.fetchall()
        except (OperationalError, InterfaceError, PoolError):
            logger.exception("DB error while fetching events, retrying once with fresh pool")
            if cursor:
                try:
                    cursor.close()
                except Exception:
                    pass
            if connection:
                release_db_connection(connection)
            reset_db_pool()
            connection = get_db_connection()
            cursor = connection.cursor()
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
                ticket_url,
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

            distance_km = None
            if lat_val is not None and lng_val is not None:
                if location_latitude is not None and location_longitude is not None:
                    distance_km = haversine_km(
                        lat_val,
                        lng_val,
                        float(location_latitude),
                        float(location_longitude),
                    )

            events.append(
                {
                    "id": str(event_id),
                    "title": title,
                    "category": category,
                    "start_time": start_time.isoformat() if start_time else None,
                    "end_time": end_time.isoformat() if end_time else None,
                    "description": description,
                    "cover_image_url": cover_image_url,
                    "ticket_url": ticket_url,
                    "price": float(price) if isinstance(price, Decimal) or isinstance(price, (int, float)) else None,
                    "rating_avg": float(review_avg) if review_avg is not None else float(rating_avg) if rating_avg is not None else None,
                    "rating_count": review_count if review_count is not None else rating_count,
                    "tags": tags or [],
                    "location": location,
                    "latitude": float(location_latitude) if location_latitude is not None else None,
                    "longitude": float(location_longitude) if location_longitude is not None else None,
                    "distance_km": distance_km,
                }
            )

        if radius_km is not None:
            events = [
                event
                for event in events
                if event["distance_km"] is not None and event["distance_km"] <= radius_km
            ]

        if sort_distance and lat_val is not None and lng_val is not None:
            events.sort(
                key=lambda item: item["distance_km"] if item["distance_km"] is not None else float("inf")
            )

        return jsonify({"events": events})
    except PoolError:
        logger.exception("Connection pool unavailable while fetching events")
        return jsonify({"error": "Database unavailable, please retry"}), 503
    except Exception:
        logger.exception("Failed to fetch events")
        return jsonify({"error": "Unable to fetch events"}), 500
    finally:
        if cursor:
            try:
                cursor.close()
            except Exception:
                logger.exception("Failed to close cursor")
        if connection:
            release_db_connection(connection)


@app.route("/api/saved", methods=["GET", "POST"])
def saved_events():
    connection = None
    cursor = None
    user_id, error_response = get_auth_user_id()
    if error_response:
        return error_response
    try:
        if request.method == "POST":
            payload = request.get_json(silent=True) or {}
            event_id = payload.get("event_id")
            if not event_id:
                return jsonify({"error": "event_id is required"}), 400
            connection = get_db_connection()
            cursor = connection.cursor()
            cursor.execute(
                """
                INSERT INTO saved_events (user_id, event_id)
                VALUES (%s, %s)
                ON CONFLICT (user_id, event_id) DO NOTHING
                """,
                (user_id, event_id),
            )
            connection.commit()
            return jsonify({"saved": True})

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
                e.ticket_url,
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
            FROM saved_events se
            JOIN events e ON e.id = se.event_id
            LEFT JOIN locations l ON e.location_id = l.id
            LEFT JOIN tag_agg ta ON ta.event_id = e.id
            LEFT JOIN review_agg ra ON ra.event_id = e.id
            WHERE se.user_id = %s
            ORDER BY se.created_at DESC
        """
        cursor.execute(query, (user_id,))
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
                ticket_url,
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
                    "ticket_url": ticket_url,
                    "price": float(price) if isinstance(price, Decimal) or isinstance(price, (int, float)) else None,
                    "rating_avg": float(review_avg) if review_avg is not None else float(rating_avg) if rating_avg is not None else None,
                    "rating_count": review_count if review_count is not None else rating_count,
                    "tags": tags or [],
                    "location": location,
                    "latitude": float(location_latitude) if location_latitude is not None else None,
                    "longitude": float(location_longitude) if location_longitude is not None else None,
                }
            )

        return jsonify({"events": events})
    except Exception:
        logger.exception("Saved events request failed")
        return jsonify({"error": "Unable to handle saved events"}), 500
    finally:
        if cursor:
            try:
                cursor.close()
            except Exception:
                logger.exception("Failed to close cursor")
        if connection:
            release_db_connection(connection)


@app.route("/api/saved/<event_id>", methods=["GET", "DELETE"])
def saved_event(event_id: str):
    connection = None
    cursor = None
    user_id, error_response = get_auth_user_id()
    if error_response:
        return error_response
    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        if request.method == "GET":
            cursor.execute(
                "SELECT 1 FROM saved_events WHERE user_id = %s AND event_id = %s",
                (user_id, event_id),
            )
            saved = cursor.fetchone() is not None
            return jsonify({"saved": saved})

        cursor.execute(
            "DELETE FROM saved_events WHERE user_id = %s AND event_id = %s",
            (user_id, event_id),
        )
        connection.commit()
        return jsonify({"saved": False})
    except Exception:
        logger.exception("Saved event toggle failed")
        return jsonify({"error": "Unable to update saved event"}), 500
    finally:
        if cursor:
            cursor.close()
        if connection:
            release_db_connection(connection)


@app.route("/api/events/<event_id>/reviews", methods=["POST"])
def create_review(event_id: str):
    connection = None
    cursor = None
    user_id, error_response = get_auth_user_id()
    if error_response:
        return error_response
    try:
        uuid.UUID(user_id)
    except ValueError:
        return jsonify({"error": "Invalid user id"}), 400

    payload = request.get_json(silent=True) or {}
    rating = payload.get("rating")
    if rating is None:
        return jsonify({"error": "rating is required"}), 400
    try:
        rating_val = int(rating)
    except (TypeError, ValueError):
        return jsonify({"error": "rating must be an integer"}), 400
    if rating_val < 1 or rating_val > 5:
        return jsonify({"error": "rating must be between 1 and 5"}), 400

    comment = payload.get("comment")
    if comment is not None:
        comment = str(comment).strip()
        if not comment:
            comment = None

    photos = payload.get("photos")
    if photos is not None:
        if not isinstance(photos, list):
            return jsonify({"error": "photos must be a list"}), 400
        cleaned = []
        for photo in photos:
            if photo is None:
                continue
            item = str(photo).strip()
            if item:
                cleaned.append(item)
        photos = cleaned or None

    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute("SELECT 1 FROM events WHERE id = %s", (event_id,))
        if not cursor.fetchone():
            return jsonify({"error": "Event not found"}), 404

        cursor.execute(
            """
            INSERT INTO reviews (event_id, user_id, rating, comment, photos)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, created_at
            """,
            (event_id, user_id, rating_val, comment, photos),
        )
        review_row = cursor.fetchone()

        cursor.execute(
            """
            SELECT COUNT(*) AS review_count,
                   COALESCE(AVG(rating), 0) AS rating_avg
            FROM reviews
            WHERE event_id = %s
            """,
            (event_id,),
        )
        summary_row = cursor.fetchone()
        review_count = summary_row[0] if summary_row else 0
        rating_avg = float(summary_row[1]) if summary_row and summary_row[1] is not None else 0.0

        cursor.execute(
            """
            UPDATE events
            SET rating_avg = %s,
                rating_count = %s
            WHERE id = %s
            """,
            (rating_avg, review_count, event_id),
        )

        connection.commit()

        return jsonify(
            {
                "review": {
                    "id": str(review_row[0]) if review_row else None,
                    "rating": rating_val,
                    "comment": comment,
                    "photos": photos,
                    "created_at": review_row[1].isoformat() if review_row else None,
                },
                "summary": {"count": review_count, "rating_avg": rating_avg},
            }
        )
    except Exception:
        logger.exception("Failed to create review")
        return jsonify({"error": "Unable to create review"}), 500
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
                e.ticket_url,
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
            ticket_url,
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
            "ticket_url": ticket_url,
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
