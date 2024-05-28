/**
 * The file-info-v2-indexer task to get the specific CIDs' FileInfoV2 data from Crust Mainnet chain
 */

import { Logger } from 'winston';
import { AppContext } from '../types/context';
import { SimpleTask } from '../types/tasks';
import { IsStopped, makeIntervalTask } from './task-utils';
import { createFileInfoV2ToIndexOperator } from '../db/file-info-v2-to-index';
import Bluebird from 'bluebird';
import { createFileInfoV2Operator } from '../db/file-info-v2';
import { createConfigOps } from '../db/configs';

export const KeyLastSuccessFileInfoV2IndexBlock = 'file-info-v2-indexer:last-success-index-block';

/**
 * main entry funciton for the task
 */
async function indexFileInfoV2(
  context: AppContext,
  logger: Logger,
  isStopped: IsStopped,
) { 
  const { api, database } = context;
  const toIndexFilesOp = createFileInfoV2ToIndexOperator(database);
  const fileInfoV2Op = createFileInfoV2Operator(database);
  let round = 1;
  // Get the data from the current latest block
  const latestBlock = api.latestFinalizedBlock();

  do {
    if (isStopped()) {
      return;
    }
    
    try {
      // Get 100 cids per batch
      const cids = await toIndexFilesOp.getPendingToIndexFileCids(100, latestBlock);
      
      if (!cids || cids.length === 0) {
        logger.info(`No more files to index, stop for a while.`);
        break;
      }
      logger.info(`Round ${round}: ${cids.length} files to index.`);

      // Get the detail FileInfoV2 data from Crust Mainnet chain
      const filesInfoV2Map = await api.getFilesInfoV2(cids, latestBlock);

      if (fileInfoV2Op) {
        // Add to file_info_v2 table and update the index table status in a transaction
        // PS: If partial cids data are not able to retrieve, it means those CIDs have been removed on chain, we just mark all cids[] as processed
        await fileInfoV2Op.addFilesInfoV2AndUpdateIndexStatus(filesInfoV2Map, cids, latestBlock);
      } else {
        toIndexFilesOp.updateRecordsStatus(cids, latestBlock, 'processed');
      }
    } catch (err) {
      logger.error(`💥 Error to index file_info_v2 from chain: ${err}`);
    }

    await Bluebird.delay(1000); // wait for a while to do next round
    round++;
  } while(true);

  // Save the successfully indexed 'latestBlock' to db
  const configOps = createConfigOps(database);
  await configOps.saveInt(KeyLastSuccessFileInfoV2IndexBlock,latestBlock);
}

export async function createUpdatedFilesIndexer(
  context: AppContext,
  loggerParent: Logger,
): Promise<SimpleTask> {
  // TODO: make it configurable
  const processInterval = 20 * 1000;  // default is 5 minutes
  return makeIntervalTask(
    10 * 1000,
    processInterval,
    'file-info-v2-indexer',
    context,
    loggerParent,
    indexFileInfoV2,
  );
}
