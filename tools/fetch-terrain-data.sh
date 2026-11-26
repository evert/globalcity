#!/usr/bin/env bash
# Downloads the climate, tree cover and sea ice rasters that tools/src/gen-world.ts needs into data/raw
# (Natural Earth vectors are fetched by the generator itself). About 300 MB. See ATTRIBUTION.md.
set -euo pipefail
RAW="$(cd "$(dirname "$0")/.." && pwd)/data/raw"
mkdir -p "$RAW/koppen" "$RAW/treecover" "$RAW/seaice"
if [ ! -f "$RAW/koppen/1991_2020/koppen_geiger_0p00833333.tif" ]; then
  curl -fL -o "$RAW/koppen/koppen_geiger_tif.zip" https://ndownloader.figshare.com/files/61012822
  (cd "$RAW/koppen" && unzip -o -q koppen_geiger_tif.zip '1991_2020/*' legend.txt && rm koppen_geiger_tif.zip)
fi
[ -f "$RAW/treecover/tree_cover_1km_2022.tif" ] || curl -fL -o "$RAW/treecover/tree_cover_1km_2022.tif" \
  "https://zenodo.org/api/records/14439377/files/tree.cover_glc.fcd30d_p_1km_20220101_20221231_go_epsg4326_v20241210.tif/content"
cd "$RAW/seaice"
for pole in north:N south:S; do
  for m in 01_Jan 02_Feb 03_Mar 04_Apr 05_May 06_Jun 07_Jul 08_Aug 09_Sep 10_Oct 11_Nov 12_Dec; do
    for y in 2015 2016 2017 2018 2019 2020 2021 2022 2023 2024; do
      f="${pole##*:}_${y}${m%%_*}_extent_v4.0.tif"
      [ -s "$f" ] || echo "https://noaadata.apps.nsidc.org/NOAA/G02135/${pole%%:*}/monthly/geotiff/$m/$f"
    done
  done
done | xargs -r -P 8 -n 1 curl -sfLO
echo "terrain data ready in $RAW"
