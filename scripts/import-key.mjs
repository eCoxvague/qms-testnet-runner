import { importPrivateKey } from './key-manager.mjs';
import { safeError } from './lib.mjs';
try { await importPrivateKey(); }
catch (error) { console.error('Key setup failed: ' + safeError(error)); process.exitCode = 1; }
