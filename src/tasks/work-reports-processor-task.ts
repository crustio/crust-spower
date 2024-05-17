/**
 * The work reports processor task to consolidate batch of work reports to file replicas data
 */

import { Logger } from 'winston';
import { createWorkReportsToProcessOperator } from '../db/work-reports-to-process';
import { AppContext } from '../types/context';
import { SimpleTask } from '../types/tasks';
import { IsStopped, makeIntervalTask } from './task-utils';

/**
 * main entry funciton for the task
 */
async function processWorkReports(
  context: AppContext,
  logger: Logger,
  isStopped: IsStopped,
) {
    const { database } = context;
    const workReportsOp = createWorkReportsToProcessOperator(database);
    let round = 1;

    do {
      if (isStopped()) {
        return;
      }

      // Get 50 work reports per time
      const workReports = await workReportsOp.getPendingWorkReports(50);
      logger.info(`Round ${round}: ${workReports.length} work reports to process.`);

      if (workReports.length === 0) {
        logger.info(`No more work reports to process, stop for a while.`);
        break;
      }

      for (const wr of workReports) {
          try {
            

            await workReportsOp.updateWorkReportRecordStatus(wr.id, 'processed');
          } catch (err) {
            logger.error(`Process work report (id: ${wr.id}) failed. Error: ${err}`);
            await workReportsOp.updateWorkReportRecordStatus(wr.id, 'failed');
          }
      }

      round++;
    } while(true);
}

export async function createWorkReportsProcessor(
  context: AppContext,
  loggerParent: Logger,
): Promise<SimpleTask> {
  // TODO: make it configurable
  const processInterval = 10 * 1000;  // default is 5 minutes
  return makeIntervalTask(
    1 * 1000,
    processInterval,
    'work-reports-processor',
    context,
    loggerParent,
    processWorkReports,
  );
}
