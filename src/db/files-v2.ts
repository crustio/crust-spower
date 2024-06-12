import { Op, Sequelize } from 'sequelize';
import { FilesV2Operator, FilesV2Record} from '../types/database';
import _ from 'lodash';

export function createFilesV2Operator(_db: Sequelize): FilesV2Operator {

  const upsertNeedSync = async (
    cids: string[]
  ): Promise<[number, number]> => {

    const existCidsCount = await FilesV2Record.count({
      where : { cid: cids }
    })

    // Bulk upsert
    let toUpsertRecords = [];
    for (const cid of cids) {
      toUpsertRecords.push({
        cid,
        need_sync: true
      });
    }

    await FilesV2Record.bulkCreate(toUpsertRecords, {
      updateOnDuplicate: ['cid']
    });

    return [cids.length - existCidsCount, existCidsCount];
  };

  const setIsClosed = async (
    cids: string[],
    currBlock: number
  ): Promise<number> => {

    const [affectedRows] = await FilesV2Record.update({
      is_closed: true,
      need_sync: false,
      next_spower_update_block: currBlock
    }, {
      where: { cid: cids },
    });

    return affectedRows;  
  };

  const getNeedSync = async (
    count: number
  ): Promise<string[]> => {

    const result = await FilesV2Record.findAll({
      attributes: ['cid'],
      where: { need_sync: true },
      limit: count
    });

    return result.map((r: any) => r.cid);
  };

  const getNeedSpowerUpdateRecords = async (
    count: number, currBlock: number
  ): Promise<FilesV2Record[]> => {

    // Return records with effective next_spower_update_block, and has synced the data
    return await FilesV2Record.findAll({
      where: { 
        next_spower_update_block: { [Op.lte]: currBlock },
        need_sync: false,
      },
      order: [['next_spower_update_block', 'ASC']],
      limit: count
    });
  };

  const deleteRecords = async (
    cids: string[]
  ): Promise<number> => {

    return await FilesV2Record.destroy({
      where: { cid: cids },
    });
  };

  const updateRecords = async (
    records: FilesV2Record[]
  ): Promise<number> => {

    const result = await FilesV2Record.bulkCreate(records, {
      updateOnDuplicate: ['cid']
    });
    
    return result.length;
  };
  
  const upsertRecords = async (
    records: FilesV2Record[]
  ): Promise<number> => {

    const result = await FilesV2Record.bulkCreate(records, {
      updateOnDuplicate: ['cid']
    });
    
    return result.length;
  };

  const getExistingCids = async (
    cids: string[]
  ): Promise<string[]> => {
    
    const result = await FilesV2Record.findAll({
      attributes: ['cid'],
      where: { cid: cids },
    });

    return result.map((r: any) => r.cid);
  };

  const setIsSpowerUpdating = async (
    cids: string[]
    ): Promise<number> => {

    const [affectedRows] = await FilesV2Record.update({
      is_spower_updating: true
    }, {
      where: { cid: cids },
    });
    return affectedRows;
  };

  const clearIsSpowerUpdating = async (
    ): Promise<number> => {
    
    const [affectedRows] = await FilesV2Record.update({
      is_spower_updating: false
    }, {
      where: { is_spower_updating: true },
    });
   
    return affectedRows;
  };

  return {
    upsertNeedSync,
    setIsClosed,
    getNeedSync,
    getNeedSpowerUpdateRecords,
    deleteRecords,
    updateRecords,
    upsertRecords,
    getExistingCids,
    setIsSpowerUpdating,
    clearIsSpowerUpdating
  };
}
