// Shared Leaflet setup for every map view: stylesheet plus default marker icons.
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

// Vite rewrites asset URLs, which breaks Leaflet's default-icon path detection.
delete (L.Icon.Default.prototype as unknown as {_getIconUrl?: unknown})._getIconUrl;
L.Icon.Default.mergeOptions({iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow});

export default L;
