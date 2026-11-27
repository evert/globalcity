// The size of the world the generator makes: the Earth's default, or WORLD_SIZE=<w>x<h> (multiples of 256 tiles).
// Imported first by the generator's entry points, so the shared size is set before anything reads it.
import { configureWorld, EARTH_W, EARTH_H } from '@globalcity/shared';

const m = process.env.WORLD_SIZE?.match(/^(\d+)x(\d+)$/);
if (process.env.WORLD_SIZE && !m) throw new Error(`WORLD_SIZE=${process.env.WORLD_SIZE}: expected <width>x<height>, e.g. 32768x16384`);
configureWorld(m ? Number(m[1]) : EARTH_W, m ? Number(m[2]) : EARTH_H);
