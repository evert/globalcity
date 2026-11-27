// Runs before every test file (vitest.config.ts setupFiles): the shared constants take the fixture world's size (as
// the servers do, from its base.json), and whatever clients a file leaves open are closed after it.
import { afterAll } from 'vitest';
import { configureWorld } from '@globalcity/shared';
import { closeAll } from './client.ts';
import { FIXTURE_H, FIXTURE_W } from './fixture.ts';

configureWorld(FIXTURE_W, FIXTURE_H);
afterAll(closeAll);
