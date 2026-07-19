import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportProviderManifest } from '../import-manifest.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const provider = process.argv.find((argument) => argument.startsWith('--provider='))?.split('=')[1]
  || 'chinese_lyrics';
const result = await exportProviderManifest({
  dbPath: process.env.LYRICS_DB_PATH || join(ROOT, 'data', 'lyrics.db'),
  provider,
  outputDir: join(ROOT, 'data', 'import-manifests')
});

console.log(JSON.stringify({ provider, ...result }, null, 2));
