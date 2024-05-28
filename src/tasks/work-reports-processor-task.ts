/**
 * The work reports processor task to consolidate batch of work reports to file replicas data, 
 * and then update the replicas data to Crust Mainnet chain.
 */

import { Logger } from 'winston';
import { createWorkReportsToProcessOperator } from '../db/work-reports-to-process';
import { AppContext } from '../types/context';
import { SimpleTask } from '../types/tasks';
import { IsStopped, makeIntervalTask } from './task-utils';
import { WorkReportsToProcessRecord } from '../types/database';
import { FileToUpdate, ReplicaToUpdate } from '../types/chain';
import { stringToHex } from '../utils';

/**
 * main entry funciton for the task
 */
async function processWorkReports(
  context: AppContext,
  logger: Logger,
  isStopped: IsStopped,
) {
  const { api, database } = context;
  const workReportsOp = createWorkReportsToProcessOperator(database);
  let round = 1;

  do {
    if (isStopped()) {
      return;
    }

    //// TODO: Get a snapshot pending work reports count, otherwise the work-reports-indexer will add new work reports from every block
    //// The loop here may keep running.

    // Get 60 work reports per time
    // Right now there're around 1600 sworker nodes in the whole chain, 1600 work reports will be sent 
    // from the 10th to 399th block in one slot, that means 1600 wrs in 390 blocks, ~4 wrs/block
    // so if this processor task runs every 3 minutes, which contains around 30 blocks, which means there would be ~120 new wrs 
    // in the work-reports-to-process table, get 60 wrs per time will make the processor finish in two or three blocks
    const workReports = await workReportsOp.getPendingWorkReports(60);
    if (workReports.length === 0) {
      logger.info(`No more work reports to process, stop for a while.`);
      break;
    }
    logger.info(`Round ${round}: ${workReports.length} work reports to process.`);

    // -----------------------------------------------------------
    // 1. Aggregate all work reports to file replicas info
    const filesInfoMap = new Map<string, FileToUpdate>();
    for (const wr of workReports) {
      try {
        let { added_files, deleted_files } = wr;

        const added_files_array: [] = JSON.parse(added_files);
        const deleted_files_array: [] = JSON.parse(deleted_files);
        createFileReplicas(filesInfoMap, wr, added_files_array, true);
        createFileReplicas(filesInfoMap, wr, deleted_files_array, false);

        logger.info(`Work report (id: ${wr.id}) procossed success: new files - ${added_files_array.length}, deleted files - ${deleted_files_array.length}`);
      } catch (err) {
        logger.error(`Work report (id: ${wr.id}) processed failed. Error: ${err}`);
      }
    }

    logger.info(`filesInfoMap size: ${filesInfoMap.size}`);

    // ---------------------------------------------------------------
    // 2. Update the replicas data to Crust Mainnet Chain
    if (filesInfoMap.size > 0) {
      const result = await api.updateReplicas(filesInfoMap, workReports);
      let workReportIdsProcessed = workReports.map(wr => wr.id);
      if (result === true) {
        await workReportsOp.updateWorkReportRecordsStatus(workReportIdsProcessed, 'processed');
      }
      else {
        await workReportsOp.updateWorkReportRecordsStatus(workReportIdsProcessed, 'failed');
      }
    }

    // Wait for the next block to do next round, so we make sure at most one market::updateReplicas extrinsic call for one block
    await api.waitForNextBlock();
    round++;
  } while(true);
}

function createFileReplicas(filesInfoMap: Map<string, FileToUpdate>, wr: WorkReportsToProcessRecord, updated_files: [], is_added: boolean) {

  for (const newFile of updated_files) {
    const cid = newFile[0];
    const fileSize = newFile[1];
    const validAtSlot = newFile[2];

    let fileInfo: FileToUpdate = filesInfoMap.get(cid);

    if (!fileInfo) {
      fileInfo = {
        cid: cid,
        file_size: fileSize,
        replicas: [],
      };

      filesInfoMap.set(cid, fileInfo);
    }

    let fileReplica: ReplicaToUpdate = {
      reporter: stringToHex(wr.reporter),
      owner: stringToHex(wr.owner),
      sworker_anchor: wr.sworker_anchor,
      report_slot: wr.report_slot,
      report_block: wr.report_block,
      valid_at: validAtSlot,
      is_added: is_added,
    };

    fileInfo.replicas.push(fileReplica);
  }
          
}

export async function createWorkReportsProcessor(
  context: AppContext,
  loggerParent: Logger,
): Promise<SimpleTask> {
  // TODO: make it configurable
  const processInterval = 10 * 1000;  // default is 5 minutes
  return makeIntervalTask(
    5 * 1000,
    processInterval,
    'work-reports-processor',
    context,
    loggerParent,
    processWorkReports,
  );
}
