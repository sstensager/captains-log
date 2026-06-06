"""
Places enrichment — resolves Place entities against the Google Places API.
"""
import logging
import os
import sqlite3
from dataclasses import dataclass
from typing import Protocol

import requests

log = logging.getLogger(__name__)

_TEXTSEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json"

# Map Google place types → human-readable venue type
_TYPE_MAP = {
    "restaurant": "restaurant",
    "bar": "bar",
    "cafe": "cafe",
    "bakery": "bakery",
    "grocery_or_supermarket": "grocery",
    "supermarket": "grocery",
    "lodging": "hotel",
    "hotel": "hotel",
    "campground": "campground",
    "park": "park",
    "gym": "gym",
    "movie_theater": "movie theater",
    "museum": "museum",
    "amusement_park": "amusement park",
    "spa": "spa",
    "beauty_salon": "salon",
    "hospital": "hospital",
    "pharmacy": "pharmacy",
    "gas_station": "gas station",
    "airport": "airport",
    "train_station": "train station",
    "shopping_mall": "shopping mall",
    "store": "store",
    "clothing_store": "clothing store",
    "book_store": "book store",
    "school": "school",
    "university": "university",
    "place_of_worship": "place of worship",
    "library": "library",
}


@dataclass
class PlaceResult:
    name: str
    place_id: str
    formatted_address: str
    city: str | None
    venue_type: str | None
    price_level: int | None
    confidence: float  # 0–1


class PlacesClient(Protocol):
    def search(self, query: str, lat: float | None, lng: float | None) -> PlaceResult | None: ...


class GooglePlacesClient:
    def __init__(self, api_key: str):
        self._key = api_key

    def search(self, query: str, lat: float | None = None, lng: float | None = None) -> PlaceResult | None:
        params: dict = {"query": query, "key": self._key}
        if lat is not None and lng is not None:
            params["location"] = f"{lat},{lng}"
            params["radius"] = 5000

        try:
            r = requests.get(_TEXTSEARCH_URL, params=params, timeout=5)
            data = r.json()
        except Exception as exc:
            log.warning("Places API request failed: %s", exc)
            return None

        if data.get("status") != "OK" or not data.get("results"):
            log.info("Places API returned status=%s for query=%r", data.get("status"), query)
            return None

        results = data["results"]
        top = results[0]

        return PlaceResult(
            name=top["name"],
            place_id=top["place_id"],
            formatted_address=top.get("formatted_address", ""),
            city=_extract_city(top.get("formatted_address", "")),
            venue_type=_normalize_venue_type(top.get("types", [])),
            price_level=top.get("price_level"),
            confidence=_compute_confidence(results),
        )


def _normalize_venue_type(types: list[str]) -> str | None:
    for t in types:
        if t in _TYPE_MAP:
            return _TYPE_MAP[t]
    return None


def _extract_city(formatted_address: str) -> str | None:
    """
    Parse city from a formatted address like:
      "24523 Newhall Ave, Newhall, CA 91321, USA"  → "Newhall"
      "Newhall, CA 91321, USA"                      → "Newhall"
    Takes the third-from-last comma-separated segment.
    """
    if not formatted_address:
        return None
    parts = [p.strip() for p in formatted_address.split(",")]
    if len(parts) >= 3:
        return parts[-3]
    if len(parts) == 2:
        return parts[0]
    return None


def _compute_confidence(results: list[dict]) -> float:
    if len(results) == 1:
        return 0.9
    top = results[0]
    ratings = top.get("user_ratings_total", 0)
    if ratings > 100:
        return 0.85
    if ratings > 20:
        return 0.70
    return 0.50


# ── Public API ────────────────────────────────────────────────────────────────

def _get_client() -> GooglePlacesClient | None:
    key = os.environ.get("PLACES_API_KEY")
    if not key:
        return None
    return GooglePlacesClient(key)


def _home_region() -> tuple[float, float] | None:
    """Return (lat, lng) for HOME_REGION from config, or None."""
    try:
        from config import HOME_REGION
    except (ImportError, AttributeError):
        HOME_REGION = os.environ.get("HOME_REGION", "")
    if not HOME_REGION:
        return None
    # Geocode the home region string using Places textsearch as a cheap one-shot
    key = os.environ.get("PLACES_API_KEY")
    if not key:
        return None
    try:
        r = requests.get(_TEXTSEARCH_URL, params={"query": HOME_REGION, "key": key}, timeout=5)
        data = r.json()
        if data.get("status") == "OK" and data.get("results"):
            loc = data["results"][0]["geometry"]["location"]
            return loc["lat"], loc["lng"]
    except Exception:
        pass
    return None


_home_coords: tuple[float, float] | None = None
_home_coords_fetched = False


def _ip_coords(client_ip: str) -> tuple[float, float] | None:
    """City-level coords from ip-api.com. Returns None for private/unresolvable IPs."""
    if not client_ip or client_ip in ("127.0.0.1", "::1", "localhost"):
        return None
    try:
        r = requests.get(f"http://ip-api.com/json/{client_ip}?fields=status,lat,lon",
                         timeout=3)
        data = r.json()
        if data.get("status") == "success":
            return data["lat"], data["lon"]
    except Exception:
        pass
    return None


def _resolve_location(
    lat: float | None,
    lng: float | None,
    client_ip: str | None = None,
) -> tuple[float | None, float | None]:
    """Return device lat/lng if provided, else IP geolocation, else HOME_REGION coords."""
    global _home_coords, _home_coords_fetched
    if lat is not None and lng is not None:
        return lat, lng
    if client_ip:
        ip_result = _ip_coords(client_ip)
        if ip_result:
            return ip_result
    if not _home_coords_fetched:
        _home_coords = _home_region()
        _home_coords_fetched = True
    if _home_coords:
        return _home_coords
    return None, None


def enrich_place(
    entity_id: int,
    name: str,
    lat: float | None,
    lng: float | None,
    con: sqlite3.Connection,
    client_ip: str | None = None,
) -> bool:
    """
    Look up a place name via Places API and write auto:places Attributes.
    Sets Entity.places_enriched_at on success/failure.
    Returns True if attributes were written.
    """
    client = _get_client()
    if client is None:
        log.warning("PLACES_API_KEY not set — skipping enrichment for entity %d", entity_id)
        return False

    resolved_lat, resolved_lng = _resolve_location(lat, lng, client_ip)
    result = client.search(name, resolved_lat, resolved_lng)

    if result is None or result.confidence < 0.5:
        con.execute(
            "UPDATE Entity SET places_enriched_at = 'failed' WHERE id = ?",
            (entity_id,),
        )
        con.commit()
        log.info("No confident match for place %r (entity %d)", name, entity_id)
        return False

    # Wipe and rewrite auto:places attributes
    con.execute(
        "DELETE FROM Attribute WHERE entity_id = ? AND provenance = 'auto:places'",
        (entity_id,),
    )

    attrs = [("formatted_address", result.formatted_address), ("place_id", result.place_id)]
    if result.city:
        attrs.append(("city", result.city))
    if result.venue_type:
        attrs.append(("venue_type", result.venue_type))
    if result.price_level is not None:
        attrs.append(("price_level", str(result.price_level)))

    for key, value in attrs:
        con.execute(
            "INSERT INTO Attribute (entity_id, attr_type, key, value, confidence, provenance) "
            "VALUES (?, 'fact', ?, ?, ?, 'auto:places')",
            (entity_id, key, value, result.confidence),
        )

    con.execute(
        "UPDATE Entity SET places_enriched_at = datetime('now') WHERE id = ?",
        (entity_id,),
    )
    con.commit()
    log.info("Enriched place %r (entity %d): %s", name, entity_id, result.formatted_address)
    return True
