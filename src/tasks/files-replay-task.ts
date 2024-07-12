/**
 * The files replay task is to re-place old orders to make their spower take effect and try to increase their replica count 
 */

import { Logger } from 'winston';
import { AppContext } from '../types/context';
import _ from 'lodash';
import { sleep } from '../utils';
import { FilesReplayRecord, FilesV2Record } from '../types/database';
import { createChildLogger } from '../utils/logger';
import  got from 'got';
import { Op } from 'sequelize';
import { createConfigOps } from '../db/configs';
import { Keyring } from '@polkadot/api';
import { KeyringPair } from '@polkadot/keyring/types';
import { TaskName } from './polkadot-js-gc-lock';

const KeyFilesRelayerReplayCountPerHour = 'files-replay-task:replay-count-per-hour';
const KeyFilesReplayerRequestParallelCount = 'files-replay-task:request-parallel-count';
let IsFilesReplaying = false;
let replayAccountKrp: KeyringPair = null;
const logger = createChildLogger({ moduleId: 'files-replayer' });

async function startReplayFilesTask(
    context: AppContext
): Promise<void> {
    const { api, database, config, gcLock } = context;
    const configOp = createConfigOps(database);
    let totalBatchExecuteTime = 0;
    let totalBatchExecuteCount = 0;
    const fileReplayOrderPlaceMode = config.chain.fileReplayOrderPlaceMode;
    
    // Set the flag first
    if (IsFilesReplaying) {
        logger.warn('Files replayer is already running, can not run multiple replayer at the same time, exit out...');
        return;
    }
    IsFilesReplaying = true;
    logger.info('Start to run files replayer...');

    // Trigger to run replay result updater
    startUpdateReplayResultTask(context);

    // Create the krp if the file order replay mode is 'Chain'
    if (fileReplayOrderPlaceMode == 'Chain') {
        const kr = new Keyring({type: 'sr25519'});
        replayAccountKrp = kr.addFromUri(config.chain.replayAccountSeed);
    }

    // Start the processing loop
    while (!context.isStopped) {
        try {
            // Sleep a while
            await sleep(1000);

            // Get the replayCountPerHour from DB config every round
            let replayCountPerHour = await configOp.readInt(KeyFilesRelayerReplayCountPerHour);
            if (_.isNil(replayCountPerHour) || replayCountPerHour <= 0) {
                logger.info(`No '${KeyFilesRelayerReplayCountPerHour}' config found in DB, set the default value to 300`);
                replayCountPerHour = 300;
                configOp.saveInt(KeyFilesRelayerReplayCountPerHour, replayCountPerHour);
            }
            logger.info(`replayCountPerHour: ${replayCountPerHour}`);

            // Get the requestParallelCount from DB config every round
            let requestParallelCount = await configOp.readInt(KeyFilesReplayerRequestParallelCount);
            if (_.isNil(requestParallelCount) || requestParallelCount <= 0) {
                logger.info(`No '${KeyFilesReplayerRequestParallelCount}' config found in DB, set the default value to 5`);
                requestParallelCount = 5;
                configOp.saveInt(KeyFilesReplayerRequestParallelCount, requestParallelCount);
            }
            logger.info(`requestParallelCount: ${requestParallelCount}`);

            // Read new files from the files_replay table
            const toReplayRecords = await FilesReplayRecord.findAll({
                attributes: ['cid', 'file_size'],
                where: {
                    status: ['new', 'failed']
                },
                limit: replayCountPerHour
            });

            if (toReplayRecords.length === 0) {
                logger.info(`No more new files to replay, exit out the replayer`);
                break;
            }

            logger.info(`Get ${toReplayRecords.length} files to replay`);

            // Replay the files parallelly
            const startTime = Date.now();
            const requestBatchCount = Math.ceil(toReplayRecords.length / requestParallelCount);
            for (let i = 0; i < toReplayRecords.length; i += requestParallelCount) {
                const toReplayRecordsChunk = toReplayRecords.slice(i, i + requestParallelCount);
                // Generate te promise object for this trunk
                let nonce = null;
                if (fileReplayOrderPlaceMode == 'Chain') {
                    // Acquire gc lock if place mode is 'Chain'
                    await gcLock.acquireTaskLock(TaskName.FilesReplayTask);
                    // Retrieve the latest next nonce for the replayAccount
                    nonce = parseInt(await api.chainApi().rpc.system.accountNextIndex(replayAccountKrp.address) as any);
                }
                const requestsBatch = [];
                for (const record of toReplayRecordsChunk) {
                    const fileReplayTask = async () => {
                        const cid = record.cid;
                        const fileSize = record.file_size;
                        let result = false;
                        try {
                            logger.info(`Start to replay '${cid}'`);
                            // Re-place the order through Crust Pinning service or send market.placeStorageOrder transaction
                            const orderPlaceResult = await placeOrder(cid, fileSize, nonce, context, logger);

                            if (orderPlaceResult) {
                                const replayBlock = api.latestFinalizedBlock();
                                await FilesReplayRecord.update({
                                    status: 'replayed',
                                    replay_block: replayBlock
                                }, {
                                    where: { cid },
                                });

                                logger.info(`Replay '${cid}' success`);
                            } else {
                                await FilesReplayRecord.update({
                                    status: 'failed'
                                }, {
                                    where: { cid },
                                });

                                logger.warn(`Replay '${cid}' failed, try in next time`);
                            }
                            result = true;
                        } catch(err) {
                            logger.warn(`💥 Error to replay file '${cid}': ${err}`);
                        }
                        return result;
                    };

                    requestsBatch.push(new Promise((resolve, reject)=>{
                        fileReplayTask().then(resolve).catch(reject);     
                    }));

                    // Increase nonce if it's under 'Chain' order place mode
                    if (fileReplayOrderPlaceMode == 'Chain' && !_.isNil(nonce)) {
                        nonce++;
                    }
                }

                const batchStartTime = Date.now();
                await Promise.all(requestsBatch);
                const batchEndTime = Date.now();
                const batchExecuteTime = batchEndTime - batchStartTime;
                logger.info(`Finish execute request batch #${i+1} in ${(batchExecuteTime/1000).toFixed(2)}s`);

                // Release the gc lock
                if (fileReplayOrderPlaceMode == 'Chain') {
                    await gcLock.releaseTaskLock(TaskName.FilesReplayTask);
                }
                // Sleep a while to try to make the request distribute evenly within an hour
                totalBatchExecuteTime += batchExecuteTime;
                totalBatchExecuteCount++;
                const avgBatchExecuteTime = totalBatchExecuteTime / totalBatchExecuteCount;
                const elapsedTime = Date.now() - startTime;
                const remainingBatchCount = requestBatchCount - (i+1);
                if (remainingBatchCount == 0)
                    break;

                // (Remaining time - Estimate remaining execute time) / Remaining batch count
                const sleepTime = (3600000 - elapsedTime - (avgBatchExecuteTime*remainingBatchCount)) / remainingBatchCount;
                if (sleepTime < 0) {
                    // Don't need any sleep, continue to next file immediately
                    continue;
                }
                logger.info(`Sleep ${(sleepTime/1000).toFixed(2)}s for next file batch replay`);
                await sleep(sleepTime);
            }
        } catch (err) {
            logger.error(`💥 Error to replay files: ${err}`);
            // Release the gc lock
            if (fileReplayOrderPlaceMode == 'Chain') {
                await gcLock.releaseTaskLock(TaskName.FilesReplayTask);
            }
            // Sleep a while when exception throws
            await sleep(10*1000);
        }
    }

    // Processing done, reset the flag
    IsFilesReplaying = false;
    logger.info('End to run files replayer');
}

async function placeOrder(cid: string, fileSize: bigint, nonce: number, context: AppContext, logger: Logger): Promise<boolean> {
    const { config, api } = context;
    const fileReplayOrderPlaceMode = config.chain.fileReplayOrderPlaceMode;
    const pinServiceAuthHeader = config.chain.pinServiceAuthHeader;
    let result = false;

    try {
        if (fileReplayOrderPlaceMode == 'Pinner') {
            // Pinner mode
            const response = await got.post(
                'https://pin.crustcode.com/psa/pins',
                {
                    headers: {
                        'Authorization': pinServiceAuthHeader,
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
                    },
                    json: { cid }
                }
            );

            if (response && response.statusCode <= 300) {
                result = true;
            } else {
                logger.warn(`Failed to pin file '${cid}': Reponse Code: ${response?response.statusCode:'Null Response'}`);
                result = false;
            }
        } else {
            // Chain mode, send transaction directly
            result = await api.placeStorageOrder(replayAccountKrp, nonce, cid, fileSize);
        }
    } catch (err) {
        logger.warn(`💥 Error in place order for file '${cid}': ${err}`);
    }

    return result;
}

async function startUpdateReplayResultTask(
    context: AppContext
): Promise<void> {
    const { database, api } = context;
    const batchSize = 500;
    const logger = createChildLogger({ moduleId: 'files-replayer-update-task' });

    logger.info('Start to run update replay result task...');

    while(!context.isStopped) {
        try {
            // Sleep a while
            await sleep(1000);

            let lastUpdatedId = 0;
            while (true) {
                // Read 'replayed' files from the files_replay table
                const toUpdateRecords = await FilesReplayRecord.findAll({
                    attributes: ['id', 'cid', 'replay_block'],
                    where: {
                        status: 'replayed',
                        id: { [Op.gt]: lastUpdatedId }
                    },
                    order: [['id','ASC']],
                    limit: batchSize
                });

                if (toUpdateRecords.length === 0) {
                    logger.info(`No more files to update, finish this round`);
                    break;
                }
                logger.info(`Get ${toUpdateRecords.length} files to update`);

                // Get the latest file info from files_v2 data
                const cids = toUpdateRecords.map((r: any) => r.cid);
                const filesV2Records = await FilesV2Record.findAll({
                    attributes: ['cid', 'expired_at', 'reported_replica_count'],
                    where: { 
                        cid: cids
                    }
                });
                logger.info(`Retrieve ${filesV2Records.length} records from files_v2 table`);

                const filesV2Map = new Map<string, FilesV2Record>();
                for (const record of filesV2Records) {
                    filesV2Map.set(record.cid, record);
                }

                // Construct the update result
                const updateOneHourReplicaCountResults = [];
                const updateTwoHourReplicaCountResults = [];
                const updateThreeHourReplicaCountResults = [];
                const updateSixHourReplicaCountResults = [];
                const updateOneDayReplicaCountResults = [];
                const updateDoneResults = [];
                for (const record of toUpdateRecords) {
                    const fileV2Record = filesV2Map.get(record.cid);
                    if (_.isNil(fileV2Record)) {
                        // File has been closed? Mark as closed
                        updateDoneResults.push({
                            id: record.id,
                            cid: record.cid,
                            status: 'closed'
                        });
                    }

                    const diffBlockCount = api.latestFinalizedBlock() - record.replay_block;
                    if (diffBlockCount <= 600) {
                        updateOneHourReplicaCountResults.push({
                            id: record.id,
                            cid: record.cid,
                            status: 'replayed',
                            latest_expired_at: fileV2Record.expired_at,
                            one_hour_replica_count: fileV2Record.reported_replica_count
                        });
                    } else if (diffBlockCount <= 1200) {
                        updateTwoHourReplicaCountResults.push({
                            id: record.id,
                            cid: record.cid,
                            status: 'replayed',
                            latest_expired_at: fileV2Record.expired_at,
                            two_hour_replica_count: fileV2Record.reported_replica_count
                        });
                    } else if (diffBlockCount <= 1800) {
                        updateThreeHourReplicaCountResults.push({
                            id: record.id,
                            cid: record.cid,
                            status: 'replayed',
                            latest_expired_at: fileV2Record.expired_at,
                            three_hour_replica_count: fileV2Record.reported_replica_count
                        });
                    } else if (diffBlockCount <= 3600) {
                        updateSixHourReplicaCountResults.push({
                            id: record.id,
                            cid: record.cid,
                            status: 'replayed',
                            latest_expired_at: fileV2Record.expired_at,
                            six_hour_replica_count: fileV2Record.reported_replica_count
                        });
                    } else if (diffBlockCount <= 14400) {
                        updateOneDayReplicaCountResults.push({
                            id: record.id,
                            cid: record.cid,
                            status: 'replayed',
                            latest_expired_at: fileV2Record.expired_at,
                            one_day_replica_count: fileV2Record.reported_replica_count
                        });
                    } else {
                        // Make sure to update the final data 
                        updateOneDayReplicaCountResults.push({
                            id: record.id,
                            cid: record.cid,
                            status: 'processed',
                            latest_expired_at: fileV2Record.expired_at,
                            one_day_replica_count: fileV2Record.reported_replica_count
                        });
                        // Already over one day, mark as done
                        updateDoneResults.push({
                            id: record.id,
                            cid: record.cid,
                            status: 'processed'
                        });
                    }
                }

                // Update results in batch in a transaction
                logger.info(`Start to update results to DB in batch`);
                await database.transaction(async (transaction) => {
                    // Update replica count results
                    await FilesReplayRecord.bulkCreate(updateOneHourReplicaCountResults, {
                        updateOnDuplicate: ['latest_expired_at', 'one_hour_replica_count'],
                        transaction
                    });
                    await FilesReplayRecord.bulkCreate(updateTwoHourReplicaCountResults, {
                        updateOnDuplicate: ['latest_expired_at', 'two_hour_replica_count'],
                        transaction
                    });
                    await FilesReplayRecord.bulkCreate(updateThreeHourReplicaCountResults, {
                        updateOnDuplicate: ['latest_expired_at', 'three_hour_replica_count'],
                        transaction
                    });
                    await FilesReplayRecord.bulkCreate(updateSixHourReplicaCountResults, {
                        updateOnDuplicate: ['latest_expired_at', 'six_hour_replica_count'],
                        transaction
                    });
                    await FilesReplayRecord.bulkCreate(updateOneDayReplicaCountResults, {
                        updateOnDuplicate: ['status', 'latest_expired_at', 'one_day_replica_count'],
                        transaction
                    });
                
                    // Update status results
                    await FilesReplayRecord.bulkCreate(updateDoneResults, {
                        updateOnDuplicate: ['status'],
                        transaction
                    });
                });

                // Update the lastUpdatedId
                lastUpdatedId = (_.last(toUpdateRecords) as any).id;
            } // end loop

            // Get the current existing 'replayed' records count
            const replayedRecordsCount = await FilesReplayRecord.count({
                where: {
                    status: 'replayed'
                }
            });
            
            if (replayedRecordsCount > 0 || IsFilesReplaying == true) {
                // files replayer is still runnning, or there still exist 'replayed' records, keep running this task
                // Update replay results every 15 minutes
                logger.info('Wait 15 minutes for next round');
                await sleep(15 * 60 * 1000);
            } else {
                logger.info('files replayer has stopped and all records have been processed, exit out this task');
                break;
            }
        } catch (err) {
            logger.error(`💥 Error to update replay result: ${err}`);
            // Sleep a while when exception throws
            await sleep(10*1000);
        }
    }

    logger.info('End to run update replay result task');
}

export function triggerFilesReplayer(context: AppContext): { code: string, msg: string } {

  if (IsFilesReplaying) {
    return {
      code: 'ERROR',
      msg: 'Files replayer is already running, can not trigger multiple times'
    };
  } else {
    // DO NOT 'await' here, we just let it run asynchronouslly
    startReplayFilesTask(context);
    return {
      code: 'OK',
      msg: 'Trigger to run files replayer successfully',
    }
  }
}