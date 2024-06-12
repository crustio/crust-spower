import { SPowerConfig } from '../types/spower-config';
import { Sequelize } from 'sequelize';
import { createChildLogger } from '../utils/logger';
import { applyMigration } from './migration';

export let sequelize: Sequelize;

export async function loadDb(config: SPowerConfig): Promise<Sequelize> {
  const logger = createChildLogger({
    moduleId: 'db',
    modulePrefix: '💽',
  });
  
  const dbConfig = config.database;
  if (dbConfig.dialect !== 'mysql') {
    throw new Error('Only mysql is supported');
  }
  sequelize = new Sequelize(dbConfig.database, dbConfig.username, dbConfig.password, {
    dialect: 'mysql',
    host: dbConfig.host,
    port: dbConfig.port,
    define: {
      freezeTableName: true,
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

  return sequelize;
}
