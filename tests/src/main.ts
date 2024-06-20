import Bluebird from 'bluebird';
import _ from 'lodash';
import CrustApi from './chain';
import { loadConfig } from './config/load-config';
import { loadDb } from './db';
import { AppContext } from './types/context';
import { SPowerConfig } from './types/spower-config';
import { Dayjs } from './utils/datetime';
import { logger } from './utils/logger';
import { timeout, timeoutOrError } from './utils/promise-utils';
import { sleep } from './utils';
import { runPlaceOrderTask } from './tasks/place-order-task';
import { runSworkerSimulatorTask } from './tasks/sworker-simulator-task';
import { runSpowerCheckTask } from './tasks/spower-check-task';

const ConfigFile = process.env['SPOWER_CONFIG'] || 'spower-config.json';
export const MaxNoNewBlockDuration = Dayjs.duration({
  minutes: 30,
});

async function main() {
  logger.info('starting spower test program');
  const config = await loadConfig(ConfigFile);
  logger.debug('spower config loaded: %o', config);
  const api = await timeoutOrError(
    'connect to chain',
    startChain(config),
    240 * 1000,
  );

  const database = await loadDb(config);

  const context: AppContext = {
    api,
    config,
    database,
    startTime: Dayjs(),
  };
  try {
    await waitChainSynced(context);

    const latest = api.latestFinalizedBlock();
    logger.info('latest chain height is %d', latest);

    logger.info('reload chain api, waiting.....');
    await api.reconnect();

    // initialize metadata if not done yet
    await api.initMetadata(context);

    // run the place-order task
    runPlaceOrderTask(context);

    // run the sworker simulator task
    runSworkerSimulatorTask(context);

    // run the spower check task
    runSpowerCheckTask(context);

    // keep alive
    do {
      await sleep(10 * 1000);
    } while(true);
  } catch (e) {
    logger.error('unexpected error caught', e);
    throw e;
  } finally {
    logger.info('closing database and api');
    await timeout(database.close(), 5 * 1000, null);
    api.stop();
  }
}

async function startChain(config: SPowerConfig) {
  logger.info(
    'starting chain api with endpoint: %s',
    config.chain.endPoint,
  );
  const chainApi = new CrustApi(config);
  await chainApi.initApi();
  return chainApi;
}

async function waitChainSynced(context: AppContext): Promise<void> {
  // 2 days
  const maxWait = 57600;
  let tick = 0;
  let successCount = 0;
  logger.info('waiting for chain synced');
  while (tick < maxWait) {
    tick++;
    await Bluebird.delay(3 * 1000);
    if (!(await context.api.isSyncing())) {
      successCount++;
      if (successCount > 1) {
        return;
      }
    }
  }
  throw new Error('time too long to wait for chain synced!');
}

main()
  .then(async () => {
    logger.info('application exited normally');
    process.exit(0);
  })
  .catch(async (e) => {
    logger.error(`Uncaught exception`, e);
    // wait for a short period to gracefully shutdown
    await Bluebird.delay(5 * 1000);
    process.exit(1);
  });

