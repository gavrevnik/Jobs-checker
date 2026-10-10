# Geography

`geography.json` contains a compact local copy of Natural Earth countries (1:110m) and a city gazetteer (1:50m). Coordinates are approximate place locations, not office addresses. SVG paths use Web Mercator with latitude clamped to ±85°. Country labels and aliases come from the source; a small set of common Russian city aliases is added.

Sources, retrieved 2026-09-21:

- https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_admin_0_countries.geojson
- https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_50m_populated_places_simple.geojson
- https://www.naturalearthdata.com/about/terms-of-use/

Natural Earth data is public domain. The city subset contains European places, world capitals and cities with at least one million inhabitants. Unsupported or ambiguous locations remain unplotted and are available through the “География не определена” filter. No geocoding requests, external map tiles, or API keys are used at runtime.
