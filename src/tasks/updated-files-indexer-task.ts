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
import { createFileInfoV2Operator } from '../db/file-info-v2';
import { FileInfoV2 } from '../types/chain';

/**
 * main entry funciton for the task
 */
async function indexUpdatedFiles(
  context: AppContext,
  logger: Logger,
) { 
    try {
      const { api, database, config } = context;
      const updatedFilesOp = createUpdatedFilesToProcessOperator(database);
      const fileInfoV2Op = createFileInfoV2Operator(database);

      /// TODO: This should listen to events instead of get all entries every time
      /// 1. Get updated files to process from Crust Mainnet chain
      const updatedFilesMap = await api.getUpdatedFilesToProcess();

      /// 2. Retrieve FileInfoV2 from chain if not exist locally
      // 2.1 Extract the updated files cid from the map
      let cids = new Set<string>();
      for (const [_, updatedFiles] of updatedFilesMap) {
        for (const updatedFile of updatedFiles) {
          cids.add(updatedFile.cid);
        }
      }
      logger.info(`Updated files count: ${cids.size}`);

      // 2.2 Get the last spower update block from chain
      let lastSpowerUpdateBlock = await api.getLastSpowerUpdateBlock();
      if (lastSpowerUpdateBlock == 0) {
        lastSpowerUpdateBlock = config.chain.calculateFromBlock;
      }

      // 2.3 Get Non exist cids from file_info_v2 table
      const nonExistCids: string[] = await fileInfoV2Op.getNonExistCids([...cids], lastSpowerUpdateBlock);
      logger.info(`Non-exist cids count in file_info_v2 table: ${nonExistCids.length}`);

      // 2.4 Retreive FileInfoV2 data from chain
      const fileInfoV2Map: Map<string, FileInfoV2> = await api.getFilesInfoV2(nonExistCids, lastSpowerUpdateBlock);
      logger.info(`Get ${fileInfoV2Map.size} FileInfoV2 data from chain at block '${lastSpowerUpdateBlock}'`);
      
      /// 3 Add data to database
      // Add the updatedFilesMap to updated_files_to_process table
      const updatedFilesInsertCount = await updatedFilesOp.addUpdatedFiles(updatedFilesMap);
      logger.info(`Get ${updatedFilesMap.size} updated blocks of files from chain: New - ${updatedFilesInsertCount}, Existing: ${updatedFilesMap.size-updatedFilesInsertCount}`);

      // Add fileInfoV2Map to file_info_v2 table
      const fileInfoV2InsertCount = await fileInfoV2Op.add(fileInfoV2Map, lastSpowerUpdateBlock);
      logger.info(`Upsert ${fileInfoV2Map.size} files at block '${lastSpowerUpdateBlock}' to file_info_v2 table: New - ${fileInfoV2InsertCount}, Existing: ${fileInfoV2Map.size-fileInfoV2InsertCount}`);
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
