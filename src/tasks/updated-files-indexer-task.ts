/**
 * The updated files indexer to get files with updated info and replicas from chain and store them into database 
 * The file-replicas-updater submits the 'market::update_replicas' extrinsic call, which will process and update 
 * corresponding files info and replicas data. These updated files will be indexed by this task and then be calculated
 * to generate real spower value
 */

import { Logger } from 'winston';
import { AppContext } from '../types/context';
import { SimpleTask } from '../types/tasks';
import { makeIntervalTask } from './task-utils';
import { createUpdatedFilesToProcessOperator } from '../db/updated-files-to-process';
import { createFileInfoV2ToIndexOperator } from '../db/file-info-v2-to-index';

/**
 * main entry funciton for the task
 */
async function indexUpdatedFiles(
  context: AppContext,
  logger: Logger,
) { 
    try {
      const api = context.api;
      const { database } = context;
      const updatedFilesOp = createUpdatedFilesToProcessOperator(database);
      const toIndexFilesOp = createFileInfoV2ToIndexOperator(database);

      // TODO: This should listen to events instead of get all entries every time
      // Get updated files to process from Crust Mainnet chain
      const updatedFilesMap = await api.getUpdatedFilesToProcess();

      // Extract the updated files cid from the map
      let fileInfoV2ToIndexMap = new Map<string, Set<number>>();
      for (const [updateBlock, updatedFiles] of updatedFilesMap) {
        for (const updatedFile of updatedFiles) {
          let updateBlocks = fileInfoV2ToIndexMap.get(updatedFile.cid);
          if (!updateBlocks) {
            updateBlocks = new Set<number>();
            fileInfoV2ToIndexMap.set(updatedFile.cid, updateBlocks);
          }
          updateBlocks.add(updateBlock);
        }
      }

      /// ---------------------------------------------------------------
      /// TODO: Put the following two db operations into one transaction
      // Add the updated files map to updated_files_to_process table
      const insertRecordsCount = await updatedFilesOp.addUpdatedFiles(updatedFilesMap);
      logger.info(`Get ${updatedFilesMap.size} updated files from chain: New - ${insertRecordsCount}, Existing: ${updatedFilesMap.size-insertRecordsCount}`);

      // Add the updated files cids to file_info_v2_to_index table
      const insertToIndexFilesCount = await toIndexFilesOp.addToIndexFiles(fileInfoV2ToIndexMap);
      logger.info(`Get ${fileInfoV2ToIndexMap.size} files to index from chain: New - ${insertToIndexFilesCount}, Existing: ${fileInfoV2ToIndexMap.size-insertToIndexFilesCount}`);
    } catch (err) {
      logger.error(`💥 Error to index work reports: ${err}`);
    } 
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
