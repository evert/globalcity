// Pollution, shared by the server (land value) and the client (pollution map view), so both agree.
// Sources add a contribution that falls off linearly with Chebyshev distance:
//   strength * (1 - d / (radius + 1)) for d <= radius.
// A lot with pollution >= POLLUTION_HIGH loses one land value step, >= POLLUTION_SEVERE a second one.
// Coal is by far the dirtiest source, to make wind and nuclear worth their price.
import * as T from './tiles.ts';

export const POLLUTION_HIGH = 60;
export const POLLUTION_SEVERE = 150;
export const POLLUTION_MAX_RADIUS = 12; // the server's land value scan covers 12 tiles

/** Pollution emitted by a tile, or null. Buildings emit from their centre tile (ZONEBIT); roads per tile. */
export function pollutionSource(v: number): { strength: number; radius: number } | null {
  const id = v & T.LOMASK;
  if (v & T.ZONEBIT) {
    if (id === T.POWERPLANT) return { strength: 300, radius: 12 }; // smog to ~10 tiles, severe to ~6
    if (id === T.AIRPORT) return { strength: 50, radius: 8 };
    if (id === T.PORT) return { strength: 40, radius: 6 };
    if (id >= T.INDBASE && id <= T.INDLAST && id !== T.INDCLR) {
      const density = Math.floor((id - T.IZB) / 9) % 4; // 0..3
      return { strength: 30 + 15 * density, radius: 6 };
    }
    return null;
  }
  if (id >= T.HTRFBASE && id <= T.LASTROAD) return { strength: 14, radius: 2 }; // heavy traffic
  if (id >= T.LTRFBASE && id < T.HTRFBASE) return { strength: 6, radius: 1 }; // light traffic
  return null;
}

/** Contribution of a source at Chebyshev distance d. */
export const pollutionAt = (s: { strength: number; radius: number }, d: number): number => (d > s.radius ? 0 : s.strength * (1 - d / (s.radius + 1)));
