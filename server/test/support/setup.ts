// Runs before every test file (vitest.config.ts setupFiles): whatever clients a file leaves open are closed after it.
import { afterAll } from 'vitest';
import { closeAll } from './client.ts';

afterAll(closeAll);
