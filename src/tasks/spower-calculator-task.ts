/**
 * The spower-calculator task to calculate the spower for updated files and their related sworkers
 */

import { Logger } from 'winston';
import { AppContext } from '../types/context';
import { SimpleTask } from '../types/tasks';
import { IsStopped, makeIntervalTask } from './task-utils';
import { ChangedFileInfo, FileInfoV2, Replica } from '../types/chain';
import _ from 'lodash';
import Bluebird from 'bluebird';
import { createFilesV2Operator } from '../db/files-v2';
import { createConfigOps } from '../db/configs';
import { KeyIndexChangedLastIndexBlock } from './files-v2-indexer-task';
import { convertBlockNumberToReportSlot } from '../utils';
import { FilesV2Record } from '../types/database';
import { REPORT_SLOT, SPOWER_UPDATE_END_OFFSET, SPOWER_UPDATE_START_OFFSET } from '../utils/consts';

const KeyLastSpowerUpdateBlock = 'spower-calculator-task:last-spower-update-block';
const KeyUpdatingRecords = 'spower-calculator-task:updating-records';

interface UpdatingRecords {
  toDeleteCids: string[];
  toUpdateRecords: FilesV2Record[];
}

/**
 * main entry funciton for the task
 */
async function calculateSpower(
  context: AppContext,
  logger: Logger,
  isStopped: IsStopped,
) {
    const { api, database, config } = context;
    const filesV2Op = createFilesV2Operator(database);
    const configOp = createConfigOps(database);
    const spowerReadyPeriod = config.chain.spowerReadyPeriod;
    const spowerCalculateBatchSize = config.chain.spowerCalculateBatchSize;
    let round = 0;

    while(!isStopped()) {
      try { 
        // Sleep a while
        await Bluebird.delay(1 * 1000);

        // Ensure connection and get the lastest finalized block
        await api.ensureConnection();
        const curBlock: number = api.latestFinalizedBlock();

        // Only run the spower calculate within the 400th and 489th block of this slot
        // The reason for end block 490 is to give the final round some time to calculate and update the spower on chain
        // The pallet_swork would do the workload consolidation starting from 500th block in the lost
        const blockInSlot = curBlock % REPORT_SLOT;
        if (blockInSlot < SPOWER_UPDATE_START_OFFSET || blockInSlot > SPOWER_UPDATE_END_OFFSET) {
          logger.info(`Not in the spower calculate block range, blockInSlot: ${blockInSlot}, keep waiting..`);

          let waitTime = 6000;
          if (blockInSlot < SPOWER_UPDATE_START_OFFSET) {
            waitTime = (SPOWER_UPDATE_START_OFFSET - blockInSlot) * 6 * 1000;
          } else {
            waitTime = (REPORT_SLOT - blockInSlot + SPOWER_UPDATE_START_OFFSET) * 6 * 1000;
            // Reset the round counter
            round = 0;
          }

          await Bluebird.delay(waitTime);
          continue;
        }

        // Make sure the files-v2-indexer has reached to the latest block, to avoid race condition to update file_info
        // between files-v2-indexer and spower-calculator
        // This logic has the assumption that work-reports-processor do NOT update replicas within the 400th and 499th block of this slot
        let lastFilesV2IndexBlock = await configOp.readInt(KeyIndexChangedLastIndexBlock);
        const lastFilesV2SyncSlot = convertBlockNumberToReportSlot(lastFilesV2IndexBlock);
        const curBlockSlot = convertBlockNumberToReportSlot(curBlock);
        if (_.isNil(lastFilesV2IndexBlock) 
          || lastFilesV2IndexBlock == 0 
          || lastFilesV2SyncSlot < curBlockSlot 
          || (lastFilesV2IndexBlock % REPORT_SLOT) < SPOWER_UPDATE_START_OFFSET) {
            logger.info(`files-v2-indexer is still catching up the progress, wait a while`);
            await Bluebird.delay(6 * 1000);
            continue;
        }
 
        // Get the last spower update block from config
        let lastSpowerUpdateBlock = await configOp.readInt(KeyLastSpowerUpdateBlock);
        if (_.isNil(lastSpowerUpdateBlock)) {
          logger.info(`No '${KeyLastSpowerUpdateBlock}' config found in DB, get it from chain`);
          lastSpowerUpdateBlock = await api.getLastSpowerUpdateBlock();
          
          configOp.saveInt(KeyLastSpowerUpdateBlock, lastSpowerUpdateBlock);
        }

        // Get the last spower update block from chain, and check it with the one in config DB
        // There may be case that on chain update success, but client doesn't receive the result(due to 
        // like network interruption, client be killed or crash, etc), so check the on chain status here to avoid repeated calculation
        let lastSpowerUpdateBlockOnChain = await api.getLastSpowerUpdateBlock();
        if (lastSpowerUpdateBlockOnChain > lastSpowerUpdateBlock) {
          logger.warn(`Inconsistent 'LastSpowerUpdateBlock' between on chain (${lastSpowerUpdateBlockOnChain}) and local (${lastSpowerUpdateBlock}).
                       Mark the is_spower_updating records as success`);

          const updatingRecords = await configOp.readJson(KeyUpdatingRecords) as UpdatingRecords;
          if (!_.isNil(updatingRecords) && !_.isEmpty(updatingRecords)) {
            const toDeleteCids = updatingRecords.toDeleteCids;
            // Delete is_closed records
            if (!_.isNil(toDeleteCids) && toDeleteCids.length > 0) {
              logger.debug(`Delete ${toDeleteCids.length} records from files-v2 table`);
              await filesV2Op.deleteRecords(toDeleteCids);
            }

            // Update existing record data, which contains the updated file_info
            const toUpdateRecords = updatingRecords.toUpdateRecords;
            if (!_.isNil(toUpdateRecords) && toUpdateRecords.length > 0) {
              logger.debug(`Update ${toUpdateRecords.length} records in files-v2 table`);
              for (const record of toUpdateRecords) {
                record.last_spower_update_block = lastSpowerUpdateBlockOnChain;
                record.last_spower_update_time = new Date();
              }
              await filesV2Op.updateRecords(toUpdateRecords);
            }
          }

          // Update the lastSpowerUpdateBlock to config DB
          lastSpowerUpdateBlock = lastSpowerUpdateBlockOnChain;
          await configOp.saveInt(KeyLastSpowerUpdateBlock, lastSpowerUpdateBlockOnChain);
        }
        // Clear the to-restore records to avoid any stale data
        await filesV2Op.clearIsSpowerUpdating();
        await configOp.saveJson(KeyUpdatingRecords, {});
        
        //////////////////////////////////////////////////////////////
        // Perform the calculation
        round++;
        logger.info(`Round ${round} - Start to calculate spower at block '${curBlock}' (blockInSlot: ${blockInSlot})`);

        // 0. Get the qualified records to calculate
        const filesToCalcRecords = await filesV2Op.getNeedSpowerUpdateRecords(spowerCalculateBatchSize, curBlock);
        if (filesToCalcRecords.length == 0) {
          logger.info(`No more files to calculate spower, wait for new report slot`);
          const waitTime = (REPORT_SLOT - blockInSlot + SPOWER_UPDATE_START_OFFSET) * 6 * 1000;
          await Bluebird.delay(waitTime);
          continue;
        }
        logger.info(`Calculate spower for ${filesToCalcRecords.length} files`);
       
        // 1. Construct the filesInfoV2Map structure
        logger.debug(`1. Construct the filesInfoV2Map structure`);
        let fileInfoV2Map = new Map<string, FileInfoV2>();
        let allCids: string[] = [];
        for (const record of filesToCalcRecords){
          let fileInfoV2: FileInfoV2 = JSON.parse(record.file_info, (key, value) => {
            if (key === 'replicas') {
              return new Map(Object.entries(value));
            }
            return value;
          });
          fileInfoV2Map.set(record.cid, fileInfoV2);
          allCids.push(record.cid);
        }
        
        // 2. Calculate the new spower for all the updated files
        logger.debug(`2. Calculate the new spower for all the updated files`);

        let fileNewSpowerMap = new Map<string, bigint>();
        let filesChangedMap = new Map<string, ChangedFileInfo>();
        for (const record of filesToCalcRecords) {
          const cid = record.cid;
          const fileInfoV2 = fileInfoV2Map.get(cid);

          // Closed file's spower is 0, and since the file has been removed on chain, we don't need to calculate its new spower
          if (!record.is_closed) {
            // Calculate the new file spower based on spower curve 
            const newSpower = calculateFileSpower(BigInt(fileInfoV2.file_size), fileInfoV2.reported_replica_count);

            fileNewSpowerMap.set(cid, newSpower);
            filesChangedMap.set(cid, {
              spower: newSpower,
              replicas: new Map<string, Replica>()
            });
          }
        }

        // 3. Calculate the Sworker_anchor -> ChangedSpower map and changed replicas map
        logger.debug(`Calculate the Sworker_anchor -> ChangedSpower map and changed replicas map`);

        let sworkerChangedSpowerMap = new Map<string, bigint>(); // Key is sworker anchor, value is changed spower
        let toDeleteCids: string[] = [];
        let toUpdateRecords: FilesV2Record[] = [];
        for (const record of filesToCalcRecords) {
          const cid = record.cid;
          const fileInfoV2 = fileInfoV2Map.get(cid);
          const replicasMap: Map<string, Replica> = fileInfoV2.replicas;
          for (const [owner, replica] of replicasMap) {
            const sworkerAnchor = replica.anchor;
            let changedSpower = sworkerChangedSpowerMap.get(sworkerAnchor);
            if (_.isNil(changedSpower)) {
              changedSpower = BigInt(0);
              sworkerChangedSpowerMap.set(sworkerAnchor, changedSpower);
            }

            // For closed files, newSpower is 0
            const newSpower = record.is_closed ? BigInt(0) : fileNewSpowerMap.get(cid); 

            if (_.isNil(replica.created_at)) {
              // Already use spower
              changedSpower += (newSpower - BigInt(fileInfoV2.spower));
            } else {
              // Not use spower yet, file_size is the oldSpower
              if (record.is_closed) {
                changedSpower += (newSpower - BigInt(fileInfoV2.file_size));
              } else {
                // For new replicas, only update to spower if already pass the spowerReadyPeriod
                if (replica.created_at + spowerReadyPeriod <= curBlock) {
                  changedSpower += (newSpower - BigInt(fileInfoV2.file_size));

                  // Update the created_at to None
                  replica.created_at = null;

                  // Add to the filesChangedMap
                  let changedFileInfoV2 = filesChangedMap.get(cid);
                  changedFileInfoV2.replicas.set(owner, replica);
                }
              }
            }
            
            sworkerChangedSpowerMap.set(sworkerAnchor, changedSpower);

            // Update the file's new spower
            fileInfoV2.spower = newSpower;
          }

          if (!record.is_closed) {
            // Re-calculate the next_spower_update_block for this file record
            let nextSpowerUpdateBlock = null;
            // The next_spower_update_block is the minimum Not-None create_at block + SpowerDelayPeriod
            if (!_.isEmpty(replicasMap)) {
              let minimumCreateAtBlock = Number.MAX_VALUE;
              for (const [_owner,replica] of replicasMap) {
                if (!_.isNil(replica.created_at)) {
                  if (replica.created_at < minimumCreateAtBlock) {
                    minimumCreateAtBlock = replica.created_at;
                  }
                }
              }

              if (minimumCreateAtBlock !== Number.MAX_VALUE) {
                nextSpowerUpdateBlock = minimumCreateAtBlock + spowerReadyPeriod;
              }
            }

            // Update existing record which would need to write back to DB
            record.next_spower_update_block = nextSpowerUpdateBlock;
            record.file_info = JSON.stringify(fileInfoV2, (_key, value) => {
              if (typeof value === 'bigint') {
                return value.toString();
              } else if (value instanceof Map) {
                const obj = {};
                value.forEach((v,k) => {
                  obj[k] = v;
                });
                return obj;
              }
              return value;
            });

            toUpdateRecords.push(record);
          } else {
            toDeleteCids.push(record.cid);
          }
        }
        
        // 4. Update the chain data with sworkerChangedSpowerMap, fileNewSpowerMap, updatedBlocks

        // 4.1 Mark the record is updating and save the to update records, which are used to restore the records 
        //     when on chain update spower is success but client treat as failed (due to like network interuption, or client be killed or crashed)
        const updatingRecords: UpdatingRecords = {
          toDeleteCids: toDeleteCids,
          toUpdateRecords: toUpdateRecords
        }
        await configOp.saveJson(KeyUpdatingRecords, updatingRecords);
        await filesV2Op.setIsSpowerUpdating(allCids);

        // 4.2 Perform the update
        logger.debug(`Call swork.update_spower: changed sworkers count - ${sworkerChangedSpowerMap.size}, changed files count - ${filesChangedMap.size}`);
        const result = await api.updateSpower(sworkerChangedSpowerMap, filesChangedMap);

        // 5. Update db status
        if (result === true) {
          // Update all database records in a single transaction
          await database.transaction(async (transaction) => {
            // 5.1 Get last spower update block from chain
            const newLastSpowerUpdateBlock = await api.getLastSpowerUpdateBlock();

            // 5.2 Delete is_closed records
            if (toDeleteCids.length > 0) {
              logger.debug(`Delete ${toDeleteCids.length} records from files-v2 table`);
              await filesV2Op.deleteRecords(toDeleteCids, transaction);
            }

            // 5.3 Update existing record data, which contains the updated file_inf)
            if (toUpdateRecords.length > 0) {
              logger.debug(`Update ${toUpdateRecords.length} records in files-v2 table`);
              for (const record of toUpdateRecords) {
                record.last_spower_update_block = newLastSpowerUpdateBlock;
                record.last_spower_update_time = new Date();
              }
              await filesV2Op.updateRecords(toUpdateRecords, transaction);
            }

            // 5.4 Clear the to-restore records
            await filesV2Op.clearIsSpowerUpdating();
            await configOp.saveJson(KeyUpdatingRecords, {}, transaction);

            // 5.5 Update config
            await configOp.saveInt(KeyLastSpowerUpdateBlock, newLastSpowerUpdateBlock, transaction);
          });
        } else {
          logger.warn('Call swork.update_spower failed, wait a while and check later');
        }
      } catch (err) {
        logger.error(`💥 Error to calculate spower: ${err}`);
      } 
    };
}

const SpowerLookupTable = 
[
  { range: [0, 0], alpha: 0, multiplier: 1 },
  { range: [1, 8], alpha: 0.1, multiplier: 10 },
  { range: [9, 16], alpha: 1, multiplier: 1 },
  { range: [17, 24], alpha: 3, multiplier: 1 },
  { range: [25, 32], alpha: 7, multiplier: 1 },
  { range: [33, 40], alpha: 9, multiplier: 1 },
  { range: [41, 48], alpha: 14, multiplier: 1 },
  { range: [49, 55], alpha: 19, multiplier: 1 },
  { range: [56, 65], alpha: 49, multiplier: 1 },
  { range: [66, 74], alpha: 79, multiplier: 1 },
  { range: [75, 83], alpha: 99, multiplier: 1 },
  { range: [84, 92], alpha: 119, multiplier: 1 },
  { range: [93, 100], alpha: 149, multiplier: 1 },
  { range: [101, 115], alpha: 159, multiplier: 1 },
  { range: [116, 127], alpha: 169, multiplier: 1 },
  { range: [128, 142], alpha: 179, multiplier: 1 },
  { range: [143, 157], alpha: 189, multiplier: 1 },
  { range: [158, 200], alpha: 199, multiplier: 1 },
  { range: [201, Infinity], alpha: 199 }
];

function calculateFileSpower(fileSize: bigint, reportedReplicaCount: number): bigint {
  let { alpha, multiplier } = SpowerLookupTable.find(entry => 
        reportedReplicaCount >= entry.range[0] && reportedReplicaCount <= entry.range[1]
    );

  if (reportedReplicaCount == 0) {
    return BigInt(0);
  } else {
    return fileSize + fileSize * BigInt(alpha*multiplier) / BigInt(multiplier);
  }
}

export async function createSpowerCalculator(
  context: AppContext,
  loggerParent: Logger,
): Promise<SimpleTask> {
  // TODO: make it configurable
  const processInterval = 15 * 1000;
  return makeIntervalTask(
    10 * 1000,
    processInterval,
    'spower-calculator',
    context,
    loggerParent,
    calculateSpower,
  );
}
