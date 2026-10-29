"""Race validation is kept independent of HTTP transport."""
from datetime import datetime, timedelta

RELEASE_MINUTES_MAX = 24 * 60


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
