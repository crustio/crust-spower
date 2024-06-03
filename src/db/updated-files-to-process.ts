import { Database } from 'sqlite';
import { UpdatedFilesToProcessOperator, UpdatedFileToProcessRecord, UpdatedFileToProcessStatus } from '../types/database';
import { UpdatedFileToProcess } from '../types/chain';
import _ from 'lodash';

export function createUpdatedFilesToProcessOperator(db: Database): UpdatedFilesToProcessOperator {

  const addUpdatedFiles = async (
    updateBlock: number, 
    isFileInfoV2Retrieved: boolean, 
    updatedFilesMap: Map<string, UpdatedFileToProcess>
  ): Promise<number> => {

    const obj = {};
    updatedFilesMap.forEach((value, key) => {
      obj[key] = value;
    });
    const result = await db.run(
          'insert or ignore into updated_files_to_process ' +
          '(`update_block`, `is_file_info_v2_retrieved`,`updated_files`, `status`, `last_updated`, `create_at`)' +
          ' values (?, ?, ?, ?, ?, ?)',
        [
          updateBlock,
          isFileInfoV2Retrieved,
          JSON.stringify(obj),
          'new',
          new Date(),
          new Date(),
        ],
      );
      
    return result.changes;
  };

  const getMinimumUnProcessedBlockWithFileInfoV2Data = async (): Promise<number> => {
    const result = await db.all(
        `select update_block from updated_files_to_process 
         where status in ('new', 'failed') and is_file_info_v2_retrieved = 1
         order by update_block asc limit 1`
    );

    if (_.isNil(result) || result.length == 0) {
      return 0;
    } else {
      return Number(result[0].update_block);
    }
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
        `update updated_files_to_process set status = ?, last_updated = ? where id in (${ids_str})`,
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
