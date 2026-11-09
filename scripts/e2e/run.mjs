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
const MANY_ERRORS_MEGABYTES = 14;
const root = fileURLToPath(new URL('../..', import.meta.url));

const results = [];
const metrics = {};
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
  const setDateTime = (label, value) =>
    evaluate(
      `(() => { const label = [...document.querySelectorAll('label')].find((candidate) => candidate.textContent === ${JSON.stringify(label)}); const input = document.getElementById(label.htmlFor); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    );
  const pickFormat = (optionText) =>
    evaluate(
      `(() => { const label = [...document.querySelectorAll('label')].find((candidate) => candidate.textContent === 'Format du journal'); const select = document.getElementById(label.htmlFor); const option = [...select.options].find((candidate) => candidate.textContent === ${JSON.stringify(optionText)}); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, option.value); select.dispatchEvent(new Event('change', { bubbles: true })); })()`,
    );
  const optionCount = () => count('[role=listbox] [role=option]');
  const selectOption = (index) =>
    evaluate(`document.querySelectorAll('[role=listbox] [role=option]')[${index}].click()`);
  /** Presses a key on the error list the way a keyboard user would, and waits for the next two frames to be drawn. */
  const pressOnList = (key) =>
    evaluate(
      `(async () => { const list = document.querySelector('[role=listbox]'); list.focus(); const start = performance.now(); list.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true })); await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); return performance.now() - start; })()`,
    );
  const activePosition = () =>
    evaluate(`Number(document.getElementById(document.querySelector('[role=listbox]').getAttribute('aria-activedescendant'))?.getAttribute('aria-posinset') ?? 0)`);
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

  await selectOption(0);
  await waitFor(`!!document.querySelector('.entry-text')`, 'le texte relu');
  check('le texte de l’erreur est relu depuis le fichier', (await text('.entry-text')).includes(`Executed endpoint 'HTTP: GET /health'`), await text('.entry-text'));

  // 2b. A period of times of day on the real sample, still on screen after its analysis.
  check('un format sans date propose deux champs heure', await evaluate(`document.querySelectorAll('input[type=time]').length === 2`));
  await setDateTime('Heure de début', '12:06');
  await setDateTime('Heure de fin', '12:06');
  check('changer la période après l’analyse efface le résultat et le dit', !(await evaluate(hasText('Analyse terminée'))) && (await evaluate(hasText('Vous avez changé les réglages'))));
  const timed = await counters();
  check('la période 12:06 à 12:06 écarte 7 des 21 entrées', same(timed, ['21 entrées lues', '7 écartées par vos réglages', '14 prêtes à analyser']), timed.join(' | '));
  await click('Analyser ce journal');
  await waitFor(hasText('Analyse terminée'), 'la fin de l’analyse avec la période', 20000);
  check('avec la période, l’analyse trouve 2 erreurs sur 14 entrées gardées', (await text('.result-sentence')) === '21 entrées lues, 2 erreurs (1 distincte).', await text('.result-sentence'));
  check('les chiffres exacts de la période sont ceux de l’aperçu', same(await counters(), timed));
  await setDateTime('Heure de début', '12:07');
  check('une fin avant le début est refusée avec sa raison', await evaluate(hasText('La fin doit suivre le début')));
  check('l’analyse est interdite tant que la période est invalide', (await isDisabled('Analyser ce journal')) === true);

  // 2c. A period of dates on a dated sample.
  await click('Choisir un autre journal');
  await waitFor(`!!document.querySelector('input[type=file]')`, 'le choix d’un journal daté');
  await chooseFile(join(root, 'samples', 'sample.log'));
  await waitFor(hasText('Format reconnu'), 'la reconnaissance du journal daté');
  // 2d. Masking on the dated sample, which holds a password, an address and an identifier.
  const excerpt = await text('.excerpt');
  check('l’aperçu remplace le mot de passe et l’adresse e-mail par leurs étiquettes', excerpt.includes('Password=[SECRET]') && excerpt.includes('[EMAIL]') && !excerpt.includes('S3cr3t!') && !excerpt.includes('john.doe@example.com'), excerpt.slice(0, 120));
  check('le compteur annonce 2 données masquées', (await counters()).some((counter) => counter === '2 données masquées'), (await counters()).join(' | '));
  check('le GUID n’est masqué que sur option : l’aperçu le garde', excerpt.includes('7f3c9a52-1b6e-4a0d-9b8e-2d5c1a6e44f1'));
  await click('Afficher le texte d’origine');
  check('le texte d’origine s’affiche sur demande', (await text('.excerpt')).includes('Password=S3cr3t!'));
  await click('Afficher le texte d’origine');
  check('un format avec date propose des champs date et heure', await evaluate(`!!document.querySelector('input[type=datetime-local]')`) && !(await evaluate(`!!document.querySelector('input[type=time]')`)));
  await setDateTime('Début (date et heure)', '2026-11-04T08:16');
  await setDateTime('Fin (date et heure)', '2026-11-04T08:16');
  const dated = await counters();
  check('la période datée garde 2 des 14 entrées', same(dated, ['14 entrées lues', '12 écartées par vos réglages', '2 prêtes à analyser']), dated.join(' | '));
  await click('Analyser ce journal');
  await waitFor(hasText('Analyse terminée'), 'la fin de l’analyse du journal daté', 20000);
  check('avec la période datée, l’analyse trouve 1 erreur', (await text('.result-sentence')) === '14 entrées lues, 1 erreur (1 distincte).', await text('.result-sentence'));

  // 2d. Another format picked by hand: on a log that is not recognised, and on one that is.
  await click('Choisir un autre journal');
  await waitFor(`!!document.querySelector('input[type=file]')`, 'le choix du journal à formats mélangés');
  await chooseFile(join(root, 'samples', 'real-mixed-formats.log'));
  await waitFor(hasText('Format non reconnu'), 'le refus de reconnaître le journal à formats mélangés');
  check('un journal non reconnu attend un choix : analyse interdite, ni compteurs ni aperçu', (await isDisabled('Analyser ce journal')) === true && (await count('.counter')) === 0 && (await count('.excerpt')) === 0);
  await pickFormat('Serilog console (sans date)');
  const mixed = await counters();
  check('avec le format console choisi, l’aperçu compte 5 entrées sur les 8 lignes', mixed[0] === '5 entrées lues', mixed.join(' | '));
  check('la ligne avant la première en-tête est signalée', await evaluate(hasText('1 ligne au début du fichier n’a ni date ni niveau')));
  check('la ligne datée est signalée comme ressemblant à un autre format', await evaluate(hasText('1 ligne du journal ressemble à un autre format')));
  check('le format est dit « choisi », pas « reconnu »', await evaluate(hasText('Format choisi : Serilog console (sans date)')));
  await click('Analyser ce journal');
  await waitFor(hasText('Analyse terminée'), 'l’analyse du journal à formats mélangés', 20000);
  check('l’analyse avec le format choisi trouve 1 erreur sur 5 entrées', (await text('.result-sentence')) === '5 entrées lues, 1 erreur (1 distincte).', await text('.result-sentence'));
  await pickFormat('Serilog fichier / horodatage ISO + niveau');
  check('changer le format après l’analyse efface le résultat', !(await evaluate(hasText('Analyse terminée'))) && (await evaluate(hasText('Vous avez changé les réglages'))));
  const mixedAsFile = await counters();
  check('avec le format fichier, l’extrait mêlé se lit autrement : 2 entrées, 2 lignes avant la première en-tête', mixedAsFile[0] === '2 entrées lues' && (await evaluate(hasText('2 lignes au début du fichier n’ont ni date ni niveau'))), mixedAsFile.join(' | '));

  await click('Choisir un autre journal');
  await waitFor(`!!document.querySelector('input[type=file]')`, 'le choix du journal console');
  await chooseFile(join(root, 'samples', 'real-serilog.log'));
  await waitFor(hasText('Format reconnu'), 'la reconnaissance du journal console');
  await pickFormat('Serilog fichier / horodatage ISO + niveau');
  check('un format qui ne lit aucune ligne interdit l’analyse et le dit', (await isDisabled('Analyser ce journal')) === true && (await evaluate(hasText('Aucune ligne du début ne correspond à ce format'))));
  await pickFormat('Serilog console (sans date)');
  check('le bon format rend l’analyse possible', (await isDisabled('Analyser ce journal')) === false && (await evaluate(hasText('Format reconnu : Serilog console (sans date)'))));

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
  // A fourth counter, « données masquées dans le début », comes with the masking: the reading counters are the first three.
  const bigCounters = (await counters()).slice(0, 3);
  const bigCountersExpected = [`${fr(expected.entries)} entrées lues`, `${fr(expected.health)} écartées par vos réglages`, `${fr(expected.entries - expected.health)} prêtes à analyser`];
  check('le gros fichier donne les compteurs exacts avec la règle', same(bigCounters, bigCountersExpected), `obtenu ${bigCounters.join(' | ')}, attendu ${bigCountersExpected.join(' | ')}`);
  const bigOptions = await optionCount();
  const bigSetSize = await evaluate(`Number(document.querySelector('[role=listbox] [role=option]').getAttribute('aria-setsize'))`);
  check('la liste dit sa taille entière et ne met qu’une fraction des lignes dans la page', bigSetSize === expected.errors && bigOptions < 400, `${bigOptions} lignes dans la page pour ${bigSetSize}`);
  check('les erreurs identiques portent un badge « ×N »', (await evaluate(`document.querySelector('[role=listbox] [role=option]').textContent`)).includes('identiques'));
  const toEnd = await pressOnList('End');
  check('Fin va à la dernière erreur, qui est alors dans la page', (await activePosition()) === expected.errors && (await evaluate(`!!document.getElementById(document.querySelector('[role=listbox]').getAttribute('aria-activedescendant'))`)), `${Math.round(toEnd)} ms`);
  await pressOnList('Enter');
  await waitFor(`!!document.querySelector('.entry-text')`, 'le texte de la dernière erreur');
  check('Entrée ouvre le détail de la dernière erreur, avec sa stack', (await text('.error-detail h2')).startsWith('Détail de l’erreur') && (await text('.entry-text')).includes('System.TimeoutException'), await text('.error-detail h2'));
  const lastGroup = (expected.errors - 1) % 6;
  const lastGroupCount = Math.ceil((expected.errors - lastGroup) / 6);
  const identicalText = await text('.identical');
  check(
    'le détail dit combien d’erreurs sont identiques, de la première à la dernière',
    identicalText.includes(`${fr(lastGroupCount)} erreurs identiques parmi les erreurs enregistrées`) &&
      identicalText.includes(`(erreur ${lastGroup + 1})`) &&
      identicalText.includes(`(erreur ${fr(expected.errors)})`),
    identicalText,
  );
  check('les lignes autour ne sont lues qu’à la demande', (await count('.neighbour-lines *')) === 0);
  await click('Voir les lignes autour');
  await waitFor(`!!document.querySelector('.neighbour-lines [aria-label^="Lignes avant"]')`, 'les lignes avant la dernière erreur');
  const linesBefore = await evaluate(`document.querySelector('.neighbour-lines [aria-label^="Lignes avant"]').textContent.split('\\n')`);
  check('dix lignes avant la dernière erreur, toutes des lignes d’information du fichier', linesBefore.length === 10 && linesBefore.every((line) => line.includes('[INF]')), `${linesBefore.length} lignes`);
  const linesAfter = await evaluate(`document.querySelector('.neighbour-lines [aria-label^="Lignes après"]')?.textContent.split('\\n') ?? null`);
  check(
    'après la dernière erreur : au plus dix lignes d’information, ou la fin du journal dite',
    linesAfter === null ? await evaluate(hasText('l’erreur est à la fin du journal')) : linesAfter.length <= 10 && linesAfter.every((line) => line.includes('[INF]')),
    `${linesAfter?.length ?? 0} lignes`,
  );
  await pressOnList('Home');
  check('Début revient à la première erreur', (await activePosition()) === 1);

  // 3b. More errors than are recorded: every one of the 100 000 first is in the list, the page holds a fraction of them.
  const many = join(dataDir, 'many-errors.log');
  const manyExpected = await generateLog(many, MANY_ERRORS_MEGABYTES, 'errors');
  await click('Choisir un autre journal');
  await waitFor(`!!document.querySelector('input[type=file]')`, 'le choix du fichier de nombreuses erreurs');
  await chooseFile(many);
  await waitFor(hasButton('Analyser ce journal'), 'la reconnaissance du fichier de nombreuses erreurs');
  await click('Analyser ce journal');
  await waitFor(hasText('Analyse terminée'), 'la fin de l’analyse de nombreuses erreurs', 120000);
  const doneAt = performance.now();
  await waitFor(`document.querySelectorAll('[role=listbox] [role=option]').length > 0`, 'la première ligne de la liste');
  metrics.firstRowAfterDoneMs = Math.round(performance.now() - doneAt);
  const manySetSize = await evaluate(`Number(document.querySelector('[role=listbox] [role=option]').getAttribute('aria-setsize'))`);
  metrics.recordedErrors = manySetSize;
  metrics.optionsInPage = await optionCount();
  metrics.nodesInPage = await evaluate(`document.querySelectorAll('*').length`);
  check('au-delà de la limite, la liste porte les 100 000 premières erreurs', manyExpected.errors > 100000 && manySetSize === 100000, `${manyExpected.errors} erreurs, ${manySetSize} dans la liste`);
  check('100 000 erreurs laissent moins de 400 lignes et 5 000 nœuds dans la page', metrics.optionsInPage < 400 && metrics.nodesInPage < 5000, `${metrics.optionsInPage} lignes, ${metrics.nodesInPage} nœuds`);
  await pressOnList('End');
  await pressOnList('Enter');
  await waitFor(`!!document.querySelector('.identical')`, 'le détail de la dernière erreur enregistrée');
  check('au-delà de la limite, le nombre d’erreurs identiques est dit minimum', (await text('.identical')).startsWith('Au moins'), await text('.identical'));
  await pressOnList('Home');
  metrics.endKeyMs = Math.round(await pressOnList('End'));
  check('Fin saute à la 100 000e erreur', (await activePosition()) === 100000);
  metrics.pageUpKeyMs = Math.round(await pressOnList('PageUp'));
  metrics.scrollToMiddleMs = Math.round(
    await evaluate(
      `(async () => { const list = document.querySelector('[role=listbox]'); const start = performance.now(); list.scrollTop = list.scrollHeight / 2; await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); return performance.now() - start; })()`,
    ),
  );
  const middle = await evaluate(`[...document.querySelectorAll('[role=listbox] [role=option]')].map((option) => Number(option.getAttribute('aria-posinset')))`);
  check('au milieu de l’ascenseur, la page montre les lignes du milieu de la liste', middle.some((position) => position > 40000 && position < 60000), `${Math.min(...middle)} à ${Math.max(...middle)}`);
  metrics.heapMB = await evaluate(`Math.round(performance.memory.usedJSHeapSize / 1048576)`);

  // 3b. Search and sort over 100 000 recorded errors: the list follows within a time a user can bear.
  const setSearch = (value) =>
    evaluate(
      `(() => { const field = document.querySelector('input[type=search]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, ${JSON.stringify(value)}); field.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    );
  const setSort = (value) =>
    evaluate(
      `(() => { const field = [...document.querySelectorAll('select')].find((select) => select.id.endsWith('-sort')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(field, ${JSON.stringify(value)}); field.dispatchEvent(new Event('change', { bubbles: true })); })()`,
    );
  const listSize = () => evaluate(`Number(document.querySelector('[role=listbox] [role=option]')?.getAttribute('aria-setsize') ?? 0)`);
  const firstTime = () => evaluate(`document.querySelector('[role=listbox] [role=option] .error-time')?.textContent ?? ''`);
  // The generator cycles through six messages: the first one, which names PaymentGateway, is every sixth error.
  const paymentErrors = Math.ceil(manySetSize / 6);
  const searchStart = performance.now();
  await setSearch('PaymentGateway');
  await waitFor(`Number(document.querySelector('[role=listbox] [role=option]')?.getAttribute('aria-setsize')) === ${paymentErrors}`, 'la liste réduite par la recherche');
  metrics.searchMs = Math.round(performance.now() - searchStart);
  check('la recherche ne garde que les erreurs qui contiennent le texte', (await listSize()) === paymentErrors, `${await listSize()} lignes, ${paymentErrors} attendues`);
  check('le nombre d’erreurs affichées est annoncé', plain(await text('.error-toolbar-count')) === `${fr(paymentErrors)} erreurs affichées sur ${fr(manySetSize)}`, await text('.error-toolbar-count'));
  await setSearch('');
  await waitFor(`Number(document.querySelector('[role=listbox] [role=option]')?.getAttribute('aria-setsize')) === ${manySetSize}`, 'la liste entière après avoir vidé la recherche');
  // The generated times go back to midnight after 86 400 entries, so the most recent error is not the last one read.
  const firstInReading = await firstTime();
  const firstTimeIs = (time) => `(document.querySelector('[role=listbox] [role=option] .error-time')?.textContent ?? '') === ${JSON.stringify(time)}`;
  const shownTimes = () => evaluate(`[...document.querySelectorAll('[role=listbox] [role=option] .error-time')].slice(0, 50).map((time) => time.textContent)`);
  const sortStart = performance.now();
  await setSort('time:desc');
  await waitFor(`!(${firstTimeIs(firstInReading)})`, 'la liste triée par heure, la plus récente d’abord');
  metrics.sortByTimeMs = Math.round(performance.now() - sortStart);
  const newestFirst = await shownTimes();
  check('trié par heure, la plus récente d’abord, les premières lignes ne remontent pas dans le temps', newestFirst.length === 50 && newestFirst.every((time, i) => i === 0 || time <= newestFirst[i - 1]) && newestFirst[0] > firstInReading, `${newestFirst[0]} puis ${newestFirst[49]}`);
  check('trier laisse 100 000 erreurs dans la liste et moins de 400 lignes dans la page', (await listSize()) === manySetSize && (await optionCount()) < 400);
  await setSort('reading:asc');
  await waitFor(firstTimeIs(firstInReading), 'le retour à l’ordre de lecture');

  // 3c. A status holds for every identical error: the first error is one of the six messages, repeated every sixth error.
  const setSelectByLabel = (label, value) =>
    evaluate(
      `(() => { const caption = [...document.querySelectorAll('label')].find((candidate) => candidate.textContent === ${JSON.stringify(label)}); const field = document.getElementById(caption.htmlFor); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(field, ${JSON.stringify(value)}); field.dispatchEvent(new Event('change', { bubbles: true })); })()`,
    );
  await pressOnList('Home');
  await pressOnList('Enter');
  await waitFor(`[...document.querySelectorAll('label')].some((candidate) => candidate.textContent === 'Statut de cette erreur')`, 'le choix du statut dans le détail');
  const statusStart = performance.now();
  await setSelectByLabel('Statut de cette erreur', 'resolved');
  await setSelectByLabel('Statut', 'resolved');
  await waitFor(`Number(document.querySelector('[role=listbox] [role=option]')?.getAttribute('aria-setsize')) === ${paymentErrors}`, 'la liste des erreurs résolues');
  metrics.statusAndFilterMs = Math.round(performance.now() - statusStart);
  check('un statut vaut pour toutes les erreurs identiques, que le filtre de statut isole', (await listSize()) === paymentErrors, `${await listSize()} lignes, ${paymentErrors} attendues`);
  check('chaque ligne résolue le dit', (await evaluate(`[...document.querySelectorAll('[role=listbox] [role=option]')].every((option) => option.textContent.includes('Résolu'))`)) === true);
  await setSelectByLabel('Statut', '');
  await waitFor(`Number(document.querySelector('[role=listbox] [role=option]')?.getAttribute('aria-setsize')) === ${manySetSize}`, 'la liste entière sans filtre de statut');

  // 4. Pasted text with markup: shown as text, never interpreted.
  await click('Choisir un autre journal');
  await waitFor(`!!document.querySelector('#paste-input')`, 'le champ de collage');
  const pasted = '[08:16:10 ERR] Failed <img src=x onerror=alert(1)> for john.doe@example.com from 10.0.4.17\n[08:16:11 INF] Next from 10.0.4.18\n';
  await evaluate(
    `(() => { const field = document.querySelector('#paste-input'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(pasted)}); field.dispatchEvent(new Event('input', { bubbles: true })); })()`,
  );
  await click('Lire le texte collé');
  await waitFor(hasButton('Analyser ce journal'), 'la reconnaissance du texte collé');
  await click('Analyser ce journal');
  await waitFor(hasText('Analyse terminée'), 'l’analyse du texte collé', 20000);
  check('le texte collé donne 2 entrées, 1 erreur', (await text('.result-sentence')) === '2 entrées lues, 1 erreur (1 distincte).', await text('.result-sentence'));
  check('le balisage collé reste du texte', !(await evaluate(`!!document.querySelector('[role=option] img')`)) && (await text('.error-first-line')).includes('<img src=x'));
  await pressOnList('Home');
  await pressOnList('Enter');
  await waitFor(hasButton('Voir les lignes autour'), 'le bouton des lignes autour de l’erreur collée');
  await click('Voir les lignes autour');
  await waitFor(hasText('Aucune ligne avant'), 'les lignes autour de l’erreur collée');
  check('dans le texte collé, rien avant l’erreur et la ligne suivante après', (await text('.neighbour-lines [aria-label^="Lignes après"]')) === '[08:16:11 INF] Next from 10.0.4.18' && (await evaluate(hasText('Aucune ligne avant : l’erreur est au début du journal'))));

  // 5. What would be sent: chosen by the user, masked, the lines around the error included, nothing sent.
  check('aucune erreur n’est choisie d’office', (await evaluate(`document.querySelector('.send-panel')?.textContent.includes('Aucune erreur choisie.')`)) === true);
  await evaluate(`[...document.querySelectorAll('label')].find((label) => label.textContent.includes('Faire expliquer cette erreur par l’IA')).querySelector('input').click()`);
  await waitFor(`!!document.querySelector('.send-panel .send-item')`, 'l’erreur choisie dans le panneau d’envoi');
  check('l’erreur choisie est marquée dans la liste', (await text('[role=option]')).includes('À envoyer'));
  await click('Voir le texte exact');
  await waitFor(`!!document.querySelector('[aria-label^="Texte exact envoyé"]')`, 'le texte exact envoyé');
  const sent = await text('[aria-label^="Texte exact envoyé"]');
  check('le texte envoyé masque l’adresse e-mail et les adresses IP, lignes autour comprises', sent.includes('[EMAIL]') && sent.includes('[IP]') && !sent.includes('john.doe') && !sent.includes('10.0.4.17') && !sent.includes('10.0.4.18'), sent);
  check('le balisage reste du texte dans le texte envoyé', sent.includes('<img src=x') && !(await evaluate(`!!document.querySelector('.send-panel img')`)));
  check('l’envoi n’est pas disponible et le dit', (await isDisabled('Envoyer à l’IA')) === true && (await evaluate(hasText('Rien n’a été envoyé'))));
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
console.log(`\nMesures : ${JSON.stringify(metrics)}`);
const failed = results.filter((result) => !result.passed).length;
console.log(failed === 0 ? `\n${results.length} vérifications réussies.` : `\n${failed} vérification(s) en échec sur ${results.length}.`);
process.exit(failed === 0 ? 0 : 1);
