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
    tableName: 'accounts'
  });
  }
};