import { Database } from 'sqlite';
import { DbWriteResult, FileInfoV2Operator, FileInfoV2Record} from '../types/database';
import { getTimestamp } from '../utils';
import { logger } from '../utils/logger';
import { createFileInfoV2ToIndexOperator } from './file-info-v2-to-index';
import { FileInfoV2 } from '../chain';

export function createFileInfoV2Operator(db: Database): FileInfoV2Operator {

  const addFilesInfoV2AndUpdateIndexStatus = async (
    filesInfoV2Map: Map<string, FileInfoV2>, 
    cids: string[], 
    update_block: number
  ): DbWriteResult => {

    // Add file_info_v2 table and update file_info_v2_to_index status need to be in a single transaction
    try {
        await db.exec('BEGIN TRANSACTION');

        // Add file_info_v2
        for (const [cid, fileInfoV2] of filesInfoV2Map) {
            await db.run('insert or ignore into file_info_v2 ' + 
                '(`cid`,`update_block`,`file_info`,`last_updated`, `create_at`)' + 
                'values (?,?,?,?,?)',
                [cid, update_block, JSON.stringify(fileInfoV2), getTimestamp(), getTimestamp()]
            );
        }

        // Update file_info_v2_to_index status
        const toIndexFilesOp = createFileInfoV2ToIndexOperator(db);
        toIndexFilesOp.updateRecordsStatus(cids, update_block, 'processed');

        await db.exec('COMMIT');
    } catch(err){
        logger.error(`💥 Error in addFilesInfoV2AndUpdateIndexStatus: ${err}`)
        await db.exec('ROLLBACK');
    }
  };
  
  const getByCids = async (
    cids: string[],
    start_block: number,
    end_block: number
    ): Promise<FileInfoV2Record[]> => {

        const cids_str = cids.map((cid)=>`'${cid}'`).join(',');
        // Get the file_info_v2 data in the designated cids list between the specific block range, 
        return await db.all(
        `select id, cid, max(update_block), file_info, last_updated, create_at from file_info_v2_to_index 
         where cid in (${cids_str}) and update_block between ${start_block} and ${end_block}
         group by cid`
    );
    }

  return {
    addFilesInfoV2AndUpdateIndexStatus,
    getByCids,
  };
}
