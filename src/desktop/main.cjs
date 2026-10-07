const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { Worker } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');

app.setName('BUPA SCUPA');
app.setAppUserModelId('org.bupa-scupa.desktop');
if (process.env.SCUPA_APP_DIR) {
  if (!path.isAbsolute(process.env.SCUPA_APP_DIR))
    throw new Error('SCUPA_APP_DIR must be absolute.');
  fs.mkdirSync(process.env.SCUPA_APP_DIR, { recursive: true });
  app.setPath('userData', process.env.SCUPA_APP_DIR);
}
let window;
let active;
let activeCancel;
let closing = false;
let pendingConfirm = false;
let dataDir;
const resources = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '../../vendor');
const pdftotext = path.join(resources, 'xpdf', 'pdftotext.exe');
const uiUrl = pathToFileURL(path.join(__dirname, '../ui/index.html')).href;
const args = process.argv.slice(app.isPackaged ? 1 : 2);
const agentIndex = args.indexOf('--agent');
let agent;
let finishAgent;
let agentSession;
const prefsPath = () => path.join(app.getPath('userData'), 'archive-location.json');
function progress(value) {
  if (agentSession && value.phase) {
    const humanAction =
      value.phase === 'login' ? 'LOGIN_MFA' : value.phase === 'agent' ? 'START_SYNC' : undefined;
    agentSession.event({
      phase: value.phase,
      state: humanAction ? 'waiting_for_human' : 'running',
      humanAction,
      current: value.current,
      total: value.total,
    });
  }
  if (window && !window.isDestroyed()) window.webContents.send('scupa:progress', value);
}
function cancelWorker() {
  if (active) {
    Atomics.store(activeCancel, 0, 1);
    active.postMessage({ type: 'cancel' });
  }
}
function run(command, options = {}) {
  if (active)
    return Promise.reject(
      Object.assign(new Error('An operation is already running.'), { code: 'BUSY' }),
    );
  return new Promise((resolve, reject) => {
    const cancelBuffer = new SharedArrayBuffer(4);
    activeCancel = new Int32Array(cancelBuffer);
    const worker = new Worker(path.join(__dirname, 'worker.js'), {
      workerData: { command, dataDir, pdftotext, cancelBuffer, ...options },
    });
    active = worker;
    let completed = false;
    const finish = (error, result) => {
      if (completed) return;
      completed = true;
      active = null;
      pendingConfirm = false;
      if (closing) setImmediate(() => app.quit());
      if (error) reject(error);
      else resolve(result);
    };
    worker.on('message', (message) => {
      if (message.type === 'progress') progress(message);
      if (message.type === 'confirm' || message.type === 'household') {
        pendingConfirm = true;
        agentSession?.event({
          phase: 'confirm',
          state: 'waiting_for_human',
          humanAction: message.type === 'household' ? 'CONFIRM_HOUSEHOLD' : 'CONFIRM_MEMBER',
        });
        progress(message);
      }
      if (message.type === 'result') finish(null, message.result);
      if (message.type === 'error')
        finish(Object.assign(new Error(message.error.message), { code: message.error.code }));
    });
    worker.on('error', (error) => finish(error));
    worker.on('exit', () => {
      if (!completed)
        finish(new Error('The operation stopped unexpectedly. Your records have been kept.'));
    });
  });
}
function makeWindow() {
  window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 860,
    minHeight: 620,
    backgroundColor: '#f6f8fa',
    title: 'BUPA SCUPA',
    icon: path.join(__dirname, '../../assets/icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== uiUrl) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.on('close', (event) => {
    if (active) {
      event.preventDefault();
      closing = true;
      cancelWorker();
      progress({ message: 'Closing the Bupa browser safely…' });
    }
  });
  window.loadURL(uiUrl);
}
function assertSender(event) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    event.senderFrame.url !== uiUrl
  )
    throw new Error('Unauthorised request.');
}
app
  .whenReady()
  .then(async () => {
    const { parseArgs, execute, envelope, exitCode, writeResult, createAgentSession } =
      await import('../agent.js');
    finishAgent = (result, error) => {
      if (!agent) return;
      try {
        process.stdout.write(agentSession.finish(result, error));
      } catch (e) {
        process.stderr.write(e.message + '\n');
        error = e;
      }
      agent = null;
      setImmediate(() => app.exit(exitCode(error)));
    };
    if (agentIndex >= 0) {
      try {
        agent = parseArgs(args.slice(agentIndex + 1));
      } catch (error) {
        try {
          process.stdout.write(
            writeResult(
              error.options?.output,
              envelope('unknown', null, error),
              error.options?.dataDir,
            ),
          );
        } catch (outputError) {
          process.stderr.write(outputError.message + '\n');
        }
        app.exit(exitCode(error));
        return;
      }
    }
    dataDir = agent?.options.dataDir || process.env.SCUPA_DATA_DIR;
    if (!dataDir) {
      try {
        dataDir = JSON.parse(fs.readFileSync(prefsPath(), 'utf8')).dataDir;
      } catch {
        /* First launch. */
      }
    }
    dataDir ||= path.join(app.getPath('documents'), 'BUPA SCUPA');
    if (!path.isAbsolute(dataDir)) throw new Error('Archive path must be absolute.');
    if (agent) {
      try {
        agentSession = createAgentSession(agent.command, agent.options, dataDir);
        agentSession.event();
      } catch (error) {
        process.stdout.write(JSON.stringify(envelope(agent.command, null, error)) + '\n');
        app.exit(exitCode(error));
        return;
      }
    }
    if (agent && agent.command !== 'sync') {
      let result;
      let error;
      try {
        result =
          agent.command === 'schema'
            ? await execute('schema')
            : await run(agent.command, {
                member: agent.options.member,
                dryRun: agent.options.dryRun,
              });
      } catch (e) {
        error = e;
      }
      try {
        process.stdout.write(agentSession.finish(result, error));
      } catch (e) {
        process.stderr.write(e.message + '\n');
        error = e;
      }
      app.exit(exitCode(error));
      return;
    }
    if (agent) {
      try {
        await run('status');
      } catch (error) {
        finishAgent(null, error);
        return;
      }
    }
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
      callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      callback({
        cancel: !details.url.startsWith('file://') && !details.url.startsWith('devtools://'),
      });
    });
    ipcMain.handle('scupa:call', async (event, command, options = {}) => {
      try {
        assertSender(event);
        if (!options || typeof options !== 'object' || Array.isArray(options))
          throw new Error('Invalid request.');
        if (command === 'cancel') {
          cancelWorker();
          return { ok: true, result: undefined };
        }
        if (command === 'confirm') {
          if (!pendingConfirm || typeof options.accepted !== 'boolean')
            throw new Error('No confirmation is pending.');
          if (options.accepted) agentSession?.event({ phase: 'member' });
          pendingConfirm = false;
          active?.postMessage({ type: 'confirm', accepted: options.accepted });
          return { ok: true, result: undefined };
        }
        if (command === 'folder') {
          if (agent)
            throw Object.assign(
              new Error(
                'An agent request uses one archive. Close this request and start a new invocation with --data-dir to choose another.',
              ),
              { code: 'INVALID_INPUT' },
            );
          if (active)
            throw Object.assign(new Error('Wait for the current operation to finish.'), {
              code: 'BUSY',
            });
          const choice = await dialog.showOpenDialog(window, {
            title: 'Choose your permanent archive folder',
            defaultPath: dataDir,
            properties: ['openDirectory', 'createDirectory'],
          });
          if (!choice.canceled) {
            dataDir = choice.filePaths[0];
            fs.mkdirSync(path.dirname(prefsPath()), { recursive: true });
            fs.writeFileSync(prefsPath(), JSON.stringify({ dataDir }));
          }
          return { ok: true, result: await run('snapshot') };
        }
        if (command === 'open-folder') {
          fs.mkdirSync(dataDir, { recursive: true });
          const error = await shell.openPath(dataDir);
          if (error) throw new Error(error);
          return { ok: true, result: undefined };
        }
        if (command === 'open-document' || command === 'review-document') {
          const document = { file: options.file, sha256: options.sha256 };
          if (command === 'open-document') {
            const file = await run('document-path', document);
            const error = await shell.openPath(file);
            if (error) throw new Error(error);
          } else {
            if (agent)
              throw Object.assign(
                new Error('Open SCUPA normally to review supporting documents.'),
                { code: 'HUMAN_ACTION_REQUIRED' },
              );
            if (typeof options.supporting !== 'boolean')
              throw new Error('Invalid review decision.');
            if (options.supporting) {
              await run('document-path', document);
              const choice = await dialog.showMessageBox(window, {
                type: 'question',
                title: 'Mark as supporting document',
                message: 'Have you viewed every page and confirmed this is an invoice or receipt?',
                detail:
                  document.file +
                  '\n\nDo not use this for a Bupa statement. This PDF will be kept, but will not be used to calculate claim amounts. A changed PDF will require a new review.',
                buttons: ['Cancel', 'Mark as supporting'],
                defaultId: 0,
                cancelId: 0,
              });
              if (choice.response !== 1) return { ok: true, result: undefined };
            }
            await run('review-document', { ...document, supporting: options.supporting });
          }
          return { ok: true, result: undefined };
        }
        if (command === 'export') {
          const choice = await dialog.showSaveDialog(window, {
            title: 'Export claims for a spreadsheet',
            defaultPath: path.join(app.getPath('documents'), 'bupa-scupa-claims.csv'),
            filters: [{ name: 'CSV', extensions: ['csv'] }],
          });
          return {
            ok: true,
            result: choice.canceled ? null : await run('export', { file: choice.filePath }),
          };
        }
        if (
          ![
            'snapshot',
            'setup',
            'sync',
            'parse',
            'update-household',
            'archive-help',
            'recover-lock',
          ].includes(command)
        )
          throw new Error('Unsupported command.');
        if (agent && ['update-household', 'recover-lock'].includes(command))
          throw Object.assign(
            new Error('Close the agent request and open SCUPA normally to manage this archive.'),
            { code: 'HUMAN_ACTION_REQUIRED' },
          );
        const safeOptions =
          command === 'setup'
            ? { names: options.names }
            : command === 'update-household'
              ? { edits: options.edits }
              : command === 'parse'
                ? { dryRun: options.dryRun === true }
                : command === 'sync'
                  ? {
                      fullRefresh:
                        options.fullRefresh === true || agent?.options.fullRefresh === true,
                    }
                  : {};
        if (agent && command === 'sync') agentSession.event({ phase: 'starting' });
        const result = await run(command, safeOptions);
        if (agent && command === 'setup')
          agentSession.event({
            phase: 'agent',
            state: 'waiting_for_human',
            humanAction: 'START_SYNC',
          });
        if (agent && command === 'sync') finishAgent(result);
        return { ok: true, result };
      } catch (error) {
        if (agent && command === 'sync') finishAgent(null, error);
        return {
          ok: false,
          error: { code: error.code || 'OPERATION_FAILED', message: error.message },
        };
      }
    });
    makeWindow();
    if (agent)
      window.webContents.once('did-finish-load', () => {
        progress({
          phase: 'agent',
          message: agent.options.fullRefresh
            ? 'An agent requested a full refresh of all available claims. Click Sync when you are ready to sign in.'
            : 'An agent requested a sync. Click Sync when you are ready to sign in.',
        });
      });
  })
  .catch((error) => {
    dialog.showErrorBox('BUPA SCUPA could not start', error.message);
    app.exit(1);
  });
app.on('window-all-closed', () => {
  if (!active) {
    if (agent && finishAgent)
      finishAgent(
        null,
        Object.assign(new Error('The human closed the app before the requested sync finished.'), {
          code: 'CANCELLED',
        }),
      );
    else app.quit();
  }
});
