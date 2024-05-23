import { Database } from 'sqlite';
import { DbWriteResult, FileReplicasToUpdateOperator, FileReplicasToUpdateRecord, FileReplicasToUpdateStatus} from '../types/database';
import { getTimestamp } from '../utils';
import { FileInfo } from '../types/chain';
import { createWorkReportsToProcessOperator } from './work-reports-to-process'
import { logger } from '../utils/logger';

export function createFileReplicasToUpdateOperator(db: Database): FileReplicasToUpdateOperator {

  const addFileReplicasAndUpdateWorkReports = async (
    filesInfoMap: Map<string, FileInfo>, 
    workReportIds: number[]
  ): DbWriteResult => {

    // Add file replicas info and update work report process status need to be in a single transaction
    try {
        await db.exec('BEGIN TRANSACTION');

        // Add file replicas info
        for (const [key, value] of filesInfoMap) {
            await db.run('insert or ignore into file_replicas_to_update ' + 
                '(`cid`,`file_size`,`replicas`,`status`, `last_updated`, `create_at`)' + 
                'values (?,?,?,?,?,?)',
                [key, value.file_size, JSON.stringify(value.replicas), 'new', getTimestamp(), getTimestamp()]
            );
        }

        // Update work report process status
        const workReportsOp = createWorkReportsToProcessOperator(db);
        workReportsOp.updateWorkReportRecordsStatus(workReportIds, 'processed');

        await db.exec('COMMIT');
    } catch(err){
        logger.error(`💥 Error in addFileReplicasAndUpdateWorkReports: ${err}`)
        await db.exec('ROLLBACK');
    }
  };

  const getPendingFileInfos = async (
    count: number,
  ): Promise<FileReplicasToUpdateRecord[]> => {
    return await db.all(
      `select id, cid, file_size, replicas, status 
       from file_replicas_to_update where status in ('new', 'failed') order by create_at asc limit ${count}`
    );
  };

  const updateFileReplicasRecordsStatus = async (
    ids: number[],
    status: FileReplicasToUpdateStatus,
  ) => {
    if (ids && ids.length > 0) {
      const ids_str = ids.join(',');
      await db.run(
        `update file_replicas_to_update set status = ?, last_updated = ? where id in (${ids_str})`,
        [status, getTimestamp()],
      );
    }
    
  };

  return {
    addFileReplicasAndUpdateWorkReports,
    getPendingFileInfos,
    updateFileReplicasRecordsStatus
  };
}
