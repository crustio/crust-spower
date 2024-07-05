import { AppContext } from '../types/context';
import { Request, Response } from 'express';
import { createChildLogger } from '../utils/logger';
import { FilesV2Record, WorkReportsToProcessRecord } from '../types/database';
import { createConfigOps } from '../db/configs';
import { KeyWorkReportsLastProcessBlock } from '../tasks/work-reports-processor-task';
import { KeyIndexChangedLastIndexBlock, KeyIndexChangedLastSyncBlock, triggerManualFilesIndexer } from '../tasks/files-v2-indexer-task';
import { KeyLastSpowerUpdateBlock } from '../tasks/spower-calculator-task';
import { KeyLastIndexBlockWrs } from '../tasks/work-reports-indexer-task';
import { Op } from 'sequelize';
import { convertBlockNumberToReportSlot } from '../utils';
import { SPOWER_UPDATE_START_OFFSET } from '../utils/consts';
import { Dayjs } from '../utils/datetime';

const logger = createChildLogger({ moduleId: 'api-metrics' });

export async function stats(_req: Request, res: Response, context: AppContext): Promise<void> {

  const { database, api } = context;
  const configOp = createConfigOps(database);

  try {
    logger.info('Start to collect stats...');

    // Get statistics of work-reports-to-process table
    const totalWorkReportsCounts = await WorkReportsToProcessRecord.count();
    const newWorkReportsCounts = await WorkReportsToProcessRecord.count({
      where: {
        status: 'new',
      },
    });
    const failedWorkReportsCounts = await WorkReportsToProcessRecord.count({
      where: {
        status: 'failed',
      },
    });
    const lastIndexBlockOfWorkReports = await configOp.readInt(KeyLastIndexBlockWrs);
    const lastProcessedBlockOfWorkReports = await configOp.readInt(KeyWorkReportsLastProcessBlock);
    
    // Get statistics of files-v2 table
    const totalFilesV2Counts = await FilesV2Record.count();
    const lastIndexBlockOfFilesV2 = await configOp.readInt(KeyIndexChangedLastIndexBlock);
    const lastSyncBlock = await configOp.readInt(KeyIndexChangedLastSyncBlock);
    const lastSpowerUpdateBlock = await configOp.readInt(KeyLastSpowerUpdateBlock);
    const needSyncCount = await FilesV2Record.count({
      where: {
        need_sync: true
      }
    })
    const curBlock = api.latestFinalizedBlock();
    const currentReportSlot = convertBlockNumberToReportSlot(curBlock);
    const totalNeedSpowerUpdateCount = await FilesV2Record.count({
      where: {
        next_spower_update_block: { [Op.ne]: null}
      }
    });
    const currentRSNeedSpowerUpdateCount = await FilesV2Record.count({
      where: {
        next_spower_update_block: { [Op.lt]: (currentReportSlot + SPOWER_UPDATE_START_OFFSET) }
      }
    });
    const oneDayNeedSpowerUpdateCount = await FilesV2Record.count({
      where: {
        next_spower_update_block: { [Op.lt]: (curBlock + 600 * 24) }
      }
    });
    const oneWeekNeedSpowerUpdateCount = await FilesV2Record.count({
      where: {
        next_spower_update_block: { [Op.lt]: (curBlock + 600 * 24 * 7) }
      }
    });
    const oneMonthNeedSpowerUpdateCount = await FilesV2Record.count({
      where: {
        next_spower_update_block: { [Op.lt]: (curBlock + 600 * 24 * 28) }
      }
    });

    const version = process.env.npm_package_version || 'unknown';
    const uptime = Dayjs.duration(Dayjs().diff(context.startTime)).asHours();

    const result = {
        code: 'OK',
        msg: '',
        data: {
          application: {
            version,
            uptime
          },
          workReportsToProcess: {
            totalCount: totalWorkReportsCounts,
            newCount: newWorkReportsCounts,
            failedCount: failedWorkReportsCounts,
            lastIndexBlock: lastIndexBlockOfWorkReports,
            lastProcessedBlock: lastProcessedBlockOfWorkReports
          },
          filesV2: {
            totalCount: totalFilesV2Counts,
            needSyncCount,
            lastIndexBlock: lastIndexBlockOfFilesV2,
            lastSyncBlock,
            lastSpowerUpdateBlock,
            totalNeedSpowerUpdateCount,
            currentRSNeedSpowerUpdateCount,
            oneDayNeedSpowerUpdateCount,
            oneWeekNeedSpowerUpdateCount,
            oneMonthNeedSpowerUpdateCount
          }
        }
      };
      
    logger.info(`stats: ${JSON.stringify(result)}`);
    res.json(result);

  } catch(err) {
    logger.error(`Error in stats: ${err}`);
    res.status(400).json({
        code: 'Error',
        msg: `${err}`,
        data: ''
      });
  }

  logger.info('End to collect stats');
}

export async function processFilesToIndexQueue(_req: Request, res: Response, context: AppContext): Promise<void> {
  
  // Just trigger the process and then return directly
  const result = triggerManualFilesIndexer(context);

  if (result.code === 'OK') {
    res.json(result);
  } else {
    res.status(400).json(result);
  }
}