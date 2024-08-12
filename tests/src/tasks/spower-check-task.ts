import { AppContext } from '../types/context';
import _ from 'lodash';
import { createChildLogger } from '../utils/logger';
import { cidFromStorageKey, sleep } from '../utils';
import { MarketFilesV2StorageKey, REPORT_SLOT, SPOWER_UPDATE_END_OFFSET } from '../utils/consts';
import { FileInfoV2 } from '../types/chain';
import { GroupMembersRecord, SworkerKeysRecord } from '../types/database';

const logger = createChildLogger({ moduleId: 'spower-check-tasks' });

const FilesV2PageSize = 300;

/**
 * main entry funciton for the task
 */
export async function runSpowerCheckTask(
  context: AppContext,
) {
  const { api } = context;
  let lastCheckedBlock = null;

  do {
    try {
        // Sleep a while
        await sleep(1000);
        
        // Ensure connection and get the lastest finalized block
        await api.ensureConnection();
        const curBlock: number = api.latestFinalizedBlock();
        //const reportSlot = Math.floor(curBlock/REPORT_SLOT) * REPORT_SLOT;
        
        // Only perform the spower check between 500th and 599th block in the slot, since the spower calculate process just ended
        const blockInSlot = curBlock % REPORT_SLOT;
        // if ( blockInSlot < (SPOWER_UPDATE_END_OFFSET+1) )  {
        //     const waitTime = ((SPOWER_UPDATE_END_OFFSET+1) - blockInSlot) * 6000;

        //     logger.info(`Not in the spower check block range, blockInSlot: ${blockInSlot}, wait for ${waitTime/1000} s`);
        //     await sleep(waitTime);
        //     continue;
        // }

        // Get the last spower update block from chain
        const lastSpowerUpdateBlock = await api.getLastSpowerCalculateBlock();
        if (_.isNil(lastSpowerUpdateBlock) || lastSpowerUpdateBlock === 0 ) {
          const waitTime = (REPORT_SLOT - blockInSlot + SPOWER_UPDATE_END_OFFSET) * 6000;
          logger.warn(`market.LastSpowerUpdateBlock is not set on chain yet, crust-spower may not run yet, wait ${waitTime/1000} s for next slot to check again`);
          await sleep(waitTime);
          continue;
        }
        if (lastCheckedBlock == lastSpowerUpdateBlock) {
          logger.info(`Block '${lastCheckedBlock}' have already been checked, wait a while to check whether there're new market.lastSpowerUpdateBlock on chain`);
          await sleep(12000);
          continue;
        }

        // Get the last processed block of work reports from chain
        //const lastProcessedBlockWorkReports = await api.getLastProcessedBlockWorkReports();
        // Get swork keys and sworker groups to construct the replicas map
        const sworkerKeyRecords = await SworkerKeysRecord.findAll();
        const sworkerKeysMap = new Map<string, string>();
        for (const sworkerKey of sworkerKeyRecords) {
          sworkerKeysMap.set(sworkerKey.sworker_address, sworkerKey.tee_pubkey);
        }
        const groupMemberRecords = await GroupMembersRecord.findAll();
        const sworkerGroupMap = new Map<string, string>();
        for (const groupMember of groupMemberRecords) {
          sworkerGroupMap.set(groupMember.sworker_address, groupMember.group_address);
        }

        // Get all the work reports data based on the last spower update block
        const allWorkReportsOnChain = await api.getAllWorkReports(lastSpowerUpdateBlock);

        // Get all the FilesV2 data based on the last spower update block and aggregate the spower for sworker
        const sworkerSpowerMap = new Map<string, bigint>(); // Key is anchor
        const sworkerSpowerMapEx = new Map<string, any[]>();
        let lastIndexedKey = null;
        do {
          logger.info(`Get FilesV2 data at block '${lastSpowerUpdateBlock}' from key '${lastIndexedKey}' with page size '${FilesV2PageSize}'`);
          const [fileInfoV2MapChain, newLastIndexedKey] = await getFilesV2Data(context, lastIndexedKey, lastSpowerUpdateBlock);
          if (_.isNil(fileInfoV2MapChain)) {
            logger.info(`No more files to process, break out the loop`);
            break;
          }
          // Update the lastIndexedKey
          lastIndexedKey = newLastIndexedKey;
          
          // Calculate the sworker->spower map
          for (const [cid, fileInfoV2] of fileInfoV2MapChain) {
            const fileSize = BigInt(fileInfoV2.file_size);
            const fileSpower = BigInt(fileInfoV2.spower);
            if (!_.isEmpty(fileInfoV2.replicas)) {
              for (const [_owner, replica] of fileInfoV2.replicas) {
                const anchor = replica.anchor;
                let totalSpower = sworkerSpowerMap.get(anchor);
                if (_.isNil(totalSpower)) {
                  totalSpower = BigInt(0);
                }

                let array = sworkerSpowerMapEx.get(anchor);
                if (_.isNil(array)) {
                  array = [];
                  sworkerSpowerMapEx.set(anchor, array);
                }
                // created_at is null means already use spower, otherwise use file_size
                if (_.isNil(replica.created_at)) {
                  totalSpower += fileSpower;
                  const entry = [cid,'fileSpower',fileSpower];
                  array.push(entry);
                } else {
                  totalSpower += fileSize;
                  const entry = [cid,'fileSize',fileSize];
                  array.push(entry);
                }
                sworkerSpowerMap.set(anchor, totalSpower);
              }
            }
          }

          ///// Don't need to check here, because there maybe some work reports have been submitted but not processed by 
          ///// crust-spower.work-reports-processor, so there may be differences between the onchain and local replicas data
          ///// in a specific time
          // // Construct the FilesV2 structure from file_records table based on the last processed block of work reports
          // const filesInfoV2MapLocal = await constructFileReplicasMapFromDB([...fileInfoV2MapChain.keys()], lastProcessedBlockWorkReports, sworkerKeysMap, sworkerGroupMap);

          // // Compare the filesInfoV2MapChain and filesInfoV2MapLocal
          // for (const [cid, fileInfoV2Chain] of fileInfoV2MapChain) {
          //   const fileInfoV2Local = filesInfoV2MapLocal.get(cid);
          //   if (!_.isNil(fileInfoV2Local)) {
          //     if (fileInfoV2Chain.replicas.size != fileInfoV2Local.replicas.size) {
          //       logger.error(`💥💥💥 File replicas count not equal: chain - ${fileInfoV2Chain.replicas.size}, local - ${fileInfoV2Local.replicas.size} (${cid})`);
          //     } else {
          //       for (const [owner, replicaChain] of fileInfoV2Chain.replicas) {
          //         const replicaLocal = fileInfoV2Local.replicas.get(owner);
          //         if (_.isNil(replicaLocal)) {
          //           logger.error(`💥💥💥 Replica not exist in local (${cid}, ${owner})`);
          //         } else {
          //           if (replicaChain.anchor != replicaLocal.anchor) {
          //             logger.error(`💥💥💥 Replica Anchor not equal: chain - ${replicaChain.anchor}, local - ${replicaLocal.anchor} (${cid}, ${owner})`);
          //           }
          //           if (replicaChain.who != replicaLocal.who) {
          //             logger.error(`💥💥💥 Replica Who not equal: chain - ${replicaChain.who}, local - ${replicaLocal.who} (${cid}, ${owner})`);
          //           }
          //         }
          //       }
          //     }
          //   }
          // }
        } while(true);

        // Turn it on when need to troubleshoot
        // logger.debug(`Print out the sworkerSpowerMapEx`);
        // for (const [anchor, entryList] of sworkerSpowerMapEx) {
        //   for (const entry of entryList) {
        //     logger.debug(`${anchor},${entry[0]},${entry[1]},${entry[2]}`);
        //   }
        //   logger.debug('---------------------');
        // }

        // Compare the spower calculated from FilesV2 data to the spower from work reports
        for (const [anchor, workReport] of allWorkReportsOnChain) {
          logger.info(`Checking spower value for sworker '${anchor}' at block '${lastSpowerUpdateBlock}'`);

          let calculatedTotalSpower = sworkerSpowerMap.get(anchor);
          calculatedTotalSpower = !_.isNil(calculatedTotalSpower) ? calculatedTotalSpower : BigInt(0);
          logger.info(`   calculated - ${calculatedTotalSpower}, work report total spower - ${workReport.spower}`);
          if (calculatedTotalSpower != workReport.spower) {
            logger.error(`   💥💥💥 Total spower not match: calculated - ${calculatedTotalSpower}, work report total spower - ${workReport.spower}, anchor - ${anchor}, block - ${lastSpowerUpdateBlock}`);
          }
        }

        // Update lastCheckedBlock
        lastCheckedBlock = lastSpowerUpdateBlock;
      } catch(err) {
        logger.error(`💥 Error to check spower: ${err}`);
      }
  } while(true);
}

async function getFilesV2Data(context: AppContext, lastIndexedKey: string, atBlock: number): Promise<[Map<string, FileInfoV2>, string]> {

  const { api } = context;

  const blockHash = await api.getBlockHash(atBlock);
  // Get storage keys in batch by lastIndexedKey
  if (_.isEmpty(lastIndexedKey)) {
    lastIndexedKey = MarketFilesV2StorageKey;
  }
  const keys = await api.chainApi().rpc.state.getKeysPaged(MarketFilesV2StorageKey, FilesV2PageSize, lastIndexedKey, blockHash);

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
      logger.info('No pending cids to retrieve from db, mark indexing as done');

      return [null, null];
  }

  // Get the FilesV2 data from chain
  const filesV2Data = await api.getFilesInfoV2(cids, atBlock);
  
  return [filesV2Data, newLastIndexedKey];
}

// async function constructFileReplicasMapFromDB(
//   cids: string[], 
//   lastProcessedBlockWorkReports: number, 
//   sworkerKeysMap: Map<string, string>,
//   sworkerGroupMap: Map<string, string>
//   ): Promise<Map<string, FileInfoV2>> {

//   const fileRecords = await FilesRecord.findAll({
//     where: {
//       cid: cids,
//       report_done: true,
//       reported_block: { [Op.lte]: lastProcessedBlockWorkReports },
//       is_to_cleanup: false, // is_to_cleanup=true means file has been deleted on chain
//       cleanup_done: false  // cleanup_done=true means file has been deleted locally, either trigger by is_to_cleanup or by random deletion test logic 
//     },
//   });

//   // Construct the filesV2Map
//   const filesV2MapDB = new Map<string, FileInfoV2>();
//   for (const record of fileRecords) {
//     let fileInfoV2 = filesV2MapDB.get(record.cid);
//     if (_.isNil(fileInfoV2)) {
//       fileInfoV2 = {
//         file_size: record.file_size,
//         spower: null,
//         expired_at: null,
//         calculated_at: null,
//         amount: null,
//         prepaid: null,
//         reported_replica_count: null,
//         remaining_paid_count: null,
//         replicas: new Map<string, Replica>(),
//       }
//       filesV2MapDB.set(record.cid, fileInfoV2);
//     }
//     const sworkerAddress = record.reported_sworker_address;
//     const owner = sworkerGroupMap.get(sworkerAddress);
//     const anchor = sworkerKeysMap.get(sworkerAddress)
//     fileInfoV2.replicas.set(owner, {
//       who: record.reported_sworker_address,
//       valid_at: null,
//       anchor: anchor,
//       is_reported: true,
//       created_at: null
//     });
//   }

//   return filesV2MapDB;
// }