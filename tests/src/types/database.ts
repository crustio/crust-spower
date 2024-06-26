import { Dayjs } from 'dayjs';
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
          type: DataTypes.TEXT,
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
/// accounts table
export class AccountsRecord extends Model<InferAttributes<AccountsRecord>, InferCreationAttributes<AccountsRecord>> {
  declare id: CreationOptional<number>;
  declare address: string
  declare mnemonic: string;
  declare type: string;
  declare last_updated: CreationOptional<Date>;
  declare create_at: CreationOptional<Date>;
  static initModel(sequelize: Sequelize) {
    AccountsRecord.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      allowNull: false,
      primaryKey: true,
    },
    address: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    mnemonic: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    type: {
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
    tableName: 'accounts'
  });
  }
};

/// ------------------------------------------------
/// orders table
export class OrdersRecord extends Model<InferAttributes<OrdersRecord>, InferCreationAttributes<OrdersRecord>> {
  declare id: CreationOptional<number>;
  declare cid: string
  declare file_size: bigint;
  declare reported_file_size: bigint;
  declare reported_as_illegal_file: boolean;
  declare sender: string;
  declare last_updated: CreationOptional<Date>;
  declare create_at: CreationOptional<Date>;
  static initModel(sequelize: Sequelize) {
    OrdersRecord.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      allowNull: false,
      primaryKey: true,
    },
    cid: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    file_size: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    reported_file_size: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    reported_as_illegal_file: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: 0
    },
    sender: {
      type: DataTypes.STRING,
      allowNull: false
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
    tableName: 'orders'
  });
  }
};

/// ------------------------------------------------
/// group_members table
export class GroupMembersRecord extends Model<InferAttributes<GroupMembersRecord>, InferCreationAttributes<GroupMembersRecord>> {
  declare id: CreationOptional<number>;
  declare group_address: string
  declare sworker_address: string;
  declare last_updated: CreationOptional<Date>;
  declare create_at: CreationOptional<Date>;
  static initModel(sequelize: Sequelize) {
    GroupMembersRecord.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      allowNull: false,
      primaryKey: true,
    },
    group_address: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    sworker_address: {
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
    tableName: 'group_members'
  });
  }
};

/// ------------------------------------------------
/// sworker_keys table
export class SworkerKeysRecord extends Model<InferAttributes<SworkerKeysRecord>, InferCreationAttributes<SworkerKeysRecord>> {
  declare id: CreationOptional<number>;
  declare sworker_address: string;
  declare tee_pubkey: string;
  declare last_updated: CreationOptional<Date>;
  declare create_at: CreationOptional<Date>;
  static initModel(sequelize: Sequelize) {
    SworkerKeysRecord.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      allowNull: false,
      primaryKey: true,
    },
    sworker_address: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    tee_pubkey: {
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
    tableName: 'sworker_keys'
  });
  }
};

/// ------------------------------------------------
/// file_records table
export class FilesRecord extends Model<InferAttributes<FilesRecord>, InferCreationAttributes<FilesRecord>> {
  declare id: CreationOptional<number>;
  declare cid: string;
  declare file_size: bigint;
  declare group_address: string;
  declare reported_sworker_address: CreationOptional<string>;
  declare reported_slot: CreationOptional<number>;
  declare reported_block: CreationOptional<number>;
  declare report_done: CreationOptional<boolean>;
  declare is_to_cleanup: CreationOptional<boolean>;
  declare cleanup_done: CreationOptional<boolean>;
  declare last_updated: CreationOptional<Date>;
  declare create_at: CreationOptional<Date>;
  static initModel(sequelize: Sequelize) {
    FilesRecord.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      allowNull: false,
      primaryKey: true,
    },
    cid: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    file_size: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    group_address: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    reported_sworker_address: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    reported_slot: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    reported_block: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    report_done: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    is_to_cleanup: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    cleanup_done: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
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
    tableName: 'file_records'
  });
  }
};

/// ------------------------------------------------
/// work_reports table
export class WorkReportsRecord extends Model<InferAttributes<WorkReportsRecord>, InferCreationAttributes<WorkReportsRecord>> {
  declare id: CreationOptional<number>;
  declare sworker_address: string;
  declare slot: number;
  declare slot_hash: string;
  declare report_block: number;
  declare report_done: boolean;
  declare curr_pk: string;
  declare ab_upgrade_pk: string;
  declare reported_srd_size: bigint;
  declare reported_files_size: bigint;
  declare added_files: string;
  declare deleted_files: string;
  declare reported_srd_root: string;
  declare reported_files_root: string;
  declare sig: string;
  declare last_updated: CreationOptional<Date>;
  declare create_at: CreationOptional<Date>;
  static initModel(sequelize: Sequelize) {
    WorkReportsRecord.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      allowNull: false,
      primaryKey: true,
    },
    sworker_address: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    slot: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    slot_hash: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    report_block: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    report_done: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    curr_pk: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    ab_upgrade_pk: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    reported_srd_size: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    reported_files_size: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    added_files: {
      type: DataTypes.TEXT('medium'),
      allowNull: true,
    },
    deleted_files: {
      type: DataTypes.TEXT('medium'),
      allowNull: true,
    },
    reported_srd_root: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    reported_files_root: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    sig: {
      type: DataTypes.STRING,
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
    tableName: 'work_reports'
  });
  }
};