import { Database } from 'sqlite';
import { WorkReportsToProcessOperator, WorkReportsToProcessRecord, WorkReportsProcessStatus } from '../types/database';
import { WorkReportsToProcess } from '../types/chain';

export function createWorkReportsToProcessOperator(db: Database): WorkReportsToProcessOperator {

  const addWorkReports = async (
    reportBlock: number, 
    workReports: WorkReportsToProcess[]
  ): Promise<number> => {

    // Sort by the extrinsic index
    workReports.sort((a, b) => {
      return a.extrinsic_index - b.extrinsic_index;
    });

    const result = await db.run(
          'insert or ignore into work_reports_to_process ' +
          '(`report_block`,  `work_reports`, `status`, `last_updated`, `create_at`)' +
          ' values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            reportBlock,
            JSON.stringify(workReports),
            'new',
            new Date(),
            new Date(),
          ]
        );

    return result.changes;
  };

  const getPendingWorkReports = async (
    count: number,
  ): Promise<WorkReportsToProcessRecord[]> => {
    return await db.all(
      `select * from work_reports_to_process 
      where status in ('new', 'failed') order by report_block asc limit ${count}`
    );
  };

  const updateStatus = async (
    ids: number[],
    status: WorkReportsProcessStatus,
  ) => {
    if (ids && ids.length > 0) {
      const ids_str = ids.join(',');
      await db.run(
        `update work_reports_to_process set status = ?, last_updated = ? where id in (${ids_str})`,
        [status, new Date()],
      );
    }
    
  };

  
  return {
    addWorkReports,
    getPendingWorkReports,
    updateStatus
  };
}
