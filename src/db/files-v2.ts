import { Model, Op, Sequelize, Transaction } from 'sequelize';
import { FilesV2Operator, FilesV2Record} from '../types/database';
import _ from 'lodash';

export function createFilesV2Operator(db: Sequelize): FilesV2Operator {

  const upsertNeedSync = async (
    cids: string[]
  ): Promise<[number, number]> => {

    const existCidsCount = await FilesV2Record.count({
      where : { cid: cids }
    })

    // Bulk upsert
    const toUpsertRecords = [];
    for (const cid of cids) {
      toUpsertRecords.push({
        cid,
        need_sync: true
      });
    }

    await db.transaction(async (transaction) => {
      await FilesV2Record.bulkCreate(toUpsertRecords, {
        updateOnDuplicate: ['need_sync'],
        transaction
      });
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
      where: { 
        need_sync: true,
        is_spower_updating: false
       },
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
    cids: string[],
    transaction?: Transaction
  ): Promise<number> => {

    return await FilesV2Record.destroy({
      where: { cid: cids },
      transaction
    });
  };

  const updateRecords = async (
    records: FilesV2Record[],
    updateFields: string[],
    transaction?: Transaction
  ): Promise<number> => {

    // If record is Model type, need to transform it to object
    const toUpdateRecords = [];
    for (const record of records) {
      if (record instanceof Model) {
        toUpdateRecords.push(record.toJSON());
      } else {
        toUpdateRecords.push(record);
      }
    }
    let result = [];
    if (_.isNil(transaction)) {
      // Start a new transaction if no transaction specified
      await db.transaction(async (tx) => {
        result = await FilesV2Record.bulkCreate(toUpdateRecords, {
          updateOnDuplicate: updateFields as any,
          transaction: tx
        });
      });
    } else {
      result = await FilesV2Record.bulkCreate(toUpdateRecords, {
        updateOnDuplicate: updateFields as any,
        transaction
      });
    }

    return result.length;
  };
  
  const upsertRecords = async (
    records: FilesV2Record[],
    upsertFields: string[]
  ): Promise<number> => {

    let result = [];
    await db.transaction(async (transaction) => {
      result = await FilesV2Record.bulkCreate(records, {
        updateOnDuplicate: upsertFields as any,
        transaction
      });
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
