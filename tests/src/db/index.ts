import { SPowerConfig } from '../types/spower-config';
import { Sequelize, Transaction } from 'sequelize';
import { createChildLogger } from '../utils/logger';
import { applyMigration } from './migration';
import { AccountsRecord, ConfigRecord, FilesRecord, GroupMembersRecord, OrdersRecord, SworkerKeysRecord, WorkReportsRecord, } from '../types/database';

export async function loadDb(config: SPowerConfig): Promise<Sequelize> {
  const logger = createChildLogger({
    moduleId: 'db',
    modulePrefix: '💽',
  });
  
  const dbConfig = config.database;
  if (dbConfig.dialect !== 'mysql') {
    throw new Error('Only mysql is supported');
  }
  // Create schema first if not exists
  const sequelizeWithoutDB = new Sequelize('', dbConfig.username, dbConfig.password, {
    dialect: 'mysql',
    host: dbConfig.host,
    port: dbConfig.port,
    timezone: '+08:00',
  });
  try {
    await sequelizeWithoutDB.query(`CREATE DATABASE IF NOT EXISTS ${dbConfig.database}`);
  } finally {
    await sequelizeWithoutDB.close();
  }
  
  // Configure the real sequelize instance
  const sequelize = new Sequelize(dbConfig.database, dbConfig.username, dbConfig.password, {
    dialect: 'mysql',
    host: dbConfig.host,
    port: dbConfig.port,
    logging: false,
    timezone: '+08:00',
    isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED,
    define: {
      freezeTableName: true,
      timestamps: true,
      createdAt: 'create_at',
      updatedAt: 'last_updated'
    }
  });

  // Apply DB schema migrations
  await applyMigration(sequelize, logger);

  // Test DB connection
  try {
    await sequelize.authenticate();
    logger.info('Connect to db successfully!');
  } catch(err) {
    logger.error(`Failed to connect to db: ${err}`);
    throw err;
  }

  // Init models
  ConfigRecord.initModel(sequelize);
  AccountsRecord.initModel(sequelize);
  OrdersRecord.initModel(sequelize);
  SworkerKeysRecord.initModel(sequelize);
  GroupMembersRecord.initModel(sequelize);
  FilesRecord.initModel(sequelize);
  WorkReportsRecord.initModel(sequelize);

  return sequelize;
}
