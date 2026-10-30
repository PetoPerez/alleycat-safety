"""Race validation is kept independent of HTTP transport."""
import math
import os
from datetime import datetime, timedelta

RELEASE_MINUTES_MAX = 24 * 60
# Phone GPS in a city is often 10-30 m off; widen this before race day if honest riders get rejected.
CHECKIN_RADIUS_M = float(os.environ.get("CHECKIN_RADIUS_M", "50"))


def coordinates_valid(latitude: float, longitude: float) -> bool:
    return -90 <= latitude <= 90 and -180 <= longitude <= 180


def publishable(checkpoint_count: int) -> bool:
    return checkpoint_count > 0


def release_minutes_valid(minutes: int) -> bool:
    return 0 <= minutes <= RELEASE_MINUTES_MAX


def release_at(race) -> datetime:
    """Effective checkpoint release: the admin's "release now" if any, else the scheduled time."""
    return race.checkpoints_released_at or race.starts_at - timedelta(minutes=race.checkpoints_release_minutes)


def released(race, now: datetime) -> bool:
    return now >= release_at(race)


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle (haversine) distance; plenty precise at checkpoint scale."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(a))
