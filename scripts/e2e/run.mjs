// End-to-end check of the built app in a real Chrome, driven through the DevTools protocol (no dependency).
// What it proves that the unit tests cannot: the real worker runs under the production CSP, a real file goes
// through the real file input, progress and cancelling work, and nothing is written to the console as an error.
//
// Usage: npm run build && npm run e2e        Needs Node >= 22.13 and Chrome (or Chromium, Edge): set CHROME_PATH if not found.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDistServer } from '../serve-dist.mjs';
import { connect } from './cdp.mjs';
import { generateLog } from './generateLog.mjs';

const BIG_LOG_MEGABYTES = 64;
const root = fileURLToPath(new URL('../..', import.meta.url));

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed, detail });
};

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const found = candidates.find((path) => path !== undefined && path !== '' && existsSync(path));
  if (found === undefined) {
    throw new Error('Chrome introuvable : définissez la variable CHROME_PATH.');
  }
  return found;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Numbers are written with a (narrow) no-break space between thousands: compare with plain spaces. */
const plain = (text) => String(text).replace(/\s+/g, ' ').trim();
const fr = (count) => plain(count.toLocaleString('fr-FR'));

async function main() {
  if (!existsSync(join(root, 'dist', 'index.html'))) {
    throw new Error('dist/ est absent : lancez d’abord « npm run build ».');
  }

  const server = createDistServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const appUrl = `http://127.0.0.1:${server.address().port}/`;

  const profileDir = mkdtempSync(join(tmpdir(), 'sherlog-chrome-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'sherlog-data-'));
  const debugPort = await freePort();
  const chrome = spawn(
    findChrome(),
    ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`, '--no-first-run', '--disable-gpu', 'about:blank'],
    { stdio: 'ignore' },
  );
  const chromeFailed = new Promise((_, reject) => chrome.once('error', (error) => reject(new Error(`Chrome n’a pas démarré : ${error.message}`))));

  let cdp;
  try {
    cdp = await Promise.race([connect(debugPort), chromeFailed]);
    await run(cdp, appUrl, dataDir);
  } finally {
    cdp?.close();
    chrome.kill();
    server.close();
    server.closeAllConnections();
    await sleep(500);
    for (const dir of [profileDir, dataDir]) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
      } catch (error) {
        console.warn(`Dossier temporaire non supprimé (${dir}) : ${error.message}`);
      }
    }
  }
}

async function run(cdp, appUrl, dataDir) {
  const problems = [];
  cdp.on((message) => {
    if (message.method === 'Runtime.exceptionThrown') {
      problems.push(`exception : ${message.params.exceptionDetails.text} ${message.params.exceptionDetails.exception?.description ?? ''}`);
    }
    if (message.method === 'Log.entryAdded' && ['error', 'warning'].includes(message.params.entry.level)) {
      problems.push(`journal ${message.params.entry.source} : ${message.params.entry.text} ${message.params.entry.url ?? ''}`);
    }
    if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) {
      problems.push(`console.${message.params.type} : ${message.params.args.map((arg) => arg.value ?? arg.description).join(' ')}`);
    }
  });
  for (const domain of ['Runtime', 'Log', 'Page', 'DOM']) {
    await cdp.send(`${domain}.enable`);
  }

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) {
      throw new Error(`erreur dans la page : ${exceptionDetails.text} ${exceptionDetails.exception?.description ?? ''}`);
    }
    return result.value;
  };
  const waitFor = async (expression, label, timeoutMs = 60000) => {
    const start = performance.now();
    while (!(await evaluate(expression))) {
      if (performance.now() - start > timeoutMs) {
        throw new Error(`délai dépassé en attendant : ${label}`);
      }
      await sleep(100);
    }
  };
  const hasText = (text) => `document.body.innerText.includes(${JSON.stringify(text)})`;
  const hasButton = (text) => `[...document.querySelectorAll('button')].some((button) => button.textContent.includes(${JSON.stringify(text)}))`;
  const click = async (text) => {
    const clicked = await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent.includes(${JSON.stringify(text)})); if (!button) return false; button.click(); return true; })()`);
    if (!clicked) {
      throw new Error(`bouton introuvable : ${text}`);
    }
  };
  const text = async (selector) => plain(await evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`));
  const focused = () => evaluate(`document.activeElement.tagName + ' | ' + document.activeElement.textContent.slice(0, 60)`);
  const counters = async () =>
    (await evaluate(`[...document.querySelectorAll('.counter')].map((counter) => counter.querySelector('strong').textContent + ' ' + counter.querySelector('span').textContent)`)).map(plain);
  const count = (selector) => evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
  const same = (actual, expectedList) => JSON.stringify(actual) === JSON.stringify(expectedList);
  const addRule = async (rule) => {
    await evaluate(
      `(() => { const field = document.querySelector('input.text-input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, ${JSON.stringify(rule)}); field.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    );
    await click('Ajouter la règle');
  };
  const setSelect = (label, value) =>
    evaluate(
      `(() => { const select = document.querySelector('[aria-label=${JSON.stringify(label)}]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(value)}); select.dispatchEvent(new Event('change', { bubbles: true })); })()`,
    );
  const setDateTime = (label, value) =>
    evaluate(
      `(() => { const label = [...document.querySelectorAll('label')].find((candidate) => candidate.textContent === ${JSON.stringify(label)}); const input = document.getElementById(label.htmlFor); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    );
  const isDisabled = (text) => evaluate(`[...document.querySelectorAll('button')].find((button) => button.textContent.includes(${JSON.stringify(text)}))?.disabled ?? null`);
  const chooseFile = async (path) => {
    const { root: documentRoot } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: documentRoot.nodeId, selector: 'input[type=file]' });
    await cdp.send('DOM.setFileInputFiles', { files: [path], nodeId });
  };

  const { product } = await cdp.send('Browser.getVersion');
  console.log(`Navigateur : ${product}`);

  // 1. The page opens under the production CSP.
  await cdp.send('Page.navigate', { url: appUrl });
  await waitFor(`!!document.querySelector('input[type=file]')`, 'la page');
  check('la page s’ouvre et propose un fichier et un champ de collage', await evaluate(`!!document.querySelector('#paste-input')`));
  check('rien n’a pris le focus à l’ouverture', (await focused()).startsWith('BODY'), await focused());

  // 2. A real sample: recognised on choosing, prepared, analysed only on the click.
  await chooseFile(join(root, 'samples', 'real-serilog.log'));
  await waitFor(hasText('Format reconnu'), 'la reconnaissance du format');
  const formatChip = await evaluate(`[...document.querySelectorAll('.chip')].map((chip) => chip.textContent).find((label) => label.startsWith('Format reconnu')) ?? ''`);
  check('le format du fichier réel est reconnu', formatChip.includes('Serilog'), formatChip);
  check('rien n’est analysé avant le clic', !(await evaluate(hasText('Analyse terminée'))) && !(await evaluate(`!!document.querySelector('progress')`)));
  check('le focus est sur le nom du journal', (await focused()).startsWith('H2 | real-serilog.log'), await focused());
  check('la 4e étape est affichée comme pas encore disponible', await evaluate(hasText('pas encore disponible')));
  const before = await counters();
  check('les compteurs sont calculés avant l’analyse', same(before, ['21 entrées lues', '0 écartée par vos réglages', '21 prêtes à analyser']), before.join(' | '));

  await addRule('/health');
  const withRule = await counters();
  check('la règle /health écarte 15 des 21 entrées', same(withRule, ['21 entrées lues', '15 écartées par vos réglages', '6 prêtes à analyser']), withRule.join(' | '));
  check('l’aperçu barre les 15 entrées écartées', (await count('.excerpt .is-ignored')) === 15);

  await click('Analyser ce journal');
  await waitFor(hasText('Analyse terminée'), 'la fin de l’analyse avec la règle', 20000);
  check('avec la règle, l’analyse ne trouve plus d’erreur', (await text('.result-sentence')) === '21 entrées lues, aucune erreur.', await text('.result-sentence'));
  const exact = await counters();
  check('le panneau reste affiché avec les chiffres exacts de l’analyse', same(exact, withRule) && (await evaluate(hasText('Chiffres exacts de l’analyse'))), exact.join(' | '));
  check('le focus est sur la phrase de résultat', (await focused()).startsWith('P | Analyse terminée'), await focused());

  await click('Retirer');
  check('changer un réglage efface le résultat et le dit', !(await evaluate(hasText('Analyse terminée'))) && (await evaluate(hasText('Vous avez changé les réglages'))));
  check('le focus passe au champ des règles quand une règle est retirée', (await focused()).startsWith('INPUT'), await focused());

  await click('Analyser ce journal');
  await waitFor(hasText('Analyse terminée'), 'la fin de l’analyse du fichier réel', 20000);
  check('sans règle, le fichier réel donne 21 entrées, 3 erreurs, 1 empreinte', (await text('.result-sentence')) === '21 entrées lues, 3 erreurs (1 distincte).', await text('.result-sentence'));

  await click('Voir le texte');
  await waitFor(`!!document.querySelector('.entry-text')`, 'le texte relu');
  check('le texte de l’entrée est relu depuis le fichier', (await text('.entry-text')).includes(`Executed endpoint 'HTTP: GET /health'`), await text('.entry-text'));

  // 2b. A period of times of day on the real sample, still on screen after its analysis.
  for (const [label, value] of [['Heure de début', '12'], ['Minutes de début', '06'], ['Heure de fin', '12'], ['Minutes de fin', '06']]) {
    await setSelect(label, value);
  }
  check('changer la période après l’analyse efface le résultat et le dit', !(await evaluate(hasText('Analyse terminée'))) && (await evaluate(hasText('Vous avez changé les réglages'))));
  const timed = await counters();
  check('la période 12:06 à 12:06 écarte 7 des 21 entrées', same(timed, ['21 entrées lues', '7 écartées par vos réglages', '14 prêtes à analyser']), timed.join(' | '));
  await click('Analyser ce journal');
  await waitFor(hasText('Analyse terminée'), 'la fin de l’analyse avec la période', 20000);
  check('avec la période, l’analyse trouve 2 erreurs sur 14 entrées gardées', (await text('.result-sentence')) === '21 entrées lues, 2 erreurs (1 distincte).', await text('.result-sentence'));
  check('les chiffres exacts de la période sont ceux de l’aperçu', same(await counters(), timed));
  await setSelect('Minutes de début', '07');
  check('une fin avant le début est refusée avec sa raison', await evaluate(hasText('La fin doit suivre le début')));
  check('l’analyse est interdite tant que la période est invalide', (await isDisabled('Analyser ce journal')) === true);

  // 2c. A period of dates on a dated sample.
  await click('Choisir un autre journal');
  await waitFor(`!!document.querySelector('input[type=file]')`, 'le choix d’un journal daté');
  await chooseFile(join(root, 'samples', 'sample.log'));
  await waitFor(hasText('Format reconnu'), 'la reconnaissance du journal daté');
  check('un format avec date propose des champs date et heure', await evaluate(`!!document.querySelector('input[type=datetime-local]')`) && !(await evaluate(`!!document.querySelector('[aria-label="Heure de début"]')`)));
  await setDateTime('Début (date et heure)', '2026-11-04T08:16');
  await setDateTime('Fin (date et heure)', '2026-11-04T08:16');
  const dated = await counters();
  check('la période datée garde 2 des 14 entrées', same(dated, ['14 entrées lues', '12 écartées par vos réglages', '2 prêtes à analyser']), dated.join(' | '));
  await click('Analyser ce journal');
  await waitFor(hasText('Analyse terminée'), 'la fin de l’analyse du journal daté', 20000);
  check('avec la période datée, l’analyse trouve 1 erreur', (await text('.result-sentence')) === '14 entrées lues, 1 erreur (1 distincte).', await text('.result-sentence'));

  // 3. A big generated file: progress, cancelling, the exact result.
  const big = join(dataDir, 'big.log');
  const expected = await generateLog(big, BIG_LOG_MEGABYTES);
  await click('Choisir un autre journal');
  await waitFor(`!!document.querySelector('input[type=file]')`, 'le choix d’un autre journal');
  await chooseFile(big);
  await waitFor(hasButton('Analyser ce journal'), 'la reconnaissance du gros fichier');
  check('sur un gros fichier, les chiffres disent qu’ils portent sur le début', await evaluate(hasText('Chiffres calculés sur le début du fichier')));

  await addRule('/health');
  check('le compte d’une règle dit qu’il porte sur le début', (await text('.rule-count')).includes('dans le début'), await text('.rule-count'));

  await click('Analyser ce journal');
  await waitFor(`!!document.querySelector('progress')`, 'la barre de progression');
  const live = await evaluate(`[...document.querySelectorAll('[role=status]')].map((node) => node.textContent).join('|')`);
  check('la zone annoncée ne porte pas le pourcentage', !live.includes('%'), live);
  await sleep(300);
  await click('Annuler');
  const cancelStart = performance.now();
  await waitFor(hasButton('Analyser ce journal'), 'le retour après annulation', 5000);
  check('annuler ramène au fichier reconnu en moins de 2 s', performance.now() - cancelStart < 2000, `${Math.round(performance.now() - cancelStart)} ms`);
  await sleep(1500);
  check('aucun résultat n’apparaît après une annulation', !(await evaluate(hasText('Analyse terminée'))));
  check('annuler garde la règle', (await count('.rule')) === 1);

  await click('Analyser ce journal');
  await waitFor(`!!document.querySelector('progress')`, 'la barre de progression (2e analyse)');
  const progress = [];
  while (!(await evaluate(hasText('Analyse terminée')))) {
    progress.push(await evaluate(`document.querySelector('progress')?.value ?? null`));
    await sleep(200);
    if (progress.length > 600) {
      throw new Error('l’analyse du gros fichier dépasse 2 minutes');
    }
  }
  const seen = progress.filter((value) => value !== null);
  check('la progression est relevée et ne recule jamais', seen.length >= 2 && seen.every((value, i) => i === 0 || value >= seen[i - 1]), `${seen.length} relevés`);
  const bigSummary = await text('.result-sentence');
  const bigExpected = `${fr(expected.entries)} entrées lues, ${fr(expected.errors)} erreurs (${expected.distinct} distinctes).`;
  check('le gros fichier donne exactement les comptes attendus', bigSummary === bigExpected, `obtenu « ${bigSummary} », attendu « ${bigExpected} »`);
  const bigCounters = await counters();
  const bigCountersExpected = [`${fr(expected.entries)} entrées lues`, `${fr(expected.health)} écartées par vos réglages`, `${fr(expected.entries - expected.health)} prêtes à analyser`];
  check('le gros fichier donne les compteurs exacts avec la règle', same(bigCounters, bigCountersExpected), `obtenu ${bigCounters.join(' | ')}, attendu ${bigCountersExpected.join(' | ')}`);
  check('au plus 200 lignes sont affichées', (await evaluate(`document.querySelectorAll('.error-row').length`)) === Math.min(200, expected.errors));

  // 4. Pasted text with markup: shown as text, never interpreted.
  await click('Choisir un autre journal');
  await waitFor(`!!document.querySelector('#paste-input')`, 'le champ de collage');
  const pasted = '[08:16:10 ERR] Failed <img src=x onerror=alert(1)>\n[08:16:11 INF] Next\n';
  await evaluate(
    `(() => { const field = document.querySelector('#paste-input'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(pasted)}); field.dispatchEvent(new Event('input', { bubbles: true })); })()`,
  );
  await click('Lire le texte collé');
  await waitFor(hasButton('Analyser ce journal'), 'la reconnaissance du texte collé');
  await click('Analyser ce journal');
  await waitFor(hasText('Analyse terminée'), 'l’analyse du texte collé', 20000);
  check('le texte collé donne 2 entrées, 1 erreur', (await text('.result-sentence')) === '2 entrées lues, 1 erreur (1 distincte).', await text('.result-sentence'));
  check('le balisage collé reste du texte', !(await evaluate(`!!document.querySelector('.error-row img')`)) && (await text('.error-first-line')).includes('<img src=x'));

  check('aucune erreur, exception ni avertissement dans la console', problems.length === 0, problems.join(' ; '));
}

try {
  await main();
} catch (error) {
  check('le parcours va jusqu’au bout', false, error.message);
}

for (const { name, passed, detail } of results) {
  console.log(`${passed ? 'OK  ' : 'ÉCHEC'} ${name}${detail === '' || passed ? '' : ` — ${detail}`}`);
}
const failed = results.filter((result) => !result.passed).length;
console.log(failed === 0 ? `\n${results.length} vérifications réussies.` : `\n${failed} vérification(s) en échec sur ${results.length}.`);
process.exit(failed === 0 ? 0 : 1);
