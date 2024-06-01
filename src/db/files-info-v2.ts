import { Database } from 'sqlite';
import { FileInfoV2Operator, FileInfoV2Record} from '../types/database';
import { FileInfoV2 } from '../types/chain';

export function createFileInfoV2Operator(db: Database): FileInfoV2Operator {

  const add = async (
    fileInfoV2Map: Map<string, FileInfoV2>,
    updateBlock: number
  ): Promise<number> => {

    let insertRecordsCount = 0;

    for (const [cid, fileInfo] of fileInfoV2Map) {
      const result = await db.run('insert or ingore into files_info_v2 ' + 
            '(`cid`,`update_block`,`file_info`,`last_updated`, `create_at`)' + 
            'values (?,?,?,?,?)',
            [cid, updateBlock, JSON.stringify(fileInfo), new Date(), new Date()]
      );

      insertRecordsCount += result.changes;
    }

    return insertRecordsCount;
  };

  const getFileInfoV2AtBlock = async (
    cids: string[],
    updateBlock: number,
    ): Promise<FileInfoV2Record[]> => {

        const cids_str = cids.map((cid)=>`'${cid}'`).join(',');
        return await db.all(
            `select * from files_info_v2 
             where cid in (${cids_str}) and update_block = ${updateBlock}`
    );
  }


  const getNonExistCids = async (
    cids: string[], updateBlock: number
  ): Promise<string[]> => {

    const cids_str = cids.map((cid)=>`'${cid}'`).join(',');
    const existCids: string[] = await db.all(
        `select cid
         from files_info_v2 
         where cid in (${cids_str}) and update_block = ${updateBlock}`);

    const existCidsSet = new Set(existCids);

    return cids.filter(cid => !existCidsSet.has(cid) );
  };

  return {
    add,
    getFileInfoV2AtBlock,
    getNonExistCids,
  };
}
