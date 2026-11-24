// Prints the exact first request the Claude reviewer sends for one sample document, as JSON.
// It calls nothing: no API key needed, no cost. Settings come from the same places as the API's:
// api/.env if it exists, then config.json (or CONFIG_FILE), then the REVIEWER_* variables.
//
//   npm run show-request -- <document id>
//
// Later turns send the same request with `messages` grown by Claude's answer and the tool
// results, and `max_tokens` lowered when less of the review's token budget is left.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadSamples } from '../src/db/seed';
import { firstRequest } from '../src/reviewer/claude-reviewer';
import { claudeSettingsFromEnv } from '../src/reviewer/config';
import { startupSettings } from '../src/startup';

// The same optional local settings file as the API (src/main.ts).
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { documents } = loadSamples(fileURLToPath(new URL('../../samples', import.meta.url)));
const doc = documents.find((d) => d.id === process.argv[2]);

if (!doc?.text) {
  console.error('Usage: npm run show-request -- <document id>\n\nDocuments:');
  for (const d of documents) console.error(`  ${d.id}  ${d.title}`);
  process.exit(1);
}

// Claude's settings as the API would use them. No key is needed: nothing is sent.
const { config } = startupSettings(process.env);
const settings = claudeSettingsFromEnv(process.env, config.claudeReviewer);

const request = firstRequest(settings, {
  document: { title: doc.title, type: doc.type, client: doc.client ?? null },
  text: doc.text,
  script: doc.findings,
});
console.log(JSON.stringify(request, null, 2));
