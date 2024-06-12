import dayjs, { Dayjs } from 'dayjs';
import _ from 'lodash';
import { Sequelize } from 'sequelize';
import { ConfigOperator, ConfigRecord, DbResult, DbWriteResult } from '../types/database';
import { logger } from '../utils/logger';

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

  const saveString = async (name: string, v: string): DbWriteResult => {
    await ConfigRecord.upsert({
      name,
      content: v
    });
  };

  const readInt = async (name: string): DbResult<number> => {
    const n = await readString(name);
    if (n !== null) {
      return _.parseInt(n);
    }
    return null;
  };
  const saveInt = async (name: string, v: number): DbWriteResult => {
    await saveString(name, `${v}`);
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
  const saveTime = async (name: string, d: Dayjs): DbWriteResult => {
    if (!d.isValid()) {
      throw new Error('invalid date!');
    }
    const v = d.unix();
    await saveInt(name, v);
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
  const saveJson = async (name: string, v: unknown): DbWriteResult => {
    await saveString(name, JSON.stringify(v));
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
