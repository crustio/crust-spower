/**
 * The updated files indexer to get files with updated info and replicas from chain and store them into database 
 * The file-replicas-updater submits the 'market::update_replicas' extrinsic call, which will process and update 
 * corresponding files info and replicas data. These updated files will be indexed by this task and then be calculated
 * to generate real spower value
 */

import { Logger } from 'winston';
import { AppContext } from '../types/context';
import { SimpleTask } from '../types/tasks';
import { IsStopped, makeIntervalTask } from './task-utils';
import { createUpdatedFilesToProcessOperator } from '../db/updated-files-to-process';
import { createFileInfoV2Operator } from '../db/files-info-v2';
import { FileInfoV2, UpdatedFileToProcess } from '../types/chain';
import { createConfigOps } from '../db/configs';
import _ from 'lodash';
import { Dayjs } from '../utils/datetime';
import { MaxNoNewBlockDuration } from '../main';
import Bluebird from 'bluebird';

const KeyLastProcessedBlockUpdatedFiles = 'updated-files-indexer:last-processed-block';
const KeyAccumulateUnProcessedBlockCount = 'updated-files-indexer:accumulate-unprocessed-block-count';
const defaultSpowerCalculateBatchSize = 3; // Batch size in blocks
/**
 * main entry funciton for the task
 */
async function indexUpdatedFiles(
  context: AppContext,
  logger: Logger,
  isStopped: IsStopped
) { 
  const { api, database, config } = context;
  const updatedFilesOp = createUpdatedFilesToProcessOperator(database);
  const fileInfoV2Op = createFileInfoV2Operator(database);
  const configOp = createConfigOps(database);
  
  // Get the last processed block
  let lastProcessedBlock: number = await configOp.readInt(KeyLastProcessedBlockUpdatedFiles);
  if (_.isNil(lastProcessedBlock) || lastProcessedBlock === 0) {
    logger.info(`No '${KeyLastProcessedBlockUpdatedFiles}' config found in DB, this is the first run, get the value from chain.`);
    lastProcessedBlock = await api.getLastProcessedBlockUpdatedFiles() as number;
    if (_.isNil(lastProcessedBlock) || lastProcessedBlock === 0) {
      logger.info(`No updated files to process on chain yet, stop for a while.`);
      return;
    }

    // Save the retrieved value to DB
    configOp.saveInt(KeyLastProcessedBlockUpdatedFiles, lastProcessedBlock);
  }
  logger.info(`Last processed block of updated files: ${lastProcessedBlock}`);

  // Get the accumulate unprocessed block count
  let accumulateBlockCount = await configOp.readInt(KeyAccumulateUnProcessedBlockCount);
  if (_.isNil(KeyAccumulateUnProcessedBlockCount)) {
    accumulateBlockCount = 0;
    configOp.saveInt(KeyAccumulateUnProcessedBlockCount, accumulateBlockCount);
  }
  let spowerCalculateBatchSize = config.chain.spowerCalculateBatchSize;
  if (_.isNil(spowerCalculateBatchSize) || spowerCalculateBatchSize == 0) {
    spowerCalculateBatchSize = defaultSpowerCalculateBatchSize;
  }

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

    // Iterate every block to get the updated files to process
    try {
      for (let block = lastProcessedBlock + 1; block <= curBlock; block++) {
        // Get work reports to process from chain at the specific block
        const updatedFilesToProcess: Map<string, UpdatedFileToProcess> = await api.getUpdatedFilesToProcess(block);

        /// -------------------------------------------------------
        /// TODO: Also retrieve FileInfoV2 data if this block is the 400th block at the report slot
        if (updatedFilesToProcess.size > 0) {
          let isFileInfoV2Retrieved = false;
          accumulateBlockCount++;
          if (accumulateBlockCount >= spowerCalculateBatchSize) {
            /// Retrieve FileInfoV2 from chain if the accumulateBlockCount of this round meet the spowerCalculateBatchSize
            // Extract the updated files cid from the map
            let cids = updatedFilesToProcess.keys();

            // Get Non exist cids from file_info_v2 table
            const nonExistCids: string[] = await fileInfoV2Op.getNonExistCids([...cids], block);
            logger.info(`Non-exist cids count in file_info_v2 table: ${nonExistCids.length}`);

            // Retreive FileInfoV2 data from chain
            const fileInfoV2Map: Map<string, FileInfoV2> = await api.getFilesInfoV2(nonExistCids, block);
            logger.info(`Get ${fileInfoV2Map.size} FileInfoV2 data from chain at block '${block}'`);

            // Add fileInfoV2Map to file_info_v2 table
            const fileInfoV2InsertCount = await fileInfoV2Op.add(fileInfoV2Map, block);
            logger.info(`Upsert ${fileInfoV2Map.size} files at block '${block}' to file_info_v2 table: New - ${fileInfoV2InsertCount}, Existing: ${fileInfoV2Map.size-fileInfoV2InsertCount}`);

            // Reset counter to start from 0 and set the flag to true
            accumulateBlockCount = 0;
            isFileInfoV2Retrieved = true;
          }
          
          // Add the updatedFilesMap to updated_files_to_process table
          const insertRecordsCount = await updatedFilesOp.addUpdatedFiles(block, isFileInfoV2Retrieved, updatedFilesToProcess);
          logger.info(`Insert updated files at block '${block}' to db, insert records count: ${insertRecordsCount}`);

          // Save the accumulateBlockCount value to DB
          configOp.saveInt(KeyAccumulateUnProcessedBlockCount, accumulateBlockCount);
        }
        
        // Update the last processed block
        lastProcessedBlock = block;
        configOp.saveInt(KeyLastProcessedBlockUpdatedFiles, lastProcessedBlock);
      }
    } catch (err) {
      logger.error(`💥 Error to index updated files: ${err}`);
    } 

    // Sleep a while for next round
    await Bluebird.delay(1 * 1000);

  } while(true);
}

export async function createUpdatedFilesIndexer(
  context: AppContext,
  loggerParent: Logger,
): Promise<SimpleTask> {
  // TODO: make it configurable
  const processInterval = 10 * 1000;  // default is 5 minutes
  return makeIntervalTask(
    1 * 1000,
    processInterval,
    'updated-files-indexer',
    context,
    loggerParent,
    indexUpdatedFiles,
  );
}
