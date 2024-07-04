import { Op, Sequelize } from 'sequelize';
import { WorkReportsToProcessOperator, WorkReportsToProcessRecord, WorkReportsProcessStatus } from '../types/database';
import { WorkReportsToProcess } from '../types/chain';
import { stringifyEx } from '../utils';

export function createWorkReportsToProcessOperator(db: Sequelize): WorkReportsToProcessOperator {

  const addWorkReports = async (
    reportBlock: number, 
    workReports: WorkReportsToProcess[]
  ): Promise<number> => {

    // Sort by the extrinsic index
    workReports.sort((a, b) => {
      return a.extrinsic_index - b.extrinsic_index;
    });

    const [ _record, created ] = await WorkReportsToProcessRecord.upsert({
      report_block: reportBlock,
      work_reports: stringifyEx(workReports),
      status: 'new',
    });

    return created ? 1 : 0;
  };

  const getPendingWorkReports = async (
    count: number,
    beforeBlock: number
  ): Promise<WorkReportsToProcessRecord[]> => {

    return await WorkReportsToProcessRecord.findAll({
      where: {
        status: ['new', 'failed'],
        report_block: { [Op.lte]: beforeBlock },
      },
      order: [['report_block', 'ASC']],
      limit: count
    });
  };

  const updateStatus = async (
    ids: number[],
    status: WorkReportsProcessStatus,
  ) => {
    if (ids && ids.length > 0) {
      WorkReportsToProcessRecord.update({
        status,
      }, {
        where: {
          id: ids,
        },
      });
    }
  };

  const purgeRecords = async (persistTimeInHours: number): Promise<number> => {

    const thresholdDate = new Date(Date.now() - persistTimeInHours * 3600 * 1000);

    let deletedRowsCount = 0;
    db.transaction(async (transaction) => {
      deletedRowsCount = await WorkReportsToProcessRecord.destroy({
            where: { 
                create_at: {
                    [Op.lt]: thresholdDate
                },
                status: 'processed' 
            },
            transaction
            });
    });
    
    return deletedRowsCount;
  }

  
  return {
    addWorkReports,
    getPendingWorkReports,
    updateStatus,
    purgeRecords
  };
}
