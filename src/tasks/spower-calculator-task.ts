/**
 * The spower-calculator task to calculate the spower for updated files and their related sworkers
 */

import { Logger } from 'winston';
import { AppContext } from '../types/context';
import { SimpleTask } from '../types/tasks';
import { IsStopped, makeIntervalTask } from './task-utils';
import { FileInfoV2, Replica, ReplicaToUpdate, UpdatedFileToProcess } from '../types/chain';
import Bluebird from 'bluebird';
import { createUpdatedFilesToProcessOperator } from '../db/updated-files-to-process';
import { createFileInfoV2Operator } from '../db/file-info-v2';
import _ from 'lodash';


export const KeyLastSuccessSpowerCalculateBlock = 'spower-calculator:last-success-spower-calculate-block';

interface ReplicaToUpdateEx extends ReplicaToUpdate {
  create_at: number
}
/**
 * main entry funciton for the task
 */
async function calculateSpower(
  context: AppContext,
  logger: Logger,
  isStopped: IsStopped,
) {
    const { api, database } = context;
    const updatedFilesOp = createUpdatedFilesToProcessOperator(database);
    const fileInfoV2Op = createFileInfoV2Operator(database);
    let round = 1;

    do {
      if (isStopped()) {
        return;
      }

      const lastSpowerUpdateBlock = await api.getLastSpowerUpdateBlock();
      if (_.isNil(lastSpowerUpdateBlock)) {
        logger.error(`Failed to get last spower update block from chain, please check the chain RPC node`);
        // Sleep for a while and try again
        Bluebird.delay(6000);
        continue;
      }
      logger.info(`Round ${round} - Last Spower Update Block: ${lastSpowerUpdateBlock}`);

      // Get 10 blocks of updated files per time
      const updatedBlocksOfFiles = await updatedFilesOp.getPendingUpdatedFiles(10);
      if (updatedBlocksOfFiles.length === 0) {
        logger.info(`No more updated blocks to process, stop for a while.`);
        break;
      }
      logger.info(`Round ${round} - ${updatedBlocksOfFiles.length} updated blocks to process.`);

      // 1. Extrace all the updated files and their updated replicas
      logger.debug(`1. Extrace all the updated files and their updated replicas.`);
      let updatedFileCIDs = new Set<string>();
      let updatedBlocks = new Set<number>();
      let sworkerAddedReplicasMap = new Map<string, Map<string, ReplicaToUpdate>>();  // Map<SworkerAnchor, Map<CID, ReplicaToUpdate>>
      let sworkerDeletedReplicasMap = new Map<string, Map<string, ReplicaToUpdate>>(); // Map<SworkerAnchor, Map<CID, ReplicaToUpdate>>
      let mergedAddedReplicasMap = new Map<string, ReplicaToUpdateEx[]>(); // The key is cid
      let mergedDeletedReplicasMap = new Map<string, ReplicaToUpdateEx[]>(); // The key is cid
      
      for (const record of updatedBlocksOfFiles) {
        // Record all the updated blocks in this batch
        updatedBlocks.add(record.update_block);

        const updatedFiles = JSON.parse(record.updated_files) as UpdatedFileToProcess[];
        for (const file of updatedFiles) {
          const cid = file.cid;
          // Record all the updated file cids in this batch
          updatedFileCIDs.add(cid);

          // Construct the sworkerAddedReplicasMap
          for (const addedReplica of file.actual_added_replicas) {
            let fileToReplicasMap = sworkerAddedReplicasMap.get(addedReplica.sworker_anchor);
            if (!fileToReplicasMap) {
              fileToReplicasMap = new Map<string, ReplicaToUpdate>();
              sworkerAddedReplicasMap.set(addedReplica.sworker_anchor, fileToReplicasMap);
            }
            fileToReplicasMap.set(cid, addedReplica);  // There should be a unique addedReplica for SworkerAnchor + CID
          }
          
          // Construct the sworkerDeletedReplicasMap
          for (const deletedReplica of file.actual_deleted_replicas) {
            let fileToReplicasMap = sworkerDeletedReplicasMap.get(deletedReplica.sworker_anchor);
            if (!fileToReplicasMap) {
              fileToReplicasMap = new Map<string, ReplicaToUpdate>();
              sworkerDeletedReplicasMap.set(deletedReplica.sworker_anchor, fileToReplicasMap);
            }
            fileToReplicasMap.set(cid, deletedReplica); // There should be a unique deletedReplica for SworkerAnchor + CID
          }

          // Construct the mergedAddedReplicasMap
          let addedReplicas: ReplicaToUpdateEx[] = mergedAddedReplicasMap.get(cid);
          if (!addedReplicas) {
            addedReplicas = [];
            mergedAddedReplicasMap.set(cid, addedReplicas);
          }
          for (const replicaToUpdate of file.actual_added_replicas) {
            let replicaEx: ReplicaToUpdateEx = {
              create_at: record.update_block,
              ...replicaToUpdate
            }
            addedReplicas.push(replicaEx);
          }

          // Construct the mergedDeletedReplicasMap
          let deletedReplicas: ReplicaToUpdateEx[] = mergedDeletedReplicasMap.get(cid);
          if (!deletedReplicas) {
            deletedReplicas = [];
            mergedDeletedReplicasMap.set(cid, deletedReplicas);
          }
          for (const replicaToUpdate of file.actual_deleted_replicas) {
            let replicaEx: ReplicaToUpdateEx = {
              create_at: record.update_block,
              ...replicaToUpdate
            }
            deletedReplicas.push(replicaEx);
          }
        }
      }
      logger.debug(`Updated files size: ${updatedFileCIDs.size}`);

      // 2. Get the filesInfoV2 data
      logger.debug(`2. Get the filesInfoV2 data`);
      const fileInfoV2Map = await getFileInfoV2AtBlock(context, logger, [...updatedFileCIDs], lastSpowerUpdateBlock);
      
      // 3. Replay the actual_added_replicas and actual_deleted_replicas for the fileInfoV2Map on lastSpowerUpdateBlock 
      //    to get the new fileInfoV2Map on the latest update_block from updatedBlocksOfFiles in this round.
      logger.debug(`3. Replay the actual_added_replicas and actual_deleted_replicas`);
      
      for (const [cid, fileInfoV2] of fileInfoV2Map) {
        
        let replicas: Map<string, Replica> = fileInfoV2.replicas;

        // Replay all the actual_added_replicas
        let addedReplicasToUpdateEx: ReplicaToUpdateEx[] = mergedAddedReplicasMap.get(cid);
        if (addedReplicasToUpdateEx && addedReplicasToUpdateEx.length > 0) {
          for (const addedReplicaEx of addedReplicasToUpdateEx) {
            let replica: Replica = {
              who: addedReplicaEx.reporter,
              valid_at: addedReplicaEx.valid_at,
              anchor: addedReplicaEx.sworker_anchor,
              is_reported: true,
              created_at: addedReplicaEx.create_at
            }
            replicas.set(addedReplicaEx.owner, replica);
          }
        }

        // Relay all the actual_delete_replicas
        let deletedReplicasToUpdateEx: ReplicaToUpdateEx[] = mergedDeletedReplicasMap.get(cid);
        if (deletedReplicasToUpdateEx && deletedReplicasToUpdateEx.length > 0) {
          for (const deletedReplicaEx of deletedReplicasToUpdateEx) {
            replicas.delete(deletedReplicaEx.owner);
          }
        }
      }

      // 4. Calculate the new spower for all the updated files
      logger.debug(`4. Calculate the new spower for all the updated files`);

      let fileNewSpowerMap = new Map<string, bigint>();
      for (const [cid, fileInfoV2] of fileInfoV2Map) {
        // Calculate the new file spower based on spower curve 
        const newSpower = calculateFileSpower(fileInfoV2.file_size, fileInfoV2.reported_replica_count);

        fileNewSpowerMap.set(cid, newSpower);
      }

      // 5. Calculate the Sworker_anchor -> ChangedSpower map
      logger.debug(`Calculate the Sworker_anchor -> ChangedSpower map`);

      let sworkerChangedSpowerMap = new Map<string, bigint>();
      // We loop with fileInfoV2Map, if there're any missing CIDs compared to the updatedFilesMap, 
      // we treat those files as removed on chain, we can just ignore those files as we haven't 
      // add or delete any spower during swork.report_works for files.
      for (const [cid, fileInfoV2] of fileInfoV2Map) {
        const replicasMap: Map<string, Replica> = fileInfoV2.replicas;
        for (const [_owner, replica] of replicasMap) {
          const sworkerAnchor = replica.anchor;
          let changedSpower = sworkerChangedSpowerMap.get(sworkerAnchor);
          if (_.isNil(changedSpower)) {
            changedSpower = BigInt(0);
            sworkerChangedSpowerMap.set(sworkerAnchor, changedSpower);
          }

          // Check whether this replica is newly added by this sworker
          const addedReplicasMap = sworkerAddedReplicasMap.get(sworkerAnchor);
          let isAddedReplica = (!_.isNil(addedReplicasMap) && addedReplicasMap.has(cid));

          // Calculate the changed power for this file
          const newFileSpower = fileNewSpowerMap.get(cid);
          if (isAddedReplica) {
            // If this is the newly added replica for this sworker, old_spower is 0 (which use it sworker::report_works)
            changedSpower += newFileSpower;
          } else {
            // If this is not added replica for this sworker, then it means this sworker + cid have already exist before, 
            // so this sworker has already used the old file spower
            changedSpower += (newFileSpower - getFileCurrentSpower(fileInfoV2));
          }
          
          sworkerChangedSpowerMap.set(sworkerAnchor, changedSpower);
        }
      }

      // 5.1 Supplement the deleted replicas to the sworkerChangedSpowerMap, since valid deleted replicas have been deleted 
      // from the fileInfoV2Map, so this changed info are not in the sworkerChangedSpowerMap
      for (const [sworkerAnchor, deletedReplicasMap] of sworkerDeletedReplicasMap) {
        for (const [cid, _replica] of deletedReplicasMap) {
          let changedSpower = sworkerChangedSpowerMap.get(sworkerAnchor);
          if (_.isNil(changedSpower)) {
            changedSpower = BigInt(0);
            sworkerChangedSpowerMap.set(sworkerAnchor, changedSpower);
          }

          // File has been deleted, we need to substract its original file spower
          const fileInfoV2 = fileInfoV2Map.get(cid);
          if (fileInfoV2) {
            changedSpower -= getFileCurrentSpower(fileInfoV2);
          }

          sworkerChangedSpowerMap.set(sworkerAnchor, changedSpower);
        }
      }
      
      // 6. Update the chain data with sworkerChangedSpowerMap, fileNewSpowerMap, updatedBlocks
      logger.debug(`sworkerChangedSpowerMap: ${sworkerChangedSpowerMap}`);
      logger.debug(`fileNewSpowerMap: ${fileNewSpowerMap}`);
      logger.debug(`updatedBlocks: ${updatedBlocks}`);
      const result = await api.updateSpower(sworkerChangedSpowerMap, fileNewSpowerMap, updatedBlocks);

      // 7. Update db status
      logger.debug(`Update related updated_files_to_process records to 'processed' status`);
      let ids = updatedBlocksOfFiles.map((record)=>record.id);
      if (result === true) {
        updatedFilesOp.updateRecordsStatus(ids, 'processed');
      } else {
        updatedFilesOp.updateRecordsStatus(ids, 'failed');
      }

      // Update the new fileInfoV2Map no matter whether the api.updateSpower is success or not
      // These updated data can be used directly in the next round
      const newSpowerUpdateBlock = _.max([...updatedBlocks]);
      logger.debug(`Update the up-to-date fileInfoV2Map on block '${newSpowerUpdateBlock}' to file_info_v2 table`);
      const fileInfoV2InsertCount = await fileInfoV2Op.add(fileInfoV2Map, newSpowerUpdateBlock);
      logger.info(`Upsert ${fileInfoV2Map.size} files at block '${newSpowerUpdateBlock}' to file_info_v2 table: New - ${fileInfoV2InsertCount}, Existing: ${fileInfoV2Map.size-fileInfoV2InsertCount}`);

      round++;
    } while(true);
}

async function getFileInfoV2AtBlock(
  context: AppContext,
  logger: Logger,
  cids: string[],
  updateBlock: number,
) : Promise<Map<string, FileInfoV2>> {

  const { api, database } = context;
  const fileInfoV2Op = createFileInfoV2Operator(database);
  let fileInfoV2Map = new Map<string, FileInfoV2>();

  // 1. Get non exist cids from file_info_v2 table
  const nonExistCids: string[] = await fileInfoV2Op.getNonExistCids(cids, updateBlock);
  logger.info(`Non-exist cids count in file_info_v2 table for update_block '${updateBlock}': ${nonExistCids.length}`);

  // 2. For exist cids, retreive FileInfoV2 data directly from the local file_info_v2 table
  const nonExistCidsSet = new Set(nonExistCids);
  const existCids = cids.filter(cid => !nonExistCidsSet.has(cid) )
  const batchSize = 500;
  for (let i = 0; i < existCids.length; i += batchSize) {
    const cidInBatch = existCids.slice(i, i + batchSize);

    // Query the file_info_v2 table in batch
    const fileInfoV2List = await fileInfoV2Op.getFileInfoV2AtBlock(cidInBatch, updateBlock);

    for (const record of fileInfoV2List){
      let fileInfoV2: FileInfoV2 = JSON.parse(record.file_info) as FileInfoV2;
      fileInfoV2Map.set(record.cid, fileInfoV2);
    }
  }

  // 3. For non exist cids, retreive FileInfoV2 data from chain
  const fileInfoV2MapFromChain: Map<string, FileInfoV2> = await api.getFilesInfoV2(nonExistCids, updateBlock);
  for (const [cid, fileInfo] of fileInfoV2MapFromChain) {
    fileInfoV2Map.set(cid, fileInfo);
  }
  
  // 4. Add fileInfoV2MapFromChain to file_info_v2 table
  const insertRecordsCount = await fileInfoV2Op.add(fileInfoV2MapFromChain, updateBlock);
  logger.info(`Upsert ${fileInfoV2Map.size} files at block '${updateBlock}' to file_info_v2 table: New - ${insertRecordsCount}, Existing: ${fileInfoV2MapFromChain.size-insertRecordsCount}`);

  return fileInfoV2Map;
}

const SpowerLookupTable = 
[
  { range: [0, 0], integer: 0, numerator: 0, denominator: 1 },
  { range: [1, 8], integer: 1, numerator: 1, denominator: 20 },
  { range: [9, 16], integer: 1, numerator: 1, denominator: 5 },
  { range: [17, 24], integer: 1, numerator: 1, denominator: 2 },
  { range: [25, 32], integer: 2, numerator: 0, denominator: 1 },
  { range: [33, 40], integer: 2, numerator: 3, denominator: 5 },
  { range: [41, 48], integer: 3, numerator: 3, denominator: 10 },
  { range: [49, 55], integer: 4, numerator: 0, denominator: 1 },
  { range: [56, 65], integer: 5, numerator: 0, denominator: 1 },
  { range: [66, 74], integer: 6, numerator: 0, denominator: 1 },
  { range: [75, 83], integer: 7, numerator: 0, denominator: 1 },
  { range: [84, 92], integer: 8, numerator: 0, denominator: 1 },
  { range: [93, 100], integer: 8, numerator: 1, denominator: 2 },
  { range: [101, 115], integer: 8, numerator: 4, denominator: 5 },
  { range: [116, 127], integer: 9, numerator: 0, denominator: 1 },
  { range: [128, 142], integer: 9, numerator: 1, denominator: 5 },
  { range: [143, 157], integer: 9, numerator: 2, denominator: 5 },
  { range: [158, 167], integer: 9, numerator: 3, denominator: 5 },
  { range: [168, 182], integer: 9, numerator: 4, denominator: 5 },
  { range: [183, 200], integer: 10, numerator: 0, denominator: 1 },
  { range: [201, Infinity], integer: 10, numerator: 0, denominator: 1 }
];

function calculateFileSpower(fileSize: bigint, reportedReplicaCount: number): bigint {
  let { integer, numerator, denominator } = SpowerLookupTable.find(entry => 
        reportedReplicaCount >= entry.range[0] && reportedReplicaCount <= entry.range[1]
    );  

  let b_integer = BigInt(integer);
  let b_numerator = BigInt(numerator);
  let b_denominator = BigInt(denominator);

  return b_integer * fileSize + fileSize / b_denominator * b_numerator;
}

function getFileCurrentSpower(fileInfoV2: FileInfoV2): bigint {
  // No spower calculated yet before, the default spower is file_size
  const currentSpower = BigInt(fileInfoV2.spower);
  if (currentSpower === BigInt(0)) {
    return BigInt(fileInfoV2.file_size);
  }
  return currentSpower;
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
