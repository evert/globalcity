#!/usr/bin/env bash
# Downloads the climate, tree cover, elevation, sea ice and plate boundary data that tools/src/gen-world.ts needs
# into data/raw (Natural Earth vectors are fetched by the generator itself, from GitHub). About 640 MB.
# See ATTRIBUTION.md for the datasets and their licences.
#
# By default everything comes from our own mirror, the terrain-data-v2 GitHub release, and is checked against its
# SHA256SUMS, so CI and new checkouts don't load the providers' servers (NOAA, NSIDC, figshare, Zenodo).
#   TERRAIN_SOURCE=upstream  fetch from the original providers instead, one file at a time (only to build or
#                            refresh the mirror; then upload the files as a new terrain-data-vN release)
set -euo pipefail
RAW="$(cd "$(dirname "$0")/.." && pwd)/data/raw"
MIRROR="${TERRAIN_MIRROR:-https://github.com/evert/globalcity/releases/download/terrain-data-v2}"
mkdir -p "$RAW/koppen/1991_2020" "$RAW/treecover" "$RAW/elevation" "$RAW/plates" "$RAW/seaice"

# where each file lives in data/raw, and its name on the mirror
KOPPEN="koppen/1991_2020/koppen_geiger_0p00833333.tif"; KOPPEN_M=koppen_geiger_1991_2020_0p00833333.tif
LEGEND="koppen/legend.txt"; LEGEND_M=koppen_legend.txt
TREE="treecover/tree_cover_1km_2022.tif"; TREE_M=tree_cover_1km_2022.tif
ELEV="elevation/ETOPO_2022_v1_60s_N90W180_surface.tif"; ELEV_M=ETOPO_2022_v1_60s_N90W180_surface.tif
PLATES="plates/PB2002_boundaries.json"; PLATES_M=PB2002_boundaries.json
SEAICE_M=seaice_g02135_v4_monthly_extent_2015_2024.tar
seaice_count() { find "$RAW/seaice" -name '*_extent_v4.0.tif' -size +0 | wc -l; }

if [ "${TERRAIN_SOURCE:-mirror}" = upstream ]; then
  if [ ! -s "$RAW/$KOPPEN" ] || [ ! -s "$RAW/$LEGEND" ]; then
    curl -fL -o "$RAW/koppen/koppen_geiger_tif.zip" https://ndownloader.figshare.com/files/61012822
    (cd "$RAW/koppen" && unzip -o -q koppen_geiger_tif.zip '1991_2020/koppen_geiger_0p00833333.tif' legend.txt && rm koppen_geiger_tif.zip)
  fi
  [ -s "$RAW/$TREE" ] || curl -fL -o "$RAW/$TREE" \
    "https://zenodo.org/api/records/14439377/files/tree.cover_glc.fcd30d_p_1km_20220101_20221231_go_epsg4326_v20241210.tif/content"
  [ -s "$RAW/$ELEV" ] || curl -fL -o "$RAW/$ELEV" \
    https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/60s/60s_surface_elev_gtif/ETOPO_2022_v1_60s_N90W180_surface.tif
  [ -s "$RAW/$PLATES" ] || curl -fL -o "$RAW/$PLATES" \
    https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json
  # NSIDC: one file at a time, gently
  cd "$RAW/seaice"
  for pole in north:N south:S; do
    for m in 01_Jan 02_Feb 03_Mar 04_Apr 05_May 06_Jun 07_Jul 08_Aug 09_Sep 10_Oct 11_Nov 12_Dec; do
      for y in 2015 2016 2017 2018 2019 2020 2021 2022 2023 2024; do
        f="${pole##*:}_${y}${m%%_*}_extent_v4.0.tif"
        [ -s "$f" ] || curl -sfLO "https://noaadata.apps.nsidc.org/NOAA/G02135/${pole%%:*}/monthly/geotiff/$m/$f"
      done
    done
  done
  echo "terrain data ready in $RAW (from the original providers)"
  exit 0
fi

# From the mirror: fetch what's missing, then verify everything against SHA256SUMS.
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
curl -fsSL -o "$TMP/SHA256SUMS" "$MIRROR/SHA256SUMS"
get() { # $1 = path in data/raw, $2 = name on the mirror
  [ -s "$RAW/$1" ] && return 0
  echo "fetching $2"
  curl -fL --retry 3 -o "$RAW/$1.part" "$MIRROR/$2" && mv "$RAW/$1.part" "$RAW/$1"
}
get "$KOPPEN" "$KOPPEN_M"; get "$LEGEND" "$LEGEND_M"; get "$TREE" "$TREE_M"; get "$ELEV" "$ELEV_M"; get "$PLATES" "$PLATES_M"
if [ "$(seaice_count)" -lt 240 ]; then
  echo "fetching $SEAICE_M"
  curl -fL --retry 3 -o "$TMP/$SEAICE_M" "$MIRROR/$SEAICE_M"
  (cd "$TMP" && grep " $SEAICE_M\$" SHA256SUMS | sha256sum -c --quiet -)
  tar -xf "$TMP/$SEAICE_M" -C "$RAW/seaice"
fi
# checksums of the single files (the sea ice archive was checked above)
(
  cd "$RAW"
  for pair in "$KOPPEN:$KOPPEN_M" "$LEGEND:$LEGEND_M" "$TREE:$TREE_M" "$ELEV:$ELEV_M" "$PLATES:$PLATES_M"; do
    want=$(grep " ${pair##*:}\$" "$TMP/SHA256SUMS" | cut -d' ' -f1)
    got=$(sha256sum "${pair%%:*}" | cut -d' ' -f1)
    [ "$want" = "$got" ] || { echo "checksum mismatch: ${pair%%:*} (delete it and run again)" >&2; exit 1; }
  done
)
echo "terrain data ready in $RAW (from the mirror, checksums OK)"
