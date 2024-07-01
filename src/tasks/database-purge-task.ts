/**
 * The database purge task to purge legacy data from database 
 */

import { Logger } from 'winston';
import { AppContext } from '../types/context';
import { SimpleTask } from '../types/tasks';
import { IsStopped, makeIntervalTask } from './task-utils';
import { createConfigOps } from '../db/configs';
import _ from 'lodash';
import { createWorkReportsToProcessOperator } from '../db/work-reports-to-process';

const KeyWorkReportsToProcessTablePersistTime = 'database-purge-task:work-reports-to-process-table-persist-time-in-hours'; 
const DefaultWorkReportsToProcessTablePersistTime = 336; // Unit in hours, default to keep 14 days 

/**
 * main entry funciton for the task
 */
async function purgeDatabase(
  context: AppContext,
  logger: Logger,
  _isStopped: IsStopped
) { 
  const { database } = context;
  const configOp = createConfigOps(database);
  const workReportsOp = createWorkReportsToProcessOperator(database);
  
  // Get the purge config from db
  let wr2pTablePersistTime: number = await configOp.readInt(KeyWorkReportsToProcessTablePersistTime);
  if (_.isNil(wr2pTablePersistTime) || wr2pTablePersistTime === 0) {
    logger.info(`No '${KeyWorkReportsToProcessTablePersistTime}' config found in DB, use default value ${DefaultWorkReportsToProcessTablePersistTime}.`);
    wr2pTablePersistTime = DefaultWorkReportsToProcessTablePersistTime;

    // Save the retrieved value to DB
    configOp.saveInt(KeyWorkReportsToProcessTablePersistTime, wr2pTablePersistTime);
  }
  logger.info(`work-reports-to-process table persist time in hours: ${wr2pTablePersistTime}`);

  // Purge the table
  logger.info(`Start to purge records from work-reports-to-process table...`);
  const deletedRowsCount = await workReportsOp.purgeRecords(wr2pTablePersistTime);
  logger.info(`Number of records deleted: ${deletedRowsCount}`);
}

export async function createDatabasePurgeTask(
  context: AppContext,
  loggerParent: Logger,
): Promise<SimpleTask> {
  // TODO: make it configurable
  const processInterval = 10 * 60 * 1000;
  return makeIntervalTask(
    1 * 1000,
    processInterval,
    'database-purge-task',
    context,
    loggerParent,
    purgeDatabase,
  );
}
