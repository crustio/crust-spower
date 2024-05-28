import { Database } from 'sqlite';
import {  FileInfoV2ToIndexOperator, FileInfoV2ToIndexRecord, FileInfoV2ToIndexStatus } from '../types/database';
import { getTimestamp } from '../utils';

export function createFileInfoV2ToIndexOperator(db: Database): FileInfoV2ToIndexOperator {

  const addToIndexFiles = async (
      toIndexFiles: Map<string, Set<number>>
  ): Promise<number> => {

    let insertRecordsCount = 0;
    for (const [cid, updateBlockSet] of toIndexFiles) {
      for (const updateBlock of updateBlockSet) {
        const result = await db.run(
            'insert or ignore into file_info_v2_to_index ' +
            '(`cid`, `update_block`, `status`, `last_updated`, `create_at`)' +
            ' values (?, ?, ?, ?, ?)',
          [
            cid,
            updateBlock,
            'new',
            getTimestamp(),
            getTimestamp(),
          ],
        );

        insertRecordsCount += result.changes;
      }
    }
      
    return insertRecordsCount;
  };

  /// Return distinct cids where update_block <= designed value
  const getPendingToIndexFileCids = async (
    count: number,
    update_block: number,
  ): Promise<string[]> => {
    return await db.all(
        `select distinct cid from file_info_v2_to_index 
         where status in ('new', 'failed') and update_block <= ${update_block} 
         order by update_block asc 
         limit ${count}`
    );
  };

  /// Update all records with designated cids and <= update_block
  const updateRecordsStatus = async (
    cids: string[],
    update_block: number,
    status: FileInfoV2ToIndexStatus,
  ) => {
    if (cids && cids.length > 0) {
      const cids_str = cids.map((cid)=>`'${cid}'`).join(',');
      await db.run(
        `update file_info_v2_to_index 
         set status = ${status}, last_updated = ${getTimestamp()} 
         where cid in (${cids_str})
         and status not in ('processed')
         and update_block <= ${update_block}`
      );
    }
    
  };

  
  return {
    addToIndexFiles,
    getPendingToIndexFileCids,
    updateRecordsStatus
  };
}
