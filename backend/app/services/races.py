"""Race validation is kept independent of HTTP transport."""


def coordinates_valid(latitude: float, longitude: float) -> bool:
    return -90 <= latitude <= 90 and -180 <= longitude <= 180


def publishable(checkpoint_count: int) -> bool:
    return checkpoint_count > 0
