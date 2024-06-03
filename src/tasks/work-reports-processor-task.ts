/**
 * The work reports processor task to consolidate batch of work reports to file replicas data, 
 * and then update the replicas data to Crust Mainnet chain.
 */

import { Logger } from 'winston';
import { createWorkReportsToProcessOperator } from '../db/work-reports-to-process';
import { AppContext } from '../types/context';
import { SimpleTask } from '../types/tasks';
import { IsStopped, makeIntervalTask } from './task-utils';
import { FileToUpdate, ReplicaToUpdate, WorkReportsToProcess } from '../types/chain';
import { stringToHex } from '../utils';
import _ from 'lodash';

const defaultBatchSize = 15; // Batch size in blocks
/**
 * main entry funciton for the task
 */
async function processWorkReports(
  context: AppContext,
  logger: Logger,
  isStopped: IsStopped,
) {
  const { api, database, config } = context;
  const workReportsOp = createWorkReportsToProcessOperator(database);

  // The default blocks to process batch size is 15
  // Right now there're around 1600 sworker nodes in the whole chain, 1600 work reports will be sent 
  // from the 10th to 399th block in one slot, that means 1600 wrs in 390 blocks, average 4~5 wrs/block
  // 15 blocks will have around 75 work reports
  let batchSize = config.chain.workReportsProcesserBatchSize;
  if (_.isNil(batchSize) || batchSize <=0) {
    batchSize = defaultBatchSize;
  }
  let round = 1;

  do {
    if (isStopped()) {
      return;
    }

    const blocksOfWorkReports = await workReportsOp.getPendingWorkReports(batchSize);
    if (blocksOfWorkReports.length === 0) {
      logger.info(`No more work reports to process, stop for a while.`);
      break;
    }
    logger.info(`Round ${round}: ${blocksOfWorkReports.length} blocks of work reports to process.`);

    try {
      // -----------------------------------------------------------
      // 1. Aggregate all work reports to file replicas info
      const filesInfoMap = new Map<string, FileToUpdate>(); // Key is cid
      let recordIdsProcessed = [];
      let totalWorkReportsCount = 0;
      let totalReplicasCount = 0;
      for (const record of blocksOfWorkReports) {
        recordIdsProcessed.push(record.id);
        const workReports: WorkReportsToProcess[] = JSON.parse(record.work_reports) as WorkReportsToProcess[];
        for (const wr of workReports) {
          let { added_files, deleted_files } = wr;

          const added_files_array: [] = _.isNil(added_files) ? [] : added_files;
          const deleted_files_array: [] = _.isNil(deleted_files) ? [] : deleted_files;
          createFileReplicas(filesInfoMap, wr, added_files_array, true);
          createFileReplicas(filesInfoMap, wr, deleted_files_array, false);

          totalWorkReportsCount++;
          totalReplicasCount += added_files_array.length + deleted_files_array.length;
        }
      }
      logger.info(`Work reports count: ${totalWorkReportsCount}, Updated files count: ${filesInfoMap.size}, Updated Replicas count: ${totalReplicasCount}`);

      // ---------------------------------------------------------------
      // 2. Update the replicas data to Crust Mainnet Chain
      const result = await api.updateReplicas(filesInfoMap, _.last(blocksOfWorkReports).report_block);
      if (result === true) {
        await workReportsOp.updateStatus(recordIdsProcessed, 'processed');
      }
      else {
        await workReportsOp.updateStatus(recordIdsProcessed, 'failed');
      }
    } catch (err) {
      logger.error(`Work report processed failed. Error: ${err}`);
    }

    // Wait for the next block to do next round, so we make sure at most one market::updateReplicas extrinsic call for one block
    await api.waitForNextBlock();
    round++;
  } while(true);
}

function createFileReplicas(filesInfoMap: Map<string, FileToUpdate>, wr: WorkReportsToProcess, updated_files: [], is_added: boolean) {

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
