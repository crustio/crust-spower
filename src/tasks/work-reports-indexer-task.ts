/**
 * The work reports indexer to get work reports from chain and store them into database 
 */

import { Logger } from 'winston';
import { createWorkReportsToProcessOperator } from '../db/work-reports-to-process';
import { AppContext } from '../types/context';
import { SimpleTask } from '../types/tasks';
import { makeIntervalTask } from './task-utils';

/**
 * main entry funciton for the task
 */
async function indexWorkReports(
  context: AppContext,
  logger: Logger,
) { 
    try {
      const api = context.api;
      const { database } = context;
      const workReportsOp = createWorkReportsToProcessOperator(database);

      const workReportsToProcess = await api.getWorkReportsToProcess();

      const insertRecordsCount = await workReportsOp.addWorkReports(workReportsToProcess);
      logger.info(`Get ${workReportsToProcess.length} work reports from chain: New - ${insertRecordsCount}, Existing: ${workReportsToProcess.length-insertRecordsCount}`);
    } catch (err) {
      logger.error(`💥 Error to index work reports: ${err}`);
    } 
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
