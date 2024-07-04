import { Dayjs } from 'dayjs';
import { WorkReportsToProcess } from './chain';
import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model, Sequelize, Transaction } from 'sequelize';

export type DbResult<T> = Promise<T | null>;
export type DbWriteResult = Promise<void>;

/// --------------------------------------------------
/// Config Table
export class ConfigRecord extends Model {
  static initModel(sequelize: Sequelize) {
    ConfigRecord.init({
        name: {
          type: DataTypes.STRING,
          allowNull: false,
          primaryKey: true,
        },
        content: {
          type: DataTypes.TEXT('medium'),
          allowNull: true,
        },
        last_updated: {
          type: DataTypes.DATE(3),
          allowNull: false,
        },
        create_at: {
          type: DataTypes.DATE(3),
          allowNull: false,
        },
    }, {
      sequelize,
      tableName: 'config'
    });
  }
};

export interface ConfigOperator {
  readString: (name: string) => DbResult<string>;
  saveString: (name: string, v: string, transaction?: Transaction) => DbWriteResult;
  readInt: (name: string) => DbResult<number>;
  saveInt: (name: string, v: number, transaction?: Transaction) => DbWriteResult;
  readTime: (name: string) => DbResult<Dayjs>;
  saveTime: (name: string, v: Dayjs, transaction?: Transaction) => DbWriteResult;
  readJson: (name: string) => DbResult<unknown>;
  saveJson: (name: string, v: unknown, transaction?: Transaction) => DbWriteResult;
};

/// ------------------------------------------------
/// work_reports_to_process table
export class WorkReportsToProcessRecord extends Model<InferAttributes<WorkReportsToProcessRecord>, InferCreationAttributes<WorkReportsToProcessRecord>> {
  declare id: CreationOptional<number>;
  declare report_block: number
  declare work_reports: string;
  declare status: string;
  declare last_updated: CreationOptional<Date>;
  declare create_at: CreationOptional<Date>;
  static initModel(sequelize: Sequelize) {
    WorkReportsToProcessRecord.init({
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        allowNull: false,
        primaryKey: true,
    },
    report_block: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
    },
    work_reports: {
      type: DataTypes.TEXT('medium'),
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    last_updated: {
        type: DataTypes.DATE(3),
        allowNull: false,
    },
    create_at: {
        type: DataTypes.DATE(3),
        allowNull: false,
    },
  }, {
    sequelize,
    tableName: 'work_reports_to_process'
  });
  }
};

export type WorkReportsProcessStatus = 'new' | 'processed' | 'failed';

export interface WorkReportsToProcessOperator {
  addWorkReports: (reportBlock: number, workReports: WorkReportsToProcess[]) => Promise<number>;
  getPendingWorkReports: (count: number, beforeBlock: number) => Promise<WorkReportsToProcessRecord[]>;
  updateStatus: (ids: number[], status: WorkReportsProcessStatus) => DbWriteResult;
  purgeRecords: (persistTimeInHours: number) => Promise<number>;
};

/// ------------------------------------------------
/// files_v2 table
export class FilesV2Record extends Model<InferAttributes<FilesV2Record>, InferCreationAttributes<FilesV2Record>> {
  declare cid: string;
  declare file_size: bigint | null;
  declare spower: bigint | null;
  declare expired_at: number | null;
  declare calculated_at: number | null;
  declare amount: bigint | null;
  declare prepaid: bigint | null;
  declare reported_replica_count: number | null;
  declare remaining_paid_count: number | null;
  declare file_info: string | null;
  declare last_sync_block: number | null;
  declare last_sync_time: Date | null;
  declare need_sync: boolean | null;
  declare is_closed: boolean | null;
  declare last_spower_update_block: number | null;
  declare last_spower_update_time: Date | null;
  declare next_spower_update_block: number | null;
  declare is_spower_updating: boolean | null;
  declare last_updated: CreationOptional<Date>;
  declare create_at: CreationOptional<Date>;

  static initModel(sequelize: Sequelize) {
    FilesV2Record.init({
      cid: {
        type: DataTypes.STRING,
        allowNull: false,
        primaryKey: true,
      },
      file_size: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      spower: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      expired_at: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      calculated_at: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      amount: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      prepaid: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      reported_replica_count: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      remaining_paid_count: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      file_info: {
        type: DataTypes.TEXT('medium'),
        allowNull: true,
      },
      last_sync_block: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      last_sync_time: {
        type: DataTypes.DATE(3),
        allowNull: true,
      },
      need_sync: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      is_closed: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      last_spower_update_block: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      last_spower_update_time: {
        type: DataTypes.DATE(3),
        allowNull: true,
      },
      next_spower_update_block: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      is_spower_updating: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      last_updated: {
        type: DataTypes.DATE(3),
        allowNull: false,
      },
      create_at: {
        type: DataTypes.DATE(3),
        allowNull: false,
      },
    }, {
      sequelize,
      tableName: 'files_v2'
    });
  }
};

export interface FilesV2Operator {
  upsertNeedSync: (cids: string[]) => Promise<[number, number]>;
  setIsClosed: (cids: string[], currBlock: number) => Promise<number>;
  getNeedSync: (count: number) => Promise<string[]>;
  getNeedSpowerUpdateRecords: (count: number, currBlock: number) => Promise<FilesV2Record[]>;
  deleteRecords: (cids: string[], transaction?: Transaction) => Promise<number>;
  updateRecords: (records: FilesV2Record[], updateFields: string[], transaction?: Transaction) => Promise<number>;
  upsertRecords: (records: FilesV2Record[], upsertFields: string[]) => Promise<number>;
  getExistingCids: (cids: string[]) => Promise<string[]>;
  setIsSpowerUpdating: (cids: string[]) => Promise<number>;
  clearIsSpowerUpdating: () => Promise<number>;
};