import { Database } from 'sqlite';
import { FileInfoV2Operator, FileInfoV2Record} from '../types/database';
import { getTimestamp } from '../utils';
import { FileInfoV2 } from '../types/chain';

export function createFileInfoV2Operator(db: Database): FileInfoV2Operator {

  const add = async (
    fileInfoV2Map: Map<string, FileInfoV2>,
    update_block: number
  ): Promise<number> => {

    let insertRecordsCount = 0;

    for (const [cid, fileInfo] of fileInfoV2Map) {
      const result = await db.run('insert or ignore into file_info_v2 ' + 
            '(`cid`,`update_block`,`file_info`,`last_updated`, `create_at`)' + 
            'values (?,?,?,?,?)',
            [cid, update_block, JSON.stringify(fileInfo), getTimestamp(), getTimestamp()]
      );

      insertRecordsCount += result.changes;
    }

    return insertRecordsCount;
  };

  const getFileInfoV2AtBlock = async (
    cids: string[],
    update_block: number,
    ): Promise<FileInfoV2Record[]> => {

        const cids_str = cids.map((cid)=>`'${cid}'`).join(',');
        return await db.all(
            `select * from file_info_v2_to_index 
             where cid in (${cids_str}) and update_block = ${update_block}`
    );
  }


  const getNonExistCids = async (
    cids: string[], update_block: number
  ): Promise<string[]> {

    const cids_str = cids.map((cid)=>`'${cid}'`).join(',');
    const existCids: string[] = await db.all(
        `select cid
         from file_info_v2_to_index 
         where cid in (${cids_str}) and update_block = ${update_block}`);

    const existCidsSet = new Set(existCids);

    return cids.filter(cid => !existCidsSet.has(cid) );
  };

  return {
    add,
    getFileInfoV2AtBlock,
    getNonExistCids,
  };
}
