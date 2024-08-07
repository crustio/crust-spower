/**
 * The work reports processor task to consolidate batch of work reports to file replicas data, 
 * and then update the replicas data to Crust Mainnet chain.
 */

import { Logger } from 'winston';
import { createWorkReportsToProcessOperator } from '../db/work-reports-to-process';
import { AppContext } from '../types/context';
import { SimpleTask } from '../types/tasks';
import { IsStopped, makeIntervalTask } from './task-utils';
import { FileToUpdate, ReplicaToUpdate, WorkReportsToProcess } from '../types/chain';
import _ from 'lodash';
import Bluebird from 'bluebird';
import { REPORT_SLOT, SPOWER_UPDATE_START_OFFSET, WORKREPORT_PROCESSOR_OFFSET } from '../utils/consts';
import { createConfigOps } from '../db/configs';
import { TaskName } from './polkadot-js-gc-lock';
import { KeySpowerCalculatorEnabled } from './spower-calculator-task';
import { ConfigOperator } from '../types/database';

export const KeyWorkReportsLastProcessBlock = 'work-reports-processor:last-process-block';
/**
 * main entry funciton for the task
 */
async function processWorkReports(
  context: AppContext,
  logger: Logger,
  isStopped: IsStopped,
) {
  const { api, database, config, gcLock } = context;
  const configOp = createConfigOps(database);
  const workReportsOp = createWorkReportsToProcessOperator(database);

  // The default blocks to process batch size is 10
  // Right now there're around 1600 sworker nodes in the whole chain, 1600 work reports will be sent 
  // from the 10th to 399th block in one slot, that means 1600 wrs in 390 blocks, average 4~5 wrs/block
  // 10 blocks will have around 50 work reports, assume average ~100 files/work report, 
  // there would be ~5000 files in total, maximum 15000 files
  const configBatchSize = config.chain.workReportsProcesserBatchSize;
  const workReportsProcessorInterval = config.chain.workReportsProcessorInterval;

  // Get the files count limit for each extrinsic call
  const workReportsProcesserFilesCountLimit = config.chain.workReportsProcesserFilesCountLimit;

  while(!isStopped()) {
    try {
      // Sleep a while
      await Bluebird.delay(1 * 1000);

      await gcLock.acquireTaskLock(TaskName.WorkReportsProcessorTask);

      // Ensure connection and get the lastest finalized block
      await api.ensureConnection();
      const curBlock: number = api.latestFinalizedBlock();

      // Only process the work reports within 10th ~ 400th block within one slot
      // The reason for end block 400th is to give the final round some time to calculate and update the replicas on chain
      // The spower-calculator-task will calculate the spower within the 410th ~ 490th block within the slot
      // Separate the replicas update and spower calculation to avoid race condition and inconsistent data
      const blockInSlot = curBlock % REPORT_SLOT;
      let isSpowerCalcTaskEnabled = await checkSpowerCalculatorTaskEnabled(configOp);
      if (isSpowerCalcTaskEnabled && 
          (blockInSlot < WORKREPORT_PROCESSOR_OFFSET || blockInSlot > (SPOWER_UPDATE_START_OFFSET-WORKREPORT_PROCESSOR_OFFSET)) )  {
        logger.info(`Not in the work reports process block range, blockInSlot: ${blockInSlot}, keep waiting..`);

        let waitTime = 6000;
        if (blockInSlot < WORKREPORT_PROCESSOR_OFFSET) {
          waitTime = (WORKREPORT_PROCESSOR_OFFSET - blockInSlot) * 6 * 1000;
        } else {
          waitTime = (REPORT_SLOT - blockInSlot + WORKREPORT_PROCESSOR_OFFSET) * 6 * 1000;
        }

        await gcLock.releaseTaskLock(TaskName.WorkReportsProcessorTask);
        await Bluebird.delay(waitTime);
        continue;
      }

      // Get the last processed block from config DB
      let lastProcessBlock = await configOp.readInt(KeyWorkReportsLastProcessBlock);
      if (_.isNil(lastProcessBlock)) {
        logger.info(`No '${KeyWorkReportsLastProcessBlock}' config found in DB, this is the first run, set to current block ${curBlock}`);
        lastProcessBlock = curBlock;
        
        configOp.saveInt(KeyWorkReportsLastProcessBlock, lastProcessBlock);
      }

      // Check running interval
      const interval = curBlock - lastProcessBlock;
      if ( interval < workReportsProcessorInterval) {
        logger.info(`Not reach interval yet, wait for ${workReportsProcessorInterval-interval} blocks`);
        await gcLock.releaseTaskLock(TaskName.WorkReportsProcessorTask);
        await Bluebird.delay((workReportsProcessorInterval-interval) * 6 * 1000);
        continue;
      }

      //////////////////////////////////////////////////////////////
      // Perform the process
      logger.info(`Start to process work reports at block '${curBlock}' (block in slot: ${blockInSlot})`);
      configOp.saveInt(KeyWorkReportsLastProcessBlock, curBlock);

      // There maybe many work reports before the curBlock, so we need to loop here
      let round = 0;
      let overrideBatchSize = null;
      while(!isStopped()) {
        // Check the latest block and break out if larger than SPOWER_UPDATE_START_OFFSET
        const latestBlock: number = api.latestFinalizedBlock();
        const latestBlockInSlot = latestBlock % REPORT_SLOT;
        isSpowerCalcTaskEnabled = await checkSpowerCalculatorTaskEnabled(configOp);
        if (isSpowerCalcTaskEnabled &&
            (latestBlockInSlot>(SPOWER_UPDATE_START_OFFSET-WORKREPORT_PROCESSOR_OFFSET)) ) {
          logger.info(`Current block in slot: '${latestBlockInSlot}' (block '${latestBlock}') is after spower_update_start_offset  '${SPOWER_UPDATE_START_OFFSET-WORKREPORT_PROCESSOR_OFFSET}', wait for spower update complete...`);
          break;
        }

        // Get batch of work reports before the curBlock
        const batchSize = _.isNil(overrideBatchSize) ? configBatchSize : overrideBatchSize;
        const blocksOfWorkReports = await workReportsOp.getPendingWorkReports(batchSize, curBlock);
        if (blocksOfWorkReports.length === 0) {
          logger.info(`No more work reports to process, break out and wait for the interval`);
          break;
        }

        // Start a new round
        round++;
        logger.info(`Round ${round}: ${blocksOfWorkReports.length} blocks of work reports to process.`);
        
        // -----------------------------------------------------------
        // 1. Aggregate all work reports to file replicas info
        const filesInfoMap = new Map<string, FileToUpdate>(); // Key is cid
        const recordIdsProcessed = [];
        let totalWorkReportsCount = 0;
        let totalReplicasCount = 0;
        for (const record of blocksOfWorkReports) {
          recordIdsProcessed.push(record.id);
          const workReports: WorkReportsToProcess[] = JSON.parse(record.work_reports) as WorkReportsToProcess[];
          for (const wr of workReports) {
            const { added_files, deleted_files } = wr;

            const added_files_array: [] = _.isNil(added_files) ? [] : added_files;
            const deleted_files_array: [] = _.isNil(deleted_files) ? [] : deleted_files;
            createFileReplicas(filesInfoMap, wr, added_files_array, true);
            createFileReplicas(filesInfoMap, wr, deleted_files_array, false);

            totalWorkReportsCount++;
            totalReplicasCount += added_files_array.length + deleted_files_array.length;
          }
        }
        /// -------------------------------------------------------
        /// Check whether exceeds the files count limit, if exceeds, use a smaller batch size, minimum batchSize is 1
        if (filesInfoMap.size > workReportsProcesserFilesCountLimit && batchSize > 1) {
          overrideBatchSize =  Math.ceil(batchSize/2);
          logger.warn(`Retrieved files count: ${filesInfoMap.size} exceeds the files count limit: ${workReportsProcesserFilesCountLimit}, reprocess using a smaller batch size: ${overrideBatchSize}`);
          continue;
        } else {
          // Reset the override batch size
          overrideBatchSize = null;
        }

        // ---------------------------------------------------------------
        // 2. Update the replicas data to Crust Mainnet Chain
        logger.info(`Work reports count: ${totalWorkReportsCount}, Updated files count: ${filesInfoMap.size}, Updated Replicas count: ${totalReplicasCount}`);
        const result = await api.updateReplicas(filesInfoMap, _.last(blocksOfWorkReports).report_block);
        if (result === true) {
          await workReportsOp.updateStatus(recordIdsProcessed, 'processed');
        }
        else {
          await workReportsOp.updateStatus(recordIdsProcessed, 'failed');
        }
      }
    } catch (err) {
      logger.error(`Work report processed failed. Error: ${err}`);
    } finally {
      await gcLock.releaseTaskLock(TaskName.WorkReportsProcessorTask);
    }
  }
}

function createFileReplicas(filesInfoMap: Map<string, FileToUpdate>, wr: WorkReportsToProcess, updated_files: [], is_added: boolean) {

  for (const newFile of updated_files) {
    const cid = newFile[0];
    const fileSize = newFile[1];
    const validAtSlot = newFile[2];

    let fileInfo: FileToUpdate = filesInfoMap.get(cid);

    if (!fileInfo) {
      fileInfo = {
        cid: cid,
        file_size: fileSize,
        replicas: [],
      };

      filesInfoMap.set(cid, fileInfo);
    }

    const fileReplica: ReplicaToUpdate = {
      reporter: wr.reporter,
      owner: wr.owner,
      sworker_anchor: wr.sworker_anchor,
      report_slot: wr.report_slot,
      report_block: wr.report_block,
      valid_at: validAtSlot,
      is_added: is_added,
    };

    fileInfo.replicas.push(fileReplica);
  }
          
}

async function checkSpowerCalculatorTaskEnabled(configOp: ConfigOperator): Promise<boolean> {
  const isEnabled = await configOp.readInt(KeySpowerCalculatorEnabled);
  if (!_.isNil(isEnabled) && isEnabled === 0) {
    return false;
  }

  return true;
}

export async function createWorkReportsProcessor(
  context: AppContext,
  loggerParent: Logger,
): Promise<SimpleTask> {
  // TODO: make it configurable
  const processInterval = 10 * 1000;
  return makeIntervalTask(
    5 * 1000,
    processInterval,
    'work-reports-processor',
    context,
    loggerParent,
    processWorkReports,
  );
}
