/**
 * The files-v2-indexer is to sync with the market.FilesV2 storage from chain
 */

import { Logger } from 'winston';
import { AppContext } from '../types/context';
import { SimpleTask } from '../types/tasks';
import { IsStopped, makeIntervalTask } from './task-utils';
import { createConfigOps } from '../db/configs';
import _ from 'lodash';
import { Dayjs } from '../utils/datetime';
import { MaxNoNewBlockDuration } from '../main';
import Bluebird from 'bluebird';
import { createFilesV2Operator } from '../db/files-v2';
import { MarketFilesV2StorageKey } from '../utils/consts';
import { cidFromStorageKey, stringifyEx } from '../utils';

enum IndexMode {
  IndexAll = 'index-all',
  IndexChanged = 'index-changed',
}

const KeyIndexMode = 'files-v2-indexer:index-mode';
const KeyIndexAllAtBlock = 'files-v2-indexer:index-all-at-block';
const KeyIndexAllLastIndexKey = 'files-v2-indexer:index-all-last-index-key';
export const KeyIndexChangedLastIndexBlock = 'files-v2-indexer:index-changed-last-index-block';
export const KeyIndexChangedLastSyncBlock = 'files-v2-indexer:index-changed-last-sync-block'

/**
 * main entry funciton for the task
 */
async function indexFilesV2(
  context: AppContext,
  logger: Logger,
  isStopped: IsStopped
) {
 
  const { database } = context;
  const configOp = createConfigOps(database);

  while (!isStopped()) {
    try {
        await Bluebird.delay(3 * 1000);

        let indexMode = await configOp.readString(KeyIndexMode) as IndexMode;
        if (_.isNil(indexMode) || _.isEmpty(indexMode)) {
          logger.info(`No '${KeyIndexMode}' config found in DB, this is the first run, set index mode to 'index-all'`);
          indexMode = IndexMode.IndexAll;
          configOp.saveString(KeyIndexMode, indexMode);
        }

        if (indexMode == IndexMode.IndexAll) {
          await indexAll(context, logger, isStopped);
        } else {
          await indexChanged(context, logger, isStopped);
        }
    } catch(err) {
        logger.error(`💥 Error to index FilesV2 data: ${err}`);
    }
  }
}

async function indexAll(
  context: AppContext,
  logger: Logger,
  isStopped: IsStopped
) {
  const { api, database, config } = context;
  const configOp = createConfigOps(database);
  
  // Get index block from config
  let indexAtBlock = await configOp.readInt(KeyIndexAllAtBlock);
  if (_.isNil(indexAtBlock) || indexAtBlock === 0) {
    logger.info(`No '${KeyIndexAllAtBlock}' config found in DB, this is the first run, get the value from chain.`);

    // Get the swork.LastSpowerUpdateBlock as the indexAtBlock
    indexAtBlock = await api.getLastSpowerUpdateBlock() as number;
    if (_.isNil(indexAtBlock) || indexAtBlock === 0) {
      logger.info(`swork.LastSpowerUpdateBlock is not set on chain yet, use the current latest block as the index block.`);
      indexAtBlock = await api.latestFinalizedBlock();
    }

    // Save the retrieved value to DB
    configOp.saveInt(KeyIndexAllAtBlock, indexAtBlock);
  }
  logger.info(`Start to index all at block '${indexAtBlock}'`);
  const indexAtBlockHash = await api.getBlockHash(indexAtBlock);

  // Get last index key from config
  let lastIndexedKey = await configOp.readString(KeyIndexAllLastIndexKey);
  if (_.isNil(lastIndexedKey) || _.isEmpty(lastIndexedKey)) {
    logger.info('Last index key is empty, index from beginning');
  } else {
    logger.info(`Last index key is '${lastIndexedKey}'`);
  }

  // Get index batch size
  const indexBatchSize = config.chain.filesV2IndexAllKeyBatchSize;

  let round = 1;
  while (!isStopped()) {
    try {
        // Wait a while
        await Bluebird.delay(500);
        round++;

        await api.ensureConnection();
        const curBlock = api.latestFinalizedBlock();
        
        // Get storage keys in batch by lastIndexedKey
        if (_.isEmpty(lastIndexedKey)) {
          lastIndexedKey = MarketFilesV2StorageKey;
        }
        const keys = await api.chainApi().rpc.state.getKeysPaged(MarketFilesV2StorageKey, indexBatchSize, lastIndexedKey, indexAtBlockHash);

        // Convert the key to CID
        const cids = [];
        let newLastIndexedKey = null;
        for (const storageKey of keys) {
            const key = storageKey.toString();
            if (key !== lastIndexedKey) {
                const cid = cidFromStorageKey(key);
                if (!_.isNil(cid)) {
                    cids.push(cid);
                    newLastIndexedKey = key;
                }
            }
        }

        if (_.isEmpty(cids)) {
            logger.info('No pending cids to index from db, mark indexing as done');

            // Set the index mode to IndexChanged and set the indexAtBlock as the index-changed-last-index-block
            await configOp.saveString(KeyIndexAllLastIndexKey, '');
            await configOp.saveString(KeyIndexMode, IndexMode.IndexChanged);
            await configOp.saveInt(KeyIndexChangedLastIndexBlock, indexAtBlock);
            
            break;
        }
        logger.info(`Round ${round} - Got ${cids.length} cids to process`);

        // Sync the FilesV2 data from chain
        await syncFilesV2Data(cids, indexAtBlock, curBlock, context, logger);

        // Save the last indexed key
        lastIndexedKey = newLastIndexedKey;
        await configOp.saveString(KeyIndexAllLastIndexKey, newLastIndexedKey);

    } catch (err) {
        logger.error(`💥 Error to index all market.FilesV2 data: ${err}`);
    }
  }
}

async function indexChanged(
  context: AppContext,
  logger: Logger,
  isStopped: IsStopped
) {
    const { api, database, config } = context;
    const filesV2Op = createFilesV2Operator(database);
    const configOp = createConfigOps(database);
    const filesV2SyncBatchSize = config.chain.filesV2SyncBatchSize;
    const filesV2IndexChangedSyncInterval = config.chain.filesV2IndexChangedSyncInterval;
    
    // Get the last index block
    let lastIndexBlock = await configOp.readInt(KeyIndexChangedLastIndexBlock);
    if (_.isNil(lastIndexBlock) || lastIndexBlock == 0) {
        logger.error(`No '${KeyIndexChangedLastIndexBlock}' config found in DB, should not enter IndexChanged mode`);
        return;
    }
    logger.info(`Last index block of market.FilesV2 data: ${lastIndexBlock}`);

    let lastBlockTime = Dayjs();
    while(!isStopped()) {
        try {
            // Sleep a while for next round
            await Bluebird.delay(1 * 1000);

            await api.ensureConnection();
            const curBlock = api.latestFinalizedBlock();
            if (lastIndexBlock >= curBlock) {
                const now = Dayjs();
                const diff = Dayjs.duration(now.diff(lastBlockTime));
                if (diff.asSeconds() > MaxNoNewBlockDuration.asSeconds()) {
                    logger.error('No new block for %d seconds, please check RPC node!', diff.asSeconds());
                    /// TODO: Trigger an alert to monitoring system
                    throw new Error('block not updating');
                }
                
                await Bluebird.delay(3 * 1000);
                continue;
            }
            lastBlockTime = Dayjs();

            // Iterate every block to get the updated files to process
            logger.info(`Index files-v2 data from block '${lastIndexBlock+1}' to '${curBlock}'`);
            for (let block = lastIndexBlock + 1; block <= curBlock; block++) {
                if (isStopped())
                    return;
                // Get replicas updated files from chain at the specific block
                const updatedFilesCids = await api.getReplicasUpdatedFiles(block);
                if (!_.isEmpty(updatedFilesCids)) {
                    const [insertCount, updateCount] = await filesV2Op.upsertNeedSync(updatedFilesCids);
                    logger.info(`UpsertNeedSync: upsert ${updatedFilesCids.length} files as changed at block '${block}' to files_v2 table: New - ${insertCount}, Update: ${updateCount}`);
                }
                
                // Get closed files from chain at the specific block
                const closedFilesCids = await api.getClosedFiles(block);
                if (!_.isEmpty(closedFilesCids)) {
                    const updateCount = await filesV2Op.setIsClosed(closedFilesCids, curBlock);
                    logger.info(`SetIsClosed: set ${closedFilesCids.length} files as closed{ at block '${block}' to files_v2 table: Update - ${updateCount}`);
                }
                
                // Update the last index block
                lastIndexBlock = block;
                configOp.saveInt(KeyIndexChangedLastIndexBlock, block);

                // Do the actual FilesV2 data sync every configure interval
                if (block % filesV2IndexChangedSyncInterval == 0) {
                  logger.info(`Sync FilesV2 data at block '${block}'`);
                  do {
                    if (isStopped())
                        return;

                    const needSyncCids = await filesV2Op.getNeedSync(filesV2SyncBatchSize);
                    if (_.isEmpty(needSyncCids))
                        break;

                    const syncedCids = await syncFilesV2Data(needSyncCids, block, curBlock, context, logger);

                    // The difference between needSyncCids and syncedCids is the closed files
                    // First IllegalFileClosed event already remove the file from chain, sworker listens to this event and
                    // delete the file locally and report works as deleted_files, which would then be upsert into files_v2 table
                    // as need_sync=1 again, so we need to mark them as closed here
                    const closedCids = _.difference(needSyncCids, syncedCids);
                    if (!_.isEmpty(closedCids)) {
                      await filesV2Op.setIsClosed(closedCids, curBlock);
                    }
                  }while(true);

                  // Update the last sync block
                  configOp.saveInt(KeyIndexChangedLastSyncBlock, block);
                }
            }
        } catch (err) {
            logger.error(`💥 Error to index updated files: ${err}`);
        } 
    }
}

async function syncFilesV2Data(cids: string[], atBlock: number, curBlock: number, context: AppContext, logger: Logger): Promise<string[]> {
    const { api, database, config } = context;
    const filesV2Op = createFilesV2Operator(database);

    if (!_.isEmpty(cids)) {
        // Get the detailed FileInfoV2 data from chain for the cids array
        const fileInfoV2Map = await api.getFilesInfoV2(cids, atBlock);
        logger.debug(`Get ${fileInfoV2Map.size} FileInfoV2 data from chain at block '${atBlock}'`);

        // Construct the batch toUpsertRecords
        const toUpsertRecords = [];
        for (const [cid, fileInfo] of fileInfoV2Map) {
          // Calculate the next_spower_update_block for non-expired files
          // The next_spower_update_block is the minimum create_at block + SpowerDelayPeriod
          let nextSpowerUpdateBlock = null;
          if (!_.isNil(fileInfo) && !_.isEmpty(fileInfo.replicas) && fileInfo.expired_at > curBlock) {
            let minimumCreateAtBlock: number = Number.MAX_VALUE;
            for (const [_owner,replica] of fileInfo.replicas) {
              let createdAt = replica.created_at as any;
              if (!_.isNil(createdAt) && !createdAt.isEmpty) {
                createdAt = parseInt(createdAt);
                if (createdAt < minimumCreateAtBlock) {
                  minimumCreateAtBlock = createdAt;
                } 
              } else {
                minimumCreateAtBlock = 0;
              }
            }

            if (minimumCreateAtBlock == 0) {
              nextSpowerUpdateBlock = curBlock;
            } else {
              nextSpowerUpdateBlock = minimumCreateAtBlock + config.chain.spowerReadyPeriod as number;
            }
          }

          toUpsertRecords.push({
            cid,
            file_info: stringifyEx(fileInfo),
            last_sync_block: atBlock,
            last_sync_time: new Date(),
            need_sync: false,
            is_closed: false,
            next_spower_update_block: nextSpowerUpdateBlock
          });
        }

        // Upsert to files_v2 table
        const existCids = await filesV2Op.getExistingCids(cids);
        const upsertFields = ['file_info', 'last_sync_block', 'last_sync_time', 'need_sync', 'is_closed', 'next_spower_update_block']
        const affectedRows = await filesV2Op.upsertRecords(toUpsertRecords, upsertFields);
        
        logger.info(`Upsert ${fileInfoV2Map.size} files at block '${atBlock}' to files_v2 table: New - ${affectedRows - existCids.length}, Update: ${existCids.length}`);

        // Return the actual synced cids list
        return [...fileInfoV2Map.keys()];
    }

    return [];
}

export async function createFilesV2Indexer(
  context: AppContext,
  loggerParent: Logger,
): Promise<SimpleTask> {
  // TODO: make it configurable
  const processInterval = 10 * 1000;
  return makeIntervalTask(
    3 * 1000,
    processInterval,
    'files-v2-indexer',
    context,
    loggerParent,
    indexFilesV2,
  );
}
