import { Op, Sequelize } from 'sequelize';
import { WorkReportsToProcessOperator, OrdersRecord, WorkReportsProcessStatus } from '../types/database';
import { WorkReportsToProcess } from '../types/chain';

export function createWorkReportsToProcessOperator(_db: Sequelize): WorkReportsToProcessOperator {

  const addWorkReports = async (
    reportBlock: number, 
    workReports: WorkReportsToProcess[]
  ): Promise<number> => {

    // Sort by the extrinsic index
    workReports.sort((a, b) => {
      return a.extrinsic_index - b.extrinsic_index;
    });

    const [ _record, created ] = await OrdersRecord.upsert({
      report_block: reportBlock,
      work_reports: JSON.stringify(workReports),
      status: 'new',
    });

    return created ? 1 : 0;
  };

  const getPendingWorkReports = async (
    count: number,
    beforeBlock: number
  ): Promise<OrdersRecord[]> => {

    return await OrdersRecord.findAll({
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
      OrdersRecord.update({
        status,
      }, {
        where: {
          id: ids,
        },
      });
    }
  };

  
  return {
    addWorkReports,
    getPendingWorkReports,
    updateStatus
  };
}
