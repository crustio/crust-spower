/**
 * The work reports processor task to consolidate batch of work reports to file replicas data
 */

import { Logger } from 'winston';
import { createWorkReportsToProcessOperator } from '../db/work-reports-to-process';
import { AppContext } from '../types/context';
import { SimpleTask } from '../types/tasks';
import { IsStopped, makeIntervalTask } from './task-utils';
import { WorkReportsToProcessRecord } from '../types/database';
import { FileInfo, ReplicaInfo } from '../types/chain';
import { createFileReplicasToUpdateOperator } from '../db/file_replicas_to_update';
import Bluebird from 'bluebird';
import { stringToHex } from '../utils';

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
    const fileReplicasOp = createFileReplicasToUpdateOperator(database);
    let round = 1;

    do {
      if (isStopped()) {
        return;
      }

      // Get 100 work reports per time
      const workReports = await workReportsOp.getPendingWorkReports(100);
      if (workReports.length === 0) {
        logger.info(`No more work reports to process, stop for a while.`);
        break;
      }
      logger.info(`Round ${round}: ${workReports.length} work reports to process.`);

      // 1. Aggregate all work reports to file replicas info
      const filesInfoMap = new Map<string, FileInfo>();
      const workReportsProcessed = [];
      for (const wr of workReports) {
        try {
          let { added_files, deleted_files } = wr;

          const added_files_array: [] = JSON.parse(added_files);
          const deleted_files_array: [] = JSON.parse(deleted_files);
          createFileReplicas(filesInfoMap, wr, added_files_array, true);
          createFileReplicas(filesInfoMap, wr, deleted_files_array, false);

          workReportsProcessed.push(wr.id);
          logger.info(`Work report (id: ${wr.id}) procossed success: new files - ${added_files_array.length}, deleted files - ${deleted_files_array.length}`);
        } catch (err) {
          logger.error(`Work report (id: ${wr.id}) processed failed. Error: ${err}`);
        }
      }

      logger.info(`filesInfoMap size: ${filesInfoMap.size}`);
      // 2. Add file replicas info to database and update work report process status, they need to be in a single transaction
      await fileReplicasOp.addFileReplicasAndUpdateWorkReports(filesInfoMap, workReportsProcessed);

      round++;
      await Bluebird.delay(5 * 1000); // wait for a while to do next round
    } while(true);
}

function createFileReplicas(filesInfoMap: Map<string, FileInfo>, wr: WorkReportsToProcessRecord, updated_files: [], is_added: boolean) {

  for (const newFile of updated_files) {
    const cid = newFile[0];
    const fileSize = newFile[1];
    const validAtSlot = newFile[2];

    let fileInfo: FileInfo = filesInfoMap.get(cid);

    if (!fileInfo) {
      fileInfo = {
        cid: cid,
        file_size: fileSize,
        replicas: [],
      };

      filesInfoMap.set(cid, fileInfo);
    }

    let fileReplica: ReplicaInfo = {
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
