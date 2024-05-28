import { Database } from 'sqlite';
import { UpdatedFilesToProcessOperator, UpdatedFileToProcessRecord, UpdatedFileToProcessStatus } from '../types/database';
import { getTimestamp } from '../utils';
import { UpdatedFileToProcess } from '../types/chain';

export function createUpdatedFilesToProcessOperator(db: Database): UpdatedFilesToProcessOperator {

  const addUpdatedFiles = async (
      updatedFilesMap: Map<number, UpdatedFileToProcess[]>
  ): Promise<number> => {

    let insertRecordsCount = 0;
    for (const [updateBlock,updated_files] of updatedFilesMap) {
        const result = await db.run(
            'insert or ignore into updated_files_to_process ' +
            '(`update_block`, `updated_files`, `status`, `last_updated`, `create_at`)' +
            ' values (?, ?, ?, ?, ?)',
          [
            updateBlock,
            JSON.stringify(updated_files),
            'new',
            getTimestamp(),
            getTimestamp(),
          ],
        );

        insertRecordsCount += result.changes;
      }
      
    return insertRecordsCount;
  };

  const getPendingUpdatedFilesByBlock = async (
    count: number,
    update_block: number
  ): Promise<UpdatedFileToProcessRecord[]> => {
    return await db.all(
        `select * from updated_files_to_process 
         where status in ('new', 'failed') and update_block <= ${update_block}
         order by update_block asc limit ${count}`
    );
  };

  const updateRecordsStatus = async (
    ids: number[],
    status: UpdatedFileToProcessStatus,
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
    addUpdatedFiles,
    getPendingUpdatedFilesByBlock,
    updateRecordsStatus
  };
}
