import { Database } from 'sqlite';
import { WorkReportsToProcessOperator, WorkReportsToProcessRecord, WorkReportsProcessStatus } from '../types/database';
import { getTimestamp } from '../utils';
import { WorkReportsToProcess } from '../types/chain';

export function createWorkReportsToProcessOperator(db: Database): WorkReportsToProcessOperator {

  const addWorkReports = async (
      workReports: WorkReportsToProcess[]
  ): Promise<number> => {

    let insertRecordsCount = 0;
    for (const wr of workReports) {
        // sworker_anchor + report_slot should be unique, compose unique index is defined, so use 'insert or ignore into' here
        const result = await db.run(
          'insert or ignore into work_reports_to_process ' +
            '(`sworker_anchor`, `report_slot`, `report_block`, `extrinsic_index`, `reporter`, `owner`, ' +
            '`reported_srd_size`, `reported_files_size`, `added_files`, `deleted_files`, ' +
            '`status`, `last_updated`, `create_at`)' +
            ' values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            wr.sworker_anchor,
            wr.report_slot,
            wr.report_block,
            wr.extrinsic_index,
            wr.reporter,
            wr.owner,
            wr.reported_srd_size,
            wr.reported_files_size,
            wr.added_files,
            wr.deleted_files,
            'new',
            getTimestamp(),
            getTimestamp(),
          ]
        );

        insertRecordsCount += result.changes;
    }

    return insertRecordsCount;
  };

  const getPendingWorkReports = async (
    count: number,
  ): Promise<WorkReportsToProcessRecord[]> => {
    return await db.all(
      `select * from work_reports_to_process 
      where status in ('new', 'failed') order by report_block asc limit ${count}`
    );
  };

  const updateWorkReportRecordsStatus = async (
    ids: number[],
    status: WorkReportsProcessStatus,
  ) => {
    if (ids && ids.length > 0) {
      const ids_str = ids.join(',');
      await db.run(
        `update work_reports_to_process set status = ?, last_updated = ? where id in (${ids_str})`,
        [status, getTimestamp()],
      );
    }
    
  };

  
  return {
    addWorkReports,
    getPendingWorkReports,
    updateWorkReportRecordsStatus
  };
}
