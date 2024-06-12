import { Dayjs } from 'dayjs';
import { WorkReportsToProcess } from './chain';
import { AppContext } from './context';
import { sequelize } from '../db';
import { Model } from 'sequelize';

type DbResult<T> = Promise<T | null>;
type DbWriteResult = Promise<void>;

/// --------------------------------------------------
/// Config Table
class ConfigRecord extends Model {}

ConfigRecord.init({
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      primaryKey: true,
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
}, {
  tableName: 'config'
});

export interface ConfigOperator {
  readString: (name: string) => DbResult<string>;
  saveString: (name: string, v: string) => DbWriteResult;
  readInt: (name: string) => DbResult<number>;
  saveInt: (name: string, v: number) => DbWriteResult;
  readTime: (name: string) => DbResult<Dayjs>;
  saveTime: (name: string, v: Dayjs) => DbWriteResult;
  readJson: (name: string) => DbResult<unknown>;
  saveJson: (name: string, v: unknown) => DbWriteResult;
}

/// ------------------------------------------------
/// work_reports_to_process table
class WorkReportsToProcessRecord extends Model {}

WorkReportsToProcessRecord.init({
  report_block: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true,
  },
  work_reports: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  status: {
    type: DataTypes.STRING,
    allowNull: false,
  },
}, {
  tableName: 'work_reports_to_process'
});

type WorkReportsProcessStatus = 'new' | 'processed' | 'failed';

export interface WorkReportsToProcessOperator {
  addWorkReports: (reportBlock: number, workReports: WorkReportsToProcess[]) => Promise<number>;
  getPendingWorkReports: (count: number, beforeBlock: number) => Promise<WorkReportsToProcessRecord[]>;
  updateStatus: (ids: number[], status: WorkReportsProcessStatus) => DbWriteResult;
}

/// ------------------------------------------------
/// files_v2 table
class FilesV2Record extends Model {}

FilesV2Record.init({
  cid: {
    type: DataTypes.STRING,
    allowNull: false,
    primaryKey: true,
  },
  file_info: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  last_sync_block: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  last_sync_time: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  need_sync: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
  },
  is_closed: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
  },
  last_spower_update_block: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  last_spower_update_time: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  next_spower_update_block: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  is_spower_updating: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
  }
}, {
  tableName: 'files_v2'
});

export interface FilesV2Operator {
  upsertNeedSync: (cids: string[]) => Promise<[number, number]>;
  setIsClosed: (cids: string[], currBlock: number) => Promise<number>;
  getNeedSync: (count: number) => Promise<string[]>;
  getNeedSpowerUpdateRecords: (count: number, currBlock: number) => Promise<FilesV2Record[]>;
  deleteRecords: (cids: string[]) => Promise<number>;
  updateRecords: (records: FilesV2Record[]) => Promise<number>;
  upsertRecords: (records: FilesV2Record[]) => Promise<number>;
  getExistingCids: (cids: string[]) => Promise<string[]>;
  setIsSpowerUpdating: (cids: string[]) => Promise<number>;
  clearIsSpowerUpdating: () => Promise<number>;
}
