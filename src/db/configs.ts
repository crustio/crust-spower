import dayjs, { Dayjs } from 'dayjs';
import _ from 'lodash';
import { Sequelize, Transaction } from 'sequelize';
import { ConfigOperator, ConfigRecord, DbResult, DbWriteResult } from '../types/database';
import { logger } from '../utils/logger';
import { stringifyEx } from '../utils';

export function createConfigOps(_db: Sequelize): ConfigOperator {
  const readString = async (name: string): DbResult<string> => {

    const config = await ConfigRecord.findOne({
      where : { name },
      attributes: ['content']
    }) as any;

    if (_.isNil(config)) {
      return null;
    }
    return config.content;
  };

  const saveString = async (name: string, v: string, transaction?: Transaction): DbWriteResult => {
    await ConfigRecord.upsert({
      name,
      content: v
    }, {
      transaction
    });
  };

  const readInt = async (name: string): DbResult<number> => {
    const n = await readString(name);
    if (n !== null) {
      return _.parseInt(n);
    }
    return null;
  };
  const saveInt = async (name: string, v: number, transaction?: Transaction): DbWriteResult => {
    await saveString(name, `${v}`, transaction);
  };

  const readTime = async (name: string): DbResult<Dayjs> => {
    const v = await readInt(name);
    if (v != null) {
      const d = dayjs.unix(v);
      if (d.isValid()) {
        return d;
      }
      return null;
    }
    return null;
  };
  const saveTime = async (name: string, d: Dayjs, transaction?: Transaction): DbWriteResult => {
    if (!d.isValid()) {
      throw new Error('invalid date!');
    }
    const v = d.unix();
    await saveInt(name, v, transaction);
  };
  const readJson = async (name: string): DbResult<unknown> => {
    const v = await readString(name);
    if (v) {
      try {
        return JSON.parse(v);
      } catch (e) {
        logger.warn('read invalid json from config by name: %s', name);
      }
    }
    return null;
  };
  const saveJson = async (name: string, v: unknown, transaction?: Transaction): DbWriteResult => {
    await saveString(name, stringifyEx(v), transaction);
  };
  return {
    readString,
    saveString,
    readInt,
    saveInt,
    readTime,
    saveTime,
    readJson,
    saveJson,
  };
}
