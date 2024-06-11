import { Database } from 'sqlite';
import { FilesV2Operator, FilesV2Record} from '../types/database';
import { FileInfoV2 } from '../types/chain';
import { AppContext } from '../types/context';
import _ from 'lodash';

export function createFilesV2Operator(db: Database): FilesV2Operator {

  const upsertFilesV2 = async (
    fileInfoV2Map: Map<string, FileInfoV2>,
    syncBlock: number,
    context: AppContext
  ): Promise<[number, number]> => {

    const { api, config } = context;
    const currBlock = await api.latestFinalizedBlock();
    const spowerReadyPeriod = config.chain.spowerReadyPeriod;

    let insertRecordsCount = 0;
    let updateRecordsCount = 0;

    const cids = [...fileInfoV2Map.keys()];
    const cids_str = cids.map((cid)=>`'${cid}'`).join(',');

    const existCids: string[] = await db.all(`select cid from files_v2 where cid in (${cids_str})`);

    const existCidsSet = new Set(existCids);
    const nonExistCids = cids.filter(cid => !existCidsSet.has(cid) );

    // Insert
    // TODO: Do it in batch insert
    for (const cid of nonExistCids) {
      const fileInfo = fileInfoV2Map.get(cid);

      // Calculate the next_spower_update_block
      // If the file has expired, no need to update spower
      let nextSpowerUpdateBlock = null;
      if (fileInfo.expired_at > currBlock) {
        // The next_spower_update_block is the minimum Not-None create_at block + SpowerDelayPeriod
        if (!_.isEmpty(fileInfo.replicas)) {
          let minimumCreateAtBlock = Number.MAX_VALUE;
          for (const [_owner,replica] of fileInfo.replicas) {
            if (!_.isNil(replica.created_at)) {
              if (replica.created_at < minimumCreateAtBlock) {
                minimumCreateAtBlock = replica.created_at;
              }
            }
          }

          if (minimumCreateAtBlock !== Number.MAX_VALUE) {
            nextSpowerUpdateBlock = minimumCreateAtBlock + spowerReadyPeriod;
          }
        }
      }

      const result = await db.run('insert into files_v2 ' + 
            '(`cid`,`file_info`,`last_sync_block`,`last_sync_time`,`need_sync`,`is_closed`,`next_spower_update_block`,`last_updated`,`create_at`) ' + 
            'values (?,?,?,?,?,?,?,?)',
            [cid, JSON.stringify(fileInfo), syncBlock, new Date(), false, false, nextSpowerUpdateBlock, new Date(), new Date()]
      );

      insertRecordsCount += result.changes;
    }

    // Update 
    // TODO: Do it in batch!
    for (const cid of existCids) {
      const fileInfo = fileInfoV2Map.get(cid);

      // Calcuate the next_spower_update_block
      // For update scenario, we also consider the None create_at replicas and the expired files
      // PS: The replicas may not really changed, but this can be covered by the spower-calculate-task
      let nextSpowerUpdateBlock = null;
      if (!_.isEmpty(fileInfo.replicas)) {
        let minimumCreateAtBlock = Number.MAX_VALUE;
        for (const [_owner,replica] of fileInfo.replicas) {
          if (!_.isNil(replica.created_at)) {
            if (replica.created_at < minimumCreateAtBlock) {
              minimumCreateAtBlock = replica.created_at;
            } 
          } else {
            minimumCreateAtBlock = 0;
          }
        }

        if (minimumCreateAtBlock == 0) {
          nextSpowerUpdateBlock = currBlock;
        } else {
          nextSpowerUpdateBlock = minimumCreateAtBlock + spowerReadyPeriod;
        }
      }

      // TODO: Do it in batch update
      const result = await db.run('update files_v2 ' + 
              'set `file_info`=?,`last_sync_block`=?,`last_sync_time`=?,`need_sync`=?,`next_spower_update_block`=?,`last_updated`=? ' +
              'where `cid`=?',
            [JSON.stringify(fileInfo), syncBlock, new Date(), false, nextSpowerUpdateBlock, new Date(), cid]
      );

      updateRecordsCount += result.changes;
    }

    return [insertRecordsCount, updateRecordsCount];
  };

  const upsertNeedSync = async (
    cids: string[]
  ): Promise<[number, number]> => {

    let insertRecordsCount = 0;
    let updateRecordsCount = 0;

    const cidsStr = cids.map((cid)=>`'${cid}'`).join(',');
    const existCids: string[] = await db.all(`select cid from files_v2 where cid in (${cidsStr})`);

    const existCidsSet = new Set(existCids);
    const nonExistCids = cids.filter(cid => !existCidsSet.has(cid) );

    // Insert
    // TODO: Do in batch
    for (const cid of nonExistCids) {
      const result = await db.run('insert into files_v2 ' + 
            '(`cid`,`need_sync`,`last_updated`,`create_at`) ' + 
            'values (?,?,?,?)',
            [cid, true, new Date(), new Date()]
      );

      insertRecordsCount += result.changes;
    }

    // Update
    const existCidsStr = existCids.map((cid)=>`'${cid}'`).join(',');
    const updateResult = await db.run(
            `update files_v2  
              set need_sync=?, last_updated=?
              where cid in (${existCidsStr})`,
              [true, new Date()]);
    updateRecordsCount = updateResult.changes;

    return [insertRecordsCount, updateRecordsCount];
  };

  const setIsClosed = async (
    cids: string[],
    currBlock: number
  ): Promise<number> => {
    const cids_str = cids.map((cid)=>`'${cid}'`).join(',');
    const result = await db.run(
            `update files_v2  
              set is_closed=?, next_spower_update_block=?, last_updated=?
              where cid in (${cids_str})`,
              [true, currBlock,new Date()]);

    return result.changes;  
  };

  const getNeedSync = async (
    count: number
  ): Promise<string[]> => {

    return await db.all(`select cid from files_v2 where need_sync=1 limit ${count}`);
  };

  const getNeedSpowerUpdateRecords = async (
    count: number, currBlock: number
  ): Promise<FilesV2Record[]> => {

    // Return records with effective next_spower_update_block, and has synced the data
    return await db.all(
          `select * from files_v2 
           where next_spower_update_block < ${currBlock} and need_sync = 0
           order by next_spower_update_block asc limit ${count}`);
  };

  const deleteRecords = async (
    cids: string[]
  ): Promise<number> => {

    const cids_str = cids.map((cid)=>`'${cid}'`).join(',');
    const result = await db.run(`delete from files_v2 where cid in (${cids_str})`);

    return result.changes;
  };

  const updateRecords = async (
    records: FilesV2Record[]
  ): Promise<number> => {

    // TODO: Do it in batch insert
    let updateRecordsCount = 0;
    for (const record of records) {
      const result = await db.run(
            `update files_v2 set
             file_info = ?, 
             last_sync_block = ?,
             last_sync_time = ?,
             need_sync = ?,
             is_closed = ?,
             last_spower_update_block = ?,
             last_spower_update_time = ?,
             next_spower_update_block = ?,
             is_spower_updating = ?
             last_updated = ?,
             where cid = ?`,
            [record.file_info, record.last_sync_block, record.last_sync_time, record.need_sync, record.is_closed, record.last_spower_update_block,
             record.last_spower_update_time, record.next_spower_update_block, record.is_spower_updating, new Date(), record.cid]
      );

      updateRecordsCount += result.changes;
    }
    
    return updateRecordsCount;
  };
  
  const insertRecords = async (
    records: FilesV2Record[]
  ): Promise<number> => {

    // TODO: Do it in batch insert
    let insertRecordsCount = 0;
    for (const record of records) {
      const result = await db.run(
            `insert into files_v2 
             (cid,file_info,last_sync_block,last_sync_time,need_sync,is_closed,last_spower_update_block,
             last_spower_update_time,next_spower_update_block,is_spower_updating,last_updated,create_at)  
             values (?,?,?,?,?,?,?,?,?,?,?)
             on conflict(cid) do update`,
            [record.cid, record.file_info, record.last_sync_block, record.last_sync_time, record.need_sync, record.is_closed, record.last_spower_update_block,
             record.last_spower_update_time, record.next_spower_update_block, record.is_spower_updating, new Date(), new Date()]
      );

      insertRecordsCount += result.changes;
    }

    return insertRecordsCount;
  };

  const getExistingCids = async (
    cids: string[]
  ): Promise<string[]> => {
    const cids_str = cids.map((cid)=>`'${cid}'`).join(',');
    const existCids: string[] = await db.all(`select cid from files_v2 where cid in (${cids_str})`);

    return existCids;
  };

  const setIsSpowerUpdating = async (
    cids: string[]
    ): Promise<number> => {
    const cids_str = cids.map((cid)=>`'${cid}'`).join(',');
    const result = await db.run(`update files_v2 set is_spower_updating = 1 where cid in (${cids_str})`);

    return result.changes;  
  };

  const clearIsSpowerUpdating = async (
    ): Promise<number> => {
    const result = await db.run(`update files_v2 set is_spower_updating = 0 where is_spower_updating = 1`);

    return result.changes;  
  };

  return {
    upsertFilesV2,
    upsertNeedSync,
    setIsClosed,
    getNeedSync,
    getNeedSpowerUpdateRecords,
    deleteRecords,
    updateRecords,
    insertRecords,
    getExistingCids,
    setIsSpowerUpdating,
    clearIsSpowerUpdating
  };
}
