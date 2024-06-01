/**
 * The work reports indexer to get work reports from chain and store them into database 
 */

import { Logger } from 'winston';
import { createWorkReportsToProcessOperator } from '../db/work-reports-to-process';
import { AppContext } from '../types/context';
import { SimpleTask } from '../types/tasks';
import { IsStopped, makeIntervalTask } from './task-utils';
import { createConfigOps } from '../db/configs';
import _ from 'lodash';
import { Dayjs } from '../utils/datetime';
import { MaxNoNewBlockDuration } from '../main';
import Bluebird from 'bluebird';

const KeyLastProcessedBlockWrs = 'work-reports-indexer:last-processed-block';
/**
 * main entry funciton for the task
 */
async function indexWorkReports(
  context: AppContext,
  logger: Logger,
  isStopped: IsStopped
) { 
  const { api, database } = context;
  const configOp = createConfigOps(database);
  const workReportsOp = createWorkReportsToProcessOperator(database);
  
  // Get the last processed block
  let lastProcessedBlock = await configOp.readInt(KeyLastProcessedBlockWrs);
  if (_.isNil(lastProcessedBlock) || lastProcessedBlock === 0) {
    logger.info(`No '${KeyLastProcessedBlockWrs}' config found in DB, this is the first run, get the value from chain.`);
    lastProcessedBlock = await api.getLastProcessedBlockWorkReports();
    if (_.isNil(lastProcessedBlock) || lastProcessedBlock === 0) {
      logger.info(`No work reports to process on chain yet, stop for a while.`);
      return;
    }

    // Save the retrieved value to DB
    configOp.saveInt(KeyLastProcessedBlockWrs, lastProcessedBlock);
  }
  logger.info(`Last processed block of work reports: ${lastProcessedBlock}`);

  let lastBlockTime = Dayjs();

  do {
    if (isStopped()) {
      return;
    }

    await api.ensureConnection();
    const curBlock = api.latestFinalizedBlock();
    if (lastProcessedBlock >= curBlock) {
      const now = Dayjs();
      const diff = Dayjs.duration(now.diff(lastBlockTime));
      if (diff.asSeconds() > MaxNoNewBlockDuration.asSeconds()) {
        logger.error('no new block for %d seconds, please check RPC node!', diff.asSeconds());
        /// TODO: Trigger an alert to monitoring system
        throw new Error('block not updating');
      }
      await Bluebird.delay(3 * 1000);
      continue;
    }
    lastBlockTime = Dayjs();

    // Iterate every block to get the work reports to process
    try {
      for (let block = lastProcessedBlock + 1; block <= curBlock; block++) {
        // Get work reports to process from chain at the specific block
        const workReportsToProcess = await api.getWorkReportsToProcess(block);

        if (workReportsToProcess.length > 0) {
          const insertRecordsCount = await workReportsOp.addWorkReports(block, workReportsToProcess);
          logger.info(`Insert work reports data at block '${block}' to DB, insert records count: ${insertRecordsCount}`);
        }
        
        // Update the last processed block
        lastProcessedBlock = block;
        configOp.saveInt(KeyLastProcessedBlockWrs, lastProcessedBlock);
    }
    } catch (err) {
      logger.error(`💥 Error to index work reports: ${err}`);
    } 

    // Sleep a while for next round
    await Bluebird.delay(1 * 1000);

  } while(true);
}

export async function createWorkReportsIndexer(
  context: AppContext,
  loggerParent: Logger,
): Promise<SimpleTask> {
  // TODO: make it configurable
  const processInterval = 10 * 1000;  // default is 5 minutes
  return makeIntervalTask(
    1 * 1000,
    processInterval,
    'work-reports-indexer',
    context,
    loggerParent,
    indexWorkReports,
  );
}
