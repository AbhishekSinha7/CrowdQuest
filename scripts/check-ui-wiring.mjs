import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
const referenced = [...app.matchAll(/\$\('([^']+)'\)/g)].map((match) => match[1]);
const missingIds = [...new Set(referenced)].filter((id) => !ids.has(id));
const dialogs = new Set([...html.matchAll(/<dialog id="([^"]+)"/g)].map((match) => match[1]));
const closeTargets = [...html.matchAll(/data-close="([^"]+)"/g)].map((match) => match[1]);
const missingDialogs = closeTargets.filter((id) => !dialogs.has(id));
const submitCloseButtons = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
  .flatMap((form) => [...form[0].matchAll(/<button class="modal-close"(?![^>]*\btype="button")[^>]*>/g)])
  .length;

if (missingIds.length || missingDialogs.length || submitCloseButtons) {
  console.error(JSON.stringify({ missingIds, missingDialogs, submitCloseButtons }, null, 2));
  process.exitCode = 1;
} else {
  console.log(`UI wiring looks consistent: ${new Set(referenced).size} app IDs, ${dialogs.size} dialogs, ${closeTargets.length} close buttons.`);
}
