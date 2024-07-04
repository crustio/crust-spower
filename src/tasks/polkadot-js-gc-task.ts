/**
 * The polkadot-js 4.2.2.4 version seems to have memory leak which doesn't release the memory for all sent transactions, 
 * so implement this task to force a reconnect of the polkadot-api to force release the memory
 */

import { Logger } from 'winston';
import { AppContext } from '../types/context';
import { SimpleTask } from '../types/tasks';
import { IsStopped, makeIntervalTask } from './task-utils';
import { createConfigOps } from '../db/configs';
import _ from 'lodash';
import Bluebird from 'bluebird';
import { REPORT_SLOT } from '../utils/consts';

const GC_START_BLOCK = 520;
const GC_END_BLOCK = 580;
const KeyLastGCBlock = 'polkadot-js-gc-task:last-gc-block';

/**
 * main entry funciton for the task
 */
async function forPolkadotJsGC(
  context: AppContext,
  logger: Logger,
  isStopped: IsStopped
) { 
  const { api, database, gcLock } = context;
  const configOp = createConfigOps(database);

  while(!isStopped()) {
    try {
      // Sleep a while for next round
      await Bluebird.delay(1 * 1000);

      await api.ensureConnection();
      const curBlock: number = api.latestFinalizedBlock();

      // Do the gc at the [520th~580th] block in the slot, no work-reports-processor and spower-calculator-task are not running in this range
      const blockInSlot = curBlock % REPORT_SLOT;
      if ( blockInSlot < GC_START_BLOCK || blockInSlot > GC_END_BLOCK )  {
        let waitTime = 6000;
        if (blockInSlot < GC_START_BLOCK) {
          waitTime = (GC_START_BLOCK - blockInSlot) * 6 * 1000;
        } else {
          waitTime = (REPORT_SLOT - blockInSlot + GC_START_BLOCK) * 6 * 1000;
        }

        logger.info(`Not in the polkadot-js gc block range, blockInSlot: ${blockInSlot}, keep waiting for ${waitTime/1000} s...`);
        await Bluebird.delay(waitTime);
        continue;
      }

      logger.info(`Starting to gc polkadot-js at block '${curBlock}'...`);

      // Print out the current memory usage
      logger.info("Memory Usage before GC:");
      printMemoryUsage(logger);

      // Try to acquire the lock
      await gcLock.acquireGCLock();

      logger.info(`Stopping the api object...`);
      await api.stop();

      logger.info(`Stopped api successfully, wait a while to reconnect...`);
      await Bluebird.delay(10 * 1000);

      logger.info(`Reinitializing the api object...`);
      await api.initApi();

      logger.info(`Reinitialized api successfully, wait a while for the api to get ready...`);
      await Bluebird.delay(10 * 1000);

      // Force gc manually
      if (global.gc) {
        logger.info(`Forcing garbage collection...`);
        global.gc();
        logger.info(`Garbage collection done!`);
      }

      logger.info(`GC task finished`);
      logger.info("Memory Usage after GC:");
      printMemoryUsage(logger);

      // Save the gc block for reference
      configOp.saveInt(KeyLastGCBlock, curBlock);

      // Sleep for next slot
      const waitTime = (REPORT_SLOT - blockInSlot + GC_START_BLOCK) * 6 * 1000;
      logger.info(`Sleep for ${waitTime/1000} s to gc polkadot-js in next slot`);
      await gcLock.releaseGCLock();
      await Bluebird.delay(waitTime);
    } catch (err) {
      logger.error(`💥 Error to gc polkadot-js: ${err}`);
    } finally {
      await gcLock.releaseGCLock();
    }
  }
}

function printMemoryUsage(logger: Logger) {
  const memoryUsage = process.memoryUsage();
  logger.info(`
               RSS: ${(memoryUsage.rss / 1024 / 1024).toFixed(2)} MB
               Heap Total: ${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB
               Heap Used: ${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB
               External: ${(memoryUsage.external / 1024 / 1024).toFixed(2)} MB
               Array Buffers: ${(memoryUsage.arrayBuffers / 1024 / 1024).toFixed(2)} MB`);
}

export async function createPolkadotJsGCTask(
  context: AppContext,
  loggerParent: Logger,
): Promise<SimpleTask> {
  // TODO: make it configurable
  const processInterval = 60 * 1000;
  return makeIntervalTask(
    20 * 1000, // Start after 20 seconds, make sure all other tasks have started yet
    processInterval,
    'polkadot-js-gc-task',
    context,
    loggerParent,
    forPolkadotJsGC,
  );
}
