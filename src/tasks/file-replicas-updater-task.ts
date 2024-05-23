/**
 * The file replicas updater task to update file replicas in batch to Crust Mainnet chain
 */

import { Logger } from 'winston';
import { AppContext } from '../types/context';
import { SimpleTask } from '../types/tasks';
import { IsStopped, makeIntervalTask } from './task-utils';
import { FileReplicasToUpdateRecord } from '../types/database';
import { createFileReplicasToUpdateOperator } from '../db/file_replicas_to_update';

/**
 * main entry funciton for the task
 */
async function processFileReplicas(
  context: AppContext,
  logger: Logger,
  isStopped: IsStopped,
) {
    const { api, database } = context;
    const fileReplicasOp = createFileReplicasToUpdateOperator(database);
    let round = 1;

    do {
      if (isStopped()) {
        return;
      }

      // Get 500 files infos per time
      const fileInfos: FileReplicasToUpdateRecord[] = await fileReplicasOp.getPendingFileInfos(500);
      if (fileInfos.length === 0) {
        logger.info(`No more file replicas to update, stop for a while.`);
        break;
      }
      logger.info(`Round ${round}: ${fileInfos.length} files to process.`);

      // 1. Aggregate all file infos to a map with cid as key
      const filesInfoMap = new Map<string, FileReplicasToUpdateRecord>();
      const recordIdsProcessed = [];
      for (const fileInfo of fileInfos) {
        try {
          recordIdsProcessed.push(fileInfo.id);

          let fileInfoRecord: FileReplicasToUpdateRecord = filesInfoMap.get(fileInfo.cid);
          if (!fileInfoRecord) {
            filesInfoMap.set(fileInfo.cid, fileInfo);
            continue;
          }

          // Same cid exists, merge the file replicas
          const existingFileReplicas: [] = JSON.parse(fileInfoRecord.replicas);
          const additionalFileReplicas: [] =  JSON.parse(fileInfo.replicas);

          fileInfoRecord.replicas = JSON.stringify(existingFileReplicas.concat(additionalFileReplicas));
        } catch (err) {
          logger.error(`File info (id: ${fileInfo.id}) processed failed. Error: ${err}`);
        }
      }

      // 2. Send transaction
      logger.info(`filesInfoMap size: ${filesInfoMap.size}`);
      if (filesInfoMap.size > 0) {
        const result = await api.updateReplicas(filesInfoMap);
        if (result === true) {
            await fileReplicasOp.updateFileReplicasRecordsStatus(recordIdsProcessed, 'updated');
        } 
        else {
            await fileReplicasOp.updateFileReplicasRecordsStatus(recordIdsProcessed, 'failed');
        }
      }
      
      // Wait for the next block to do next round, so we make sure at most one market::updateReplicas extrinsic for one block
      await api.waitForNextBlock();

      round++;
    } while(true);
}

export async function createFileReplicasUpdater(
  context: AppContext,
  loggerParent: Logger,
): Promise<SimpleTask> {
  // TODO: make it configurable
  const processInterval = 10 * 1000;  // default is 5 minutes
  return makeIntervalTask(
    10 * 1000,
    processInterval,
    'file-replicas-updater',
    context,
    loggerParent,
    processFileReplicas,
  );
}
