import { Database } from 'sqlite';
import { UpdatedFilesToProcessOperator, UpdatedFileToProcessRecord, UpdatedFileToProcessStatus } from '../types/database';
import { UpdatedFileToProcess } from '../types/chain';

export function createUpdatedFilesToProcessOperator(db: Database): UpdatedFilesToProcessOperator {

  const addUpdatedFiles = async (
    updateBlock: number, 
    isFileInfoV2Retrieved: boolean, 
    updatedFiles: UpdatedFileToProcess[]
  ): Promise<number> => {

    const result = await db.run(
          'insert or ignore into updated_files_to_process ' +
          '(`update_block`, `is_file_info_v2_retrieved`,`updated_files`, `status`, `last_updated`, `create_at`)' +
          ' values (?, ?, ?, ?, ?)',
        [
          updateBlock,
          isFileInfoV2Retrieved,
          JSON.stringify(updatedFiles),
          'new',
          new Date(),
          new Date(),
        ],
      );
      
    return result.changes;
  };

  const getMinimumUnProcessedBlockWithFileInfoV2Data = async (): Promise<number> => {
    return await db.all(
        `select update_block from updated_files_to_process 
         where status in ('new', 'failed') and is_file_info_v2_retrieved = true
         order by update_block asc limit 1`
    );
  };

  const getPendingUpdatedFilesTillBlock = async (
    updateBlock: number,
  ): Promise<UpdatedFileToProcessRecord[]> => {
    return await db.all(
        `select * from updated_files_to_process 
         where status in ('new', 'failed') and update_block <= '${updateBlock}'
         order by update_block asc`
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
        [status, new Date()],
      );
    }
  };

  
  return {
    addUpdatedFiles,
    getMinimumUnProcessedBlockWithFileInfoV2Data,
    getPendingUpdatedFilesTillBlock,
    updateRecordsStatus
  };
}
