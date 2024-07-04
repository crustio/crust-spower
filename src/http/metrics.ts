import { AppContext } from '../types/context';
import { Request, Response } from 'express';
import { createChildLogger } from '../utils/logger';
import { FilesV2Record, WorkReportsToProcessRecord } from '../types/database';
import { createConfigOps } from '../db/configs';
import { KeyWorkReportsLastProcessBlock } from '../tasks/work-reports-processor-task';
import { KeyIndexChangedLastSyncBlock } from '../tasks/files-v2-indexer-task';
import { KeyLastSpowerUpdateBlock } from '../tasks/spower-calculator-task';
import { KeyLastIndexBlockWrs } from '../tasks/work-reports-indexer-task';

const logger = createChildLogger({ moduleId: 'api-metrics' });

export async function stats(_req: Request, res: Response, context: AppContext): Promise<void> {

  const { database } = context;
  const configOp = createConfigOps(database);

  try {
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
    const lastSyncBlockOfFilesV2 = await configOp.readInt(KeyIndexChangedLastSyncBlock);
    const lastSpowerUpdateBlockOfFilesV2 = await configOp.readInt(KeyLastSpowerUpdateBlock);
    const needSyncCountOfFilesV2 = await FilesV2Record.count({
      where: {
        need_sync: true
      }
    })

    const result = {
        code: 'OK',
        msg: '',
        data: {
          workReportsToProcess: {
            totalCount: totalWorkReportsCounts,
            newCount: newWorkReportsCounts,
            failedCount: failedWorkReportsCounts,
            lastIndexBlock: lastIndexBlockOfWorkReports,
            lastProcessedBlock: lastProcessedBlockOfWorkReports
          },
          filesV2: {
            totalCount: totalFilesV2Counts,
            needSyncCount: needSyncCountOfFilesV2,
            lastSyncBlock: lastSyncBlockOfFilesV2,
            lastSpowerUpdateBlock: lastSpowerUpdateBlockOfFilesV2
          }
        }
      };
      
    logger.info(`stats: ${JSON.stringify(result)}`);
    res.json(result);

  } catch(err) {
    logger.error(`Error in /metrics/stats: ${err}`);
    res.json({
        code: 'Error',
        msg: `${err}`,
        data: ''
      });
  }
}