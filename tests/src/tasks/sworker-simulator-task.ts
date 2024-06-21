import { AppContext } from '../types/context';
import _ from 'lodash';
import { createChildLogger } from '../utils/logger';
import { AccountsRecord, FilesRecord, GroupMembersRecord, OrdersRecord, SworkerKeysRecord, WorkReportsRecord } from '../types/database';
import { Keyring } from '@polkadot/api';
import { KeyringPair } from '@polkadot/keyring/types';
import { mnemonicGenerate, randomAsU8a  } from '@polkadot/util-crypto';
import { assert } from 'console';
import { u8aToHex } from '@polkadot/util';
import { REPORT_SLOT, SPOWER_UPDATE_START_OFFSET, WORKREPORT_PROCESSOR_OFFSET } from '../utils/consts';
import Bluebird from 'bluebird';
import { createConfigOps } from '../db/configs';
import { Dayjs } from '../utils/datetime';
import { MaxNoNewBlockDuration } from '../main';
import { Mutex } from 'async-mutex';
import { WorkReportOnChain } from '../types/chain';
import { stringToHex, stringifyEx } from '../utils';
import { Sequelize } from 'sequelize';


const logger = createChildLogger({ moduleId: 'sworker-simulator-tasks' });
const SWORKER_CODE = '0x69f72f97fc90b6686e53b64cd0b5325c8c8c8d7eed4ecdaa3827b4ff791694c0';
const KeySmanagerLastIndexBlock = 'sworker-simulator-task:smanager-last-index-block';

const files_record_lock = new Mutex();
/**
 * main entry funciton for the task
 */
export async function runSworkerSimulatorTask(
  context: AppContext,
) {
  const { config } = context;

  // Get or generate group accounts
  const groupAccounts = await getOrGeneratAccounts(context, 'group', config.chain.groupAccountsNumber);
  logger.debug(`groupAccounts: ${groupAccounts.size}`);

  // Get or generate sworker accounts
  const sworkerAccounts = await getOrGeneratAccounts(context, 'sworker', config.chain.sworkerAccountsNumber);
  logger.debug(`sworkerAccounts: ${sworkerAccounts.size}`);

  // Get or generate sworker tee_pubkeys
  const sworkerKeys = await getOrGenerateTeePubkeys(context, [...sworkerAccounts.keys()]);

  // Get or generate group/sworker relationships
  const groupMembers = await getOrGenerateGroupAndSworkerMap(context, [...groupAccounts.keys()], [...sworkerAccounts.keys()]);
  logger.debug(`groupMembersMap: ${groupMembers.size}`);

  // Configure group and sworker accounts
  logger.debug(`Configure group and sworker accounts`);
  await configureGroupAndSworkers(context, groupAccounts, sworkerAccounts, groupMembers, sworkerKeys);
  
  // Simulate Smanager and Sworkers
  logger.debug(`Start to simulate Smanager and Sworkers...`);
  await simulateSmanagerAndSworkers(context, sworkerAccounts, groupMembers, sworkerKeys);
}

async function getOrGeneratAccounts(context: AppContext, type: string, count: number): Promise<Map<string, KeyringPair>> {

  const { api } = context;
  let accountKrps = new Map<string, KeyringPair>();

  // Read accounts from DB
  const accounts = await AccountsRecord.findAll({ where: { type: type } });

  // No accounts in DB, generate new accounts
  const kr = new Keyring({ type: 'sr25519' });
  kr.setSS58Format(66);
  if (accounts.length == 0) {
    let generatedAccounts = [];
    for (let i = 0; i < count; i++) {
        const mnemonic = mnemonicGenerate();
        const pair = kr.addFromUri(mnemonic);
        generatedAccounts.push({ 
          address: pair.address, 
          mnemonic, 
          type
        });
        logger.debug(`Generate krp for '${type}' accounts: '${pair.address}'-'${mnemonic}'`);

        accountKrps.set(pair.address, pair);
    }

    // Transfer 100 CRU from Alice to these generated accounts
    const aliceKrp = kr.addFromUri('//Alice');
    for (const account of generatedAccounts) {
      await api.transferTokens(aliceKrp, account.address, 100_000_000_000_000);
      logger.debug(`Transferred 100 CRU to ${account.address}`);
    }

    // Save the generated accounts to DB
    await AccountsRecord.bulkCreate(generatedAccounts);
  } else {
    // Create the KeyringPair if accounts have already been created
    for (const account of accounts) {
      const pair = kr.addFromUri(account.mnemonic);
      accountKrps.set(pair.address, pair);
    }
  }
  
  return accountKrps;
}

async function getOrGenerateTeePubkeys(context: AppContext, sworkerAddresses: string[]): Promise<Map<string, string>> {

    const { database } = context;
    const sworkerKeysMap = new Map<string, string>();

    const sworkerKeysRecords = await SworkerKeysRecord.findAll();
    if (sworkerKeysRecords.length == 0) {

        const sworkerKeysList = [];
        for (const sworkerAddress of sworkerAddresses) {
            const teePubKey = randomAsU8a(64);
            const hexTeePubKey = u8aToHex(teePubKey);
            logger.debug(`sworker: ${sworkerAddress} - hexTeePubKey: ${hexTeePubKey}`);

            const sworkerKey = {
                sworker_address: sworkerAddress,
                tee_pubkey: hexTeePubKey,
            };

            sworkerKeysList.push(sworkerKey);

            sworkerKeysMap.set(sworkerKey.sworker_address, sworkerKey.tee_pubkey);
        }

        // Save to DB
        await database.transaction(async (transaction) => {
            await SworkerKeysRecord.bulkCreate(sworkerKeysList, {
                transaction
            });
        });
    } else {
        for (const sworkerKey of sworkerKeysRecords) {
            sworkerKeysMap.set(sworkerKey.sworker_address, sworkerKey.tee_pubkey);
        }
    }

    return sworkerKeysMap;
}

async function getOrGenerateGroupAndSworkerMap(context:AppContext, groupAddresses: string[], sworkerAddresses: string[]): Promise<Map<string, string[]>> {

    const { database } = context;
    const groupMembersMap = new Map<string, string[]>();

    const groupMembersRecords = await GroupMembersRecord.findAll();
    if (groupMembersRecords.length == 0) {
        // Distribute sworker accounts to group
        const groupCount = groupAddresses.length;
        const chunkSize = Math.ceil(sworkerAddresses.length / groupCount);
        const sworkerAddressChunks = _.chunk(sworkerAddresses, chunkSize);

        assert(sworkerAddressChunks.length == groupCount);

        const groupMemberList = [];
        for (let i = 0; i < groupCount; i++) {
            const groupAddress = groupAddresses[i];
            const sworkerAddressChunk = sworkerAddressChunks[i];

            let membersList = groupMembersMap.get(groupAddress);
            if (_.isNil(membersList)) {
                membersList = [];
                groupMembersMap.set(groupAddress, membersList);
            }
            for (const sworkerAddress of sworkerAddressChunk) {
                const groupMember = {
                    group_address: groupAddress,
                    sworker_address: sworkerAddress,
                }
                groupMemberList.push(groupMember);
                logger.debug(`Assign sworker account: ${sworkerAddress} to group: ${groupAddress}`);

                membersList.push(sworkerAddress);
            }
        }

        // Save to DB
        await database.transaction(async (transaction) => {
            await GroupMembersRecord.bulkCreate(groupMemberList, {
                transaction
            });
        });
    } else {
        for (const record of groupMembersRecords) {
            let membersList = groupMembersMap.get(record.group_address);
            if (_.isNil(membersList)) {
                membersList = [];
                groupMembersMap.set(record.group_address, membersList);
            }
            membersList.push(record.sworker_address);
        }
    }

    return groupMembersMap;
}

async function configureGroupAndSworkers(
    context: AppContext, 
    groupAccounts: Map<string, KeyringPair>, 
    sworkerAccounts: Map<string, KeyringPair>, 
    groupMembers: Map<string, string[]>,
    sworkerKeys: Map<string, string>) {

  const { api } = context;

  for (const [groupAddress, groupAccount] of groupAccounts) {
    const group = await api.getGroup(groupAddress);
    const members = groupMembers.get(groupAddress);

    if (_.isNil(group)) {
        logger.debug(`Group not exist, create it: ${groupAddress}`);
        await api.createGroup(groupAccount);
        
        for (const sworkerAddress of members) {
            await registerSworkerAndJoinGroup(context, sworkerAccounts.get(sworkerAddress), sworkerKeys.get(sworkerAddress), groupAccount);
        }
    } else {
        for (const sworkerAddress of members) {
            if (!group.members.includes(sworkerAddress)) {
                await registerSworkerAndJoinGroup(context, sworkerAccounts.get(sworkerAddress), sworkerKeys.get(sworkerAddress), groupAccount);
            }
        }
    }
  }
}

async function registerSworkerAndJoinGroup(context: AppContext, sworkerAccount: KeyringPair, sworkerKey: string, groupAccount: KeyringPair) {
    const { api } = context;

    logger.debug(`Register sworker '${sworkerAccount.address}' to group '${groupAccount.address}'`);

    await api.addMemberToAllowlist(sworkerAccount.address, groupAccount);

    await api.sworkerRegister(sworkerAccount, SWORKER_CODE, sworkerKey);

    const curBlock = api.latestFinalizedBlock();
    const reportSlot = Math.floor(curBlock/REPORT_SLOT) * REPORT_SLOT;
    const slotHash = await api.getBlockHash(reportSlot);
    const workReport = {
        curr_pk: sworkerKey,
        ab_upgrade_pk: '0x',
        slot: reportSlot,
        slot_hash: slotHash.toString(),
        reported_srd_size: BigInt(1_000_000_000_000),
        reported_files_size: BigInt(0),
        added_files: [],
        deleted_files: [],
        reported_srd_root: '0x',
        reported_files_root: '0x',
        sig: '0x',
    };
    // report empty work report to registration
    await api.sworkerReportWorks(sworkerAccount, workReport);
    // Save the work report to DB
    await WorkReportsRecord.create({
        sworker_address: sworkerAccount.address,
        report_block: curBlock,
        report_done: true,
        ...workReport,
        added_files: stringifyEx(workReport.added_files),
        deleted_files: stringifyEx(workReport.deleted_files),
    });

    await api.joinGroup(sworkerAccount, groupAccount.address);
}

async function simulateSmanagerAndSworkers(context: AppContext, 
    sworkerAccounts: Map<string, KeyringPair>, 
    groupMembersMap: Map<string, string[]>,
    sworkerKeys: Map<string, string>) {

  const { api, database } = context;
  const configOp = createConfigOps(database);

  // Get the reverse member->group map
  const memberGroupMap = new Map<string, string>();
  for (const [groupAddress, memberAddresses] of groupMembersMap) {
    for (const memberAddress of memberAddresses) {
        memberGroupMap.set(memberAddress, groupAddress);
    }
  }
  // Run the sworker simulator for each sworker
  for (const [sworkerAddress, sworkerAccount] of sworkerAccounts) {
    // DO NOT use await here because we just want them to run parallelly
    runSworkerSimulator(context, sworkerAccount, sworkerKeys.get(sworkerAddress), memberGroupMap.get(sworkerAddress));
  }

  // Get the last index block
  let lastIndexBlock: number = await configOp.readInt(KeySmanagerLastIndexBlock);
  if (_.isNil(lastIndexBlock) || lastIndexBlock === 0) {
    logger.info(`No '${KeySmanagerLastIndexBlock}' config found in DB, this is the first run, set to 1 by default`);
    lastIndexBlock = 1;
    // Save the retrieved value to DB
    configOp.saveInt(KeySmanagerLastIndexBlock, lastIndexBlock);
  }
  logger.info(`Smanager last index block: ${lastIndexBlock}`);

  let lastBlockTime = Dayjs();

  // Run the loop to simulate smanager to pull orders from chain and add to the queue in db
  while(true) {
    try {
      // Sleep a while
      await Bluebird.delay(6 * 1000);

      await api.ensureConnection();
      const curBlock: number = api.latestFinalizedBlock();
      if (lastIndexBlock >= curBlock) {
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

      // Iterate every block to get files to process
      for (let block = lastIndexBlock + 1; block <= curBlock; block++) {

        const [newFiles, closedFiles] = await api.parseNewFilesAndClosedFilesByBlock(block);
        logger.debug(`Block '${block}': handling ${newFiles.length} new files, ${closedFiles.length} closed files`);

        if (!_.isEmpty(newFiles)) {
            // create file record for every groupAddress, one file can only be processed by one sworker inside a group,
            // so here we distribute the same file to multiple queues named by groupAddress

            // First Get file_size from orders table
            const fileSizeRecords = await OrdersRecord.findAll({
                attributes: ['cid', 'file_size'],
                where: { cid: newFiles }
            });

            const cidToSizeMap = new Map<string, bigint>();
            for (const record of fileSizeRecords) {
                cidToSizeMap.set(record.cid, record.file_size);
            }

            const fileRecords = [];
            for (const cid of newFiles) {
                const fileSize = cidToSizeMap.get(cid);
                if (_.isNil(fileSize)) {
                    // This order is not generated by this test program, we just ignore it
                    continue;
                }
                for (const [groupAddress, _members] of groupMembersMap) {
                    fileRecords.push({
                        cid,
                        file_size: fileSize,
                        group_address: groupAddress
                    });
                }
            }
            
            if (fileRecords.length > 0) {
                await database.transaction(async (transaction) => {
                    await FilesRecord.bulkCreate(fileRecords, {
                        ignoreDuplicates: true, // Ignore on duplicate cid + group_address
                        transaction
                    });
                });   
            }  
        }
        if (!_.isEmpty(closedFiles)) {
            // Mark the is_to_cleanup flag for closed files
            await database.transaction(async (transaction) => {
                for (const cid of closedFiles) {
                    await FilesRecord.update({
                        is_to_cleanup: true
                    }, {
                        where: { cid: cid },
                        transaction
                    });
                }
            });
        }
        
        // Update the last processed block
        lastIndexBlock = block;
        configOp.saveInt(KeySmanagerLastIndexBlock, lastIndexBlock);
      }
    } catch(err) {
      logger.error(`💥 Error to simulate smanager: ${err}`);
    }
  } 
}

async function runSworkerSimulator(
    context: AppContext,
    sworkerAccount: KeyringPair,
    sworkerKey: string,
    groupAddress: string
) {
    const { api, database } = context;
    const sworkerAddress = sworkerAccount.address;

    // Re-create the logger object for this simulator with sworkerAddress as prefix
    const logger = createChildLogger({ moduleId: `${sworkerAddress}` });
    logger.info(`Run Sworker Simulator `);

    do {
        try {
            // Sleep a while
            await Bluebird.delay(1000);

            // Ensure connection and get the lastest finalized block
            await api.ensureConnection();
            let curBlock: number = api.latestFinalizedBlock();
            let reportSlot = Math.floor(curBlock/REPORT_SLOT) * REPORT_SLOT;
            
            // Only report works between 10th and 400th block in current slot, simulate the current sworker behavior
            let blockInSlot = curBlock % REPORT_SLOT;
            if ( blockInSlot < WORKREPORT_PROCESSOR_OFFSET || blockInSlot > (SPOWER_UPDATE_START_OFFSET-WORKREPORT_PROCESSOR_OFFSET) )  {
                let waitTime = 6000;
                if (blockInSlot < WORKREPORT_PROCESSOR_OFFSET) {
                waitTime = (WORKREPORT_PROCESSOR_OFFSET - blockInSlot) * 6 * 1000;
                } else {
                waitTime = (REPORT_SLOT - blockInSlot + WORKREPORT_PROCESSOR_OFFSET) * 6 * 1000;
                }

                logger.info(`Not in the work reports process block range, blockInSlot: ${blockInSlot}, wait for ${waitTime/1000} s`);
                await Bluebird.delay(waitTime);
                continue;
            }            

            // Get the last work report from DB
            const lastWorkReportDB = await WorkReportsRecord.findOne({
                where: {
                    sworker_address: sworkerAddress
                },
                order: [['slot','DESC']]
            });

            // If already reported, continue to next slot
            if (!_.isNil(lastWorkReportDB) && lastWorkReportDB.slot == reportSlot && lastWorkReportDB.report_done) {
                logger.warn(`Already reported on slot '${reportSlot}', skip and wait for next slot`);
                const waitTime = (REPORT_SLOT - blockInSlot) * 6000;
                await Bluebird.delay(waitTime);
                continue;
            }

            // Calculate random wait time to simulate sworker report works in random time
            const min = blockInSlot;
            const max = SPOWER_UPDATE_START_OFFSET - WORKREPORT_PROCESSOR_OFFSET;
            const randomWaitBlocks = Math.floor(Math.random() * (max - min));
            const waitTime = randomWaitBlocks * 6000;
            logger.info(`Wait for '${randomWaitBlocks}' blocks to report works`);
            await Bluebird.delay(waitTime);
            
            // Get the lock before we proceed
            logger.info(`Acquiring lock to proceed...`);
            const release = await files_record_lock.acquire();
            logger.info(`Acquired lock success!!`);
            try {
                // Get the latest finalized block again
                curBlock = api.latestFinalizedBlock(); 
                blockInSlot = curBlock % REPORT_SLOT;
                reportSlot = Math.floor(curBlock/REPORT_SLOT) * REPORT_SLOT;
                const reportSlotHash = await api.getBlockHash(reportSlot);
                
                // Get the latest work report from chain
                const workReportOnChain: WorkReportOnChain = await api.getWorkReport(sworkerKey);
                // Check the consistency between local and chain
                if (!_.isNil(lastWorkReportDB) && !_.isNil(workReportOnChain)) {
                    if (lastWorkReportDB.slot < workReportOnChain.report_slot) {
                        logger.warn(`Local report slot '${lastWorkReportDB.slot}' is less than on-chain report slot '${workReportOnChain.report_slot}', this should not happen!`);
                        const workReportOnChainSlotHash = await api.getBlockHash(workReportOnChain.report_slot);
                        // Insert the workReportOnChain to DB
                        await WorkReportsRecord.create({
                            sworker_address: sworkerAddress,
                            slot: workReportOnChain.report_slot,
                            slot_hash: workReportOnChainSlotHash.toString(),
                            report_block: workReportOnChain.report_slot, // Just use the report_slot as report_block
                            report_done: true,
                            curr_pk: sworkerKey,
                            ab_upgrade_pk: '0x',
                            reported_srd_size: BigInt(1_000_000_000_000),
                            reported_files_size: workReportOnChain.reported_files_size,
                            added_files: JSON.stringify([]),
                            deleted_files: JSON.stringify([]),
                            reported_srd_root: '0x',
                            reported_files_root: '0x',
                            sig: '0x'
                        });
                    } else if (lastWorkReportDB.slot > workReportOnChain.report_slot) {
                        logger.warn(`Local report slot '${lastWorkReportDB.slot}' is larger than on-chain report slot '${workReportOnChain.report_slot}', restore the data`);
                        restoreData(sworkerAddress, groupAddress, lastWorkReportDB.slot, database);
                    } else {
                        // Slot are equal, mark the local record as done if not yet
                        if (!lastWorkReportDB.report_done) {
                            logger.warn(`Slot are equal, mark the local record as done if not yet`);
                            markAsDone(sworkerAddress, groupAddress, lastWorkReportDB.slot, database);
                        }
                    }
                }

                ///-------------------------------------------------------------------------------
                // Get non-occupied files from file_records table
                logger.info(`Retrieve to-add files and to-delete files to construct work reports`);
                const toAddFiles = await FilesRecord.findAll({
                    where: { 
                        group_address: groupAddress,
                        reported_sworker_address: null,
                        is_to_cleanup: false,
                        cleanup_done: false
                    },
                    order: [['create_at', 'ASC']],
                    limit: 300 // One work report has 300 files limit for added_files
                });

                // Get to-delete files 
                const toDeleteFiles = await FilesRecord.findAll({
                    where: {
                        group_address: groupAddress,
                        reported_sworker_address: sworkerAddress,
                        is_to_cleanup: true,
                        cleanup_done: false
                    },
                    order: [['create_at', 'ASC']],
                    limit: 295 // One work report has 300 files limit for deleted_files, leave 5 for random delete files
                });

                // Random delete files
                if (Math.random() < 0.3) {
                    const randomDeleteFiles = await FilesRecord.findAll({
                        where: {
                            group_address: groupAddress,
                            reported_sworker_address: sworkerAddress,
                            is_to_cleanup: false,
                            cleanup_done: false
                        },
                        order: [['create_at', 'ASC']],
                        limit: 5
                    });

                    toDeleteFiles.push(...randomDeleteFiles);
                }

                // Calculate the total added_files_size and total deleted_files_size
                let total_added_files_size = BigInt(0);
                let total_deleted_files_size = BigInt(0);
                for (const file of toAddFiles) {
                    total_added_files_size += BigInt(file.file_size);
                }
                for (const file of toDeleteFiles) {
                    total_deleted_files_size += BigInt(file.file_size);
                }

                // Construct work report request 
                const fileParser = (file: FilesRecord) => {
                    const rst: [string, bigint, number] = [stringToHex(file.cid), BigInt(file.file_size), curBlock];
                    return rst;
                };
                
                const last_reported_files_size = _.isNil(lastWorkReportDB) ? BigInt(0) : BigInt(lastWorkReportDB.reported_files_size);
                const new_reported_files_size = last_reported_files_size + total_added_files_size - total_deleted_files_size
                const workReport = {
                    curr_pk: sworkerKey,
                    ab_upgrade_pk: '0x',
                    slot: reportSlot,
                    slot_hash: reportSlotHash.toString(),
                    reported_srd_size: BigInt(1_000_000_000_000),
                    reported_files_size: new_reported_files_size,
                    added_files: toAddFiles.map(fileParser),
                    deleted_files: toDeleteFiles.map(fileParser),
                    reported_srd_root: '0x',
                    reported_files_root: '0x',
                    sig: '0x',
                }

                // Update DB data before sending to chain
                await database.transaction(async (transaction) => {
                    // Save work report to DB and mark report_done as false
                    const workRecortRecord = {
                        sworker_address: sworkerAddress,
                        report_block: curBlock,
                        report_done: false, // Update to true after sending to chain successfully
                        ...workReport,
                        added_files: stringifyEx(workReport.added_files),
                        deleted_files: stringifyEx(workReport.deleted_files),
                    };
                    await WorkReportsRecord.create(workRecortRecord, {
                        transaction
                    });

                    // Save file records to DB and mark report_done as false
                    const toUpdateRecordsOfAddedFiles = [];
                    for (const file of toAddFiles) {
                        toUpdateRecordsOfAddedFiles.push({
                            cid: file.cid,
                            group_address: groupAddress,
                            file_size: file.file_size,
                            reported_sworker_address: sworkerAddress,
                            reported_block: curBlock,
                            reported_slot: reportSlot,
                            report_done: false
                        });
                    }
                    await FilesRecord.bulkCreate(toUpdateRecordsOfAddedFiles,{
                        updateOnDuplicate: ['reported_sworker_address', 'reported_block', 'reported_slot', 'report_done'],
                        transaction
                    });

                    const toUpdateRecordsOfDeletedFiles = [];
                    for (const file of toDeleteFiles) {
                        toUpdateRecordsOfDeletedFiles.push({
                            cid: file.cid,
                            group_address: groupAddress,
                            file_size: file.file_size,
                            cleanup_done: true,
                            report_done: false
                        });
                    }
                    await FilesRecord.bulkCreate(toUpdateRecordsOfDeletedFiles,{
                        updateOnDuplicate: ['cleanup_done', 'report_done'],
                        transaction
                    });
                });

                // Send work report
                logger.info(`reporting works at slot '${reportSlot}' (block '${curBlock}') with ${toAddFiles.length} added_files and ${toDeleteFiles.length} deleted_files ...`);
                const result = await api.sworkerReportWorks(sworkerAccount, workReport);

                if (result) {
                    logger.info(`report works success, mark db data as done`);
                    markAsDone(sworkerAddress, groupAddress, reportSlot, database);                                       
                } else {
                    // Report works failed, reset the record
                    logger.info(`Report works failed, reset the record`);
                    restoreData(sworkerAddress, groupAddress, reportSlot, database);
                }
            } catch(err) {
                throw err;
            } finally {
                release();
            }
        } catch(err) {
            logger.error(`💥 Error for Sworker Simulator: ${err}`);
        }
    } while(true);
}

async function markAsDone(sworkerAddress: string, groupAddress: string, reportSlot: number, database: Sequelize) {
    await database.transaction(async (transaction) => {
        // Update work_reports DB status
        await WorkReportsRecord.update({
            report_done: true
        }, {
            where: {
                sworker_address: sworkerAddress,
                slot: reportSlot
            },
            transaction
        });
        
        // Update file_records DB, just mark all the report_done as true
        await FilesRecord.update({
            report_done: true
        }, {
            where: {
                group_address: groupAddress,
                reported_sworker_address: sworkerAddress,
                report_done: false
            },
            transaction
        });         
    }); 
    
}

async function restoreData(sworkerAddress: string, groupAddress: string, reportSlot: number, database: Sequelize) {
    await database.transaction(async (transaction) => {
        await WorkReportsRecord.destroy({
            where: {
                sworker_address: sworkerAddress,
                slot: reportSlot
            }
        });

        // For added_files
        await FilesRecord.update({
            reported_sworker_address: null,
            reported_block: null,
            reported_slot: null,
        }, {
            where: {
                group_address: groupAddress,
                reported_sworker_address: sworkerAddress,
                report_done: false,
                cleanup_done: false
            },
            transaction
        });

        // For deleted_files
        await FilesRecord.update({
            cleanup_done: false
        }, {
            where: {
                group_address: groupAddress,
                reported_sworker_address: sworkerAddress,
                report_done: false,
                cleanup_done: true
            },
            transaction
        });
    });
}