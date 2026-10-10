import { parentPort as workerPort, workerData } from 'node:worker_threads';
if (!workerPort) throw new Error('This module must run in a worker.');
const parentPort = workerPort;
process.env.SCUPA_DATA_DIR = workerData.dataDir;
process.env.SCUPA_PDFTOTEXT = workerData.pdftotext;
const controller = new AbortController();
let answer;
const cancelled = new Int32Array(workerData.cancelBuffer);
const checkCancelled = () => {
  if (Atomics.load(cancelled, 0) || controller.signal.aborted)
    throw Object.assign(
      new Error('Operation cancelled. Your master records have not been changed.'),
      { code: 'CANCELLED' },
    );
};
parentPort.on('message', (message) => {
  if (message.type === 'cancel') {
    controller.abort();
    answer?.(false);
  }
  if (message.type === 'confirm' && answer) {
    answer(message.accepted === true);
    answer = null;
  }
});
const emit = (event) => parentPort.postMessage({ type: 'progress', ...event });
try {
  const service = await import('../core/service.js');
  let result;
  if (
    ['sync', 'parse', 'setup', 'update-household', 'review-document'].includes(workerData.command)
  ) {
    const release = service.acquireLock();
    try {
      if (workerData.command === 'setup') result = service.setup(workerData.names);
      else if (workerData.command === 'update-household')
        result = service.updateHousehold(workerData.edits);
      else if (workerData.command === 'review-document')
        result = service.reviewDocument(workerData);
      else if (workerData.command === 'parse')
        result = service.reparse({ dryRun: workerData.dryRun, checkCancelled });
      else {
        const { fetchHousehold } = await import('../core/portal.js');
        const fetched = await fetchHousehold({
          fullRefresh: workerData.fullRefresh,
          signal: controller.signal,
          emit,
          confirmHousehold: (names) =>
            new Promise((resolve) => {
              answer = resolve;
              parentPort.postMessage({ type: 'household', names });
            }),
          confirmMember: (member) =>
            new Promise((resolve) => {
              answer = resolve;
              parentPort.postMessage({ type: 'confirm', ...member });
            }),
        });
        checkCancelled();
        emit({ phase: 'parse', message: 'Reading your statements and checking payment totals…' });
        result = { ...service.reparse({ checkCancelled }), fetched };
        const { loadConfig, saveConfig } = await import('../core/util.js');
        const cfg = loadConfig();
        cfg.lastSync = new Date().toISOString();
        saveConfig(cfg);
      }
    } finally {
      release();
    }
  } else if (workerData.command === 'snapshot') result = service.snapshot();
  else if (workerData.command === 'document-path')
    result = service.reviewedDocumentPath(workerData);
  else if (workerData.command === 'archive-help') result = service.archiveHelp();
  else if (workerData.command === 'recover-lock') result = service.recoverLock();
  else if (workerData.command === 'export') result = service.exportCsv(workerData.file);
  else {
    const { execute } = await import('../agent.js');
    result = await execute(workerData.command, { member: workerData.member });
  }
  parentPort.postMessage({ type: 'result', result });
} catch (error) {
  parentPort.postMessage({
    type: 'error',
    error: {
      code: controller.signal.aborted ? 'CANCELLED' : error.code || 'OPERATION_FAILED',
      message: controller.signal.aborted
        ? 'Sync cancelled. Your PDF archive has been kept.'
        : error.message,
    },
  });
} finally {
  parentPort.close();
}
