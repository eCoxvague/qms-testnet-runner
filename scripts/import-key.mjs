import { importPrivateKey } from './key-manager.mjs';
import { safeError } from './lib.mjs';
import { log } from './messages.mjs';
try { await importPrivateKey(); }
catch (error) { console.error(log.keyImportFailed('密钥设置') + safeError(error)); process.exitCode = 1; }
