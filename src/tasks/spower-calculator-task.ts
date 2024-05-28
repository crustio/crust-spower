/**
 * The spower-calculator task to calculate the spower for updated files and their related sworkers
 */

import { Logger } from 'winston';
import { AppContext } from '../types/context';
import { SimpleTask } from '../types/tasks';
import { IsStopped, makeIntervalTask } from './task-utils';
import { WorkReportsToProcessRecord } from '../types/database';
import { FileToUpdate, ReplicaToUpdate, UpdatedFileToProcess } from '../types/chain';
import Bluebird from 'bluebird';
import { stringToHex } from '../utils';
import { createUpdatedFilesToProcessOperator } from '../db/updated-files-to-process';
import { createFileInfoV2Operator } from '../db/file-info-v2';
import { createConfigOps } from '../db/configs';
import { KeyLastSuccessFileInfoV2IndexBlock } from './file-info-v2-indexer-task';
import { FileInfoV2 } from '../chain';


export const KeyLastSuccessSpowerCalculateBlock = 'spower-calculator:last-success-spower-calculate-block';

// interface FileInfoForSpower {
//   cid: string;
//   file_size: bigint;
//   current_spower: bigint;
//   new_spower: bigint;
//   reported_replica_count: number;
//   replicas:
// }

interface SWorkerChangedFileSpower {
  cid: string;
  is_added: boolean;
  changed_spower: bigint;
}
/**
 * main entry funciton for the task
 */
async function calculateSpower(
  context: AppContext,
  logger: Logger,
  isStopped: IsStopped,
) {
    const { database } = context;
    const updatedFilesOp = createUpdatedFilesToProcessOperator(database);
    const fileInfoV2Op = createFileInfoV2Operator(database);
    const configOps = createConfigOps(database);
    let round = 1;

    do {
      if (isStopped()) {
        return;
      }

      // Get the last success index block from file-info-v2-indexer
      let lastSuccessFileInfoV2IndexBlock = await configOps.readInt(KeyLastSuccessFileInfoV2IndexBlock);
      if (!lastSuccessFileInfoV2IndexBlock) {
        logger.info('can not get last success file info v2 index block from db, skip this round');
        break;
      }
      // Get the last success spower calculate block from this task
      let lastSuccessSpowerCalculateBlock = await configOps.readInt(KeyLastSuccessSpowerCalculateBlock);
      if (!lastSuccessSpowerCalculateBlock) {
        lastSuccessSpowerCalculateBlock = 0; // This maybe the first run, set to 0
      }

      // Get 50 blocks of updated files per time
      const updatedBlocksOfFiles = await updatedFilesOp.getPendingUpdatedFilesByBlock(50, lastSuccessFileInfoV2IndexBlock);
      if (updatedBlocksOfFiles.length === 0) {
        logger.info(`No more updated blocks to process, stop for a while.`);
        break;
      }
      logger.info(`Round ${round}: ${updatedBlocksOfFiles.length} updated blocks to process.`);

      // 1. Extrace all the updated files and their updated replicas
      logger.debug(`1. Extrace all the updated files and their updated replicas.`);
      let updatedFilesMap = new Map<string, UpdatedFileToProcess>();
      for (const record of updatedBlocksOfFiles) {
        let fileInfo = updatedFilesMap.get(record.cid);
        if (!fileInfo) {
          fileInfo = {
            cid: record.cid,
            actual_added_replicas: [],
            actual_deleted_replicas: []
          };
          updatedFilesMap.set(record.cid, fileInfo);
        }

        fileInfo.actual_added_replicas.push(...JSON.parse(record.actual_added_replicas));
        fileInfo.actual_deleted_replicas.push(...JSON.parse(record.actual_deleted_replicas));
      }
      logger.debug(`updatedFilesMap size: ${updatedFilesMap.size}`);

      // 2. Get the filesInfoV2 data
      logger.debug(`2. Get the filesInfoV2 data`);
      let fileInfoV2Map = new Map<string, FileInfoV2>();
      const cidList = Array.from(updatedFilesMap.keys());
      const batchSize = 500;
      for (let i = 0; i < cidList.length; i += batchSize) {
        const cids = cidList.slice(i, i + batchSize);
        // Query the file_info_v2 table in batch
        const fileInfoV2List = await fileInfoV2Op.getByCids(cids, lastSuccessSpowerCalculateBlock, lastSuccessFileInfoV2IndexBlock);

        for (const record of fileInfoV2List){
          let fileInfoV2: FileInfoV2 = JSON.parse(record.file_info) as FileInfoV2;
          fileInfoV2Map.set(record.cid, fileInfoV2);
        }
      }
     
      // 3. Calculate the new spower for all the updated files

      // 4. Construct the Sworker -> FileInfoForSpower map
      let sworkerUpdatedFilesMap = new Map<string, SWorkerChangedFileSpower>();
      for (const [updateBlock, updatedFiles] of updatedBlocksOfFiles) {

      }

      // 5. Caculate the Sworker changed spower

      // 6. Update related status
      configOps.saveInt(KeyLastSuccessSpowerCalculateBlock, lastSuccessFileInfoV2IndexBlock);

      // 1. Aggregate all work reports to file replicas info
      const filesInfoMap = new Map<string, FileToUpdate>();
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
      await Bluebird.delay(1000); // wait for a while to do next round
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

export async function createSpowerCalculator(
  context: AppContext,
  loggerParent: Logger,
): Promise<SimpleTask> {
  // TODO: make it configurable
  const processInterval = 10 * 1000;  // default is 5 minutes
  return makeIntervalTask(
    5 * 1000,
    processInterval,
    'spower-calculator',
    context,
    loggerParent,
    calculateSpower,
  );
}