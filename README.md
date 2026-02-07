# Innovative Events Mobile App

## Summary
An Expo/React Native app for discovering events with rich filters, a drop-pin map experience, and social features like saving and reviews.

## Current features
- Discover events with search, filters (date/time, category, tags, rating), and sorting (soonest, top rated, price, distance).
- Drop a pin on the map to use it as the distance reference; apply radius filters and distance sorting.
- Map preview + full-screen map with draggable pin and event callouts.
- Event details with tickets, directions, sharing, saving, and reviews.
- Saved events list with remove actions.
- Pull-to-refresh and skeleton loading states on key screens.

## Client setup
- Create `client/.env` with:
  - `EXPO_PUBLIC_API_URL=http://<your-ip>:5000`
- Create an account in the app to save events and submit reviews.
- Auth tokens are stored securely via `expo-secure-store`.
- Install and run:
  - `cd client && npm install`
  - `cd client && npx expo start`

## Overview of Images

<img width="483" height="792" alt="wireframe_map_discover" src="https://github.com/user-attachments/assets/931ab116-0d28-41eb-95a7-05ea9a00108d" />

**Map / Discover (`wireframe_map_discover.png`)**  
This mock-up depicts the home screen where users explore events on a map. A header at the top includes the app title, search bar, and current location indicator. Below the header is a collapsible filter panel with controls for selecting date, hour range, ratings, and tag filters. The main portion of the screen is a map that displays pins or clusters for events active at the chosen time. Floating action buttons allow users to recenter the map, jump to the current time, clear filters, or switch to the list view.

---

<img width="448" height="792" alt="wireframe_events_list" src="https://github.com/user-attachments/assets/3f003ae1-81f0-4680-bdf8-5c65bec1c182" />

**Events List (`wireframe_events_list.png`)**  
This screen provides an alternative view of the same filtered events, presented as a scrollable list. A sticky section at the top summarises the active filters and offers sorting options (e.g., soonest, nearest, top rated). Each card in the list shows basic details such as title, time window, distance from the user, mini ratings for the host/location, and a price badge.

---

<img width="448" height="792" alt="wireframe_event_details" src="https://github.com/user-attachments/assets/3144bfb5-7def-4451-affd-29e21cb1500c" />

**Event Details (`wireframe_event_details.png`)**  
When a user taps an event pin or card, they are taken to this detailed screen. The upper section includes a hero image or map snippet with the event’s marker. Subsequent sections display the event name, category, date and duration, artists and hosts (with avatars and ratings), location details (address, map link, rating), and a description including amenities and any age or accessibility notes. A prominent “Buy Tickets” button leads to the external ticketing page, while secondary actions let users save, share, or report the event.

---

<img width="448" height="792" alt="wireframe_host_profile" src="https://github.com/user-attachments/assets/ccb31787-dd8b-46c8-a0b7-5d5e2efb1fb5" />

**Host Profile (`wireframe_host_profile.png`)**  
The host profile screen shows a banner and avatar at the top, followed by the host’s name, aggregated rating, and rating count. Below this are sections for the host’s bio, links (such as website or social media), a list of upcoming events organised by that host, and a list of reviews with star ratings and text. Users can scroll through this information to learn more about the host and their reputation.

---

<img width="448" height="792" alt="wireframe_location_profile" src="https://github.com/user-attachments/assets/3650378c-b301-4a2c-80ce-b351fb157804" />

**Location Profile (`wireframe_location_profile.png`)**  
Similar to the host profile, the location profile features a cover photo or map snippet that can be tapped to open directions. The venue’s name and average rating are shown, along with its address, amenities, and accessibility information. A list of upcoming events at this location is included, followed by user reviews.

---

<img width="448" height="792" alt="wireframe_review_composer" src="https://github.com/user-attachments/assets/3706fabc-09e8-432c-84a0-19890c8c2165" />

**Review Composer (`wireframe_review_composer.png`)**  
This wireframe outlines the page where users submit reviews for hosts or locations. It includes fields for a star rating (1–5), a text area for written feedback, and an optional photo upload section. A submit button finalises the review. The layout ensures sufficient spacing and large tap targets for accessibility.

---

<img width="448" height="792" alt="wireframe_saved_account" src="https://github.com/user-attachments/assets/3706fabc-09e8-432c-84a0-19890c8c2165" />

**Saved / Account (`wireframe_saved_account.png`)**  
The account screen shows basic profile information and lists events the user has saved. It also contains account actions such as sign out and settings management. This screen lays the groundwork for a future user profile and permissions management flow.

## Backend setup (current)
- Set DB env vars in `server/.env`: `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_NAME`.
- Set `JWT_SECRET` (required for login). Optional: `ACCESS_TOKEN_TTL_MIN`, `REFRESH_TOKEN_TTL_DAYS`.
- Create tables in your Postgres DB: `psql \"$DB_NAME\" -f server/schema.sql` (ensure the role has privileges to create the `pgcrypto` extension).
- Run the Flask API: `cd server && python main.py`. Health check: `GET /health`. Events endpoint (DB-backed): `GET /api/events`.
- Seed sample data: `cd server && python seed_db.py` (uses the same `.env` DB credentials). Seeds locations, events, tags, and event_tags.

## Manual testing
- Automated API tests were removed for this project iteration.
- Manual QA checklists live in `docs/`.
- Current auth checklist: `docs/qa-auth-checklist.md`.
- For each new feature, duplicate and fill: `docs/qa-feature-checklist-template.md`.


## Architecture
- Client: Expo/React Native (Expo Router, react-native-maps, @react-native-community/datetimepicker).
- Server: Flask + Postgres (Supabase) with psycopg2 connection pool.
- API endpoints:
  - `GET /health` — JSON status/db state.
  - `GET /api/test-db` — DB connectivity test; returns server time.
  - `POST /api/auth/register` — create account; returns tokens + user.
  - `POST /api/auth/login` — sign in; returns tokens + user.
  - `POST /api/auth/refresh` — refresh session; returns new tokens.
  - `POST /api/auth/logout` — revoke refresh token.
  - `GET /api/me` — current user profile (requires auth).
  - `PATCH /api/me` — update profile (requires auth).
  - `GET /api/filters` — list filter options (tags, categories, cities).
  - `GET /api/events` — list events with filters: tag, category, city, date (YYYY-MM-DD), time (HH:MM contained in start/end window), min_rating, q, lat/lng, radius_km, sort (soonest/toprated/price/distance). Returns location summary, tags, rating/price, lat/lng, distance_km for pins.
  - `GET /api/events/:id` — event detail with location, tags, artists, photos, reviews summary/latest, rating/price/time window, ticket_url.
  - `POST /api/events/:id/reviews` — create a review (rating/comment/photos); updates aggregate rating (requires auth).
  - `GET /api/saved` — list saved events for the current user (requires auth).
  - `POST /api/saved` — save an event for the current user (requires auth).
  - `GET /api/saved/:id` — check if an event is saved (requires auth).
  - `DELETE /api/saved/:id` — remove a saved event (requires auth).

## DB schema
- Core tables: `users`, `refresh_tokens`, `events` (title, category, start/end, description, cover_image_url, ticket_url, price, rating avg/count, location_id), `locations` (name, address, lat/lng, features, cover image, rating avg/count).
- Relationships: `event_tags`, `tags`; `event_artists`, `artists`; `event_photos`; `reviews`; `saved_events`.
- Seed data includes Vienna venues/events, artists, tags, reviews, photos, saved events.

## Screens
- Discover/Explore: city typeahead; expandable filters (date/time pickers, tags, category, min rating, sort); search with debounce; reset/clear filters; map preview + full map with pins; long-press to drop pin; distance radius chips; in-view list overlay; pull-to-refresh; skeletons.
- Event detail: hero with overlay, tags, ticket/share/directions CTAs, save action, location/price/rating info card, about, artists, photos, reviews, review composer, skeletons.
- Saved: list of saved events with remove action, pull-to-refresh, empty state CTA.
