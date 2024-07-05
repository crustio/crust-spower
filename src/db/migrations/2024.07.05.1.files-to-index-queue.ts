import { DataTypes, QueryInterface, Sequelize } from 'sequelize';
import { MigrationFn } from 'umzug';
import { withTransaction } from '../db-utils';

export const up: MigrationFn<QueryInterface> = async ({
  context: sequelize,
}) => {
  await createFilesToIndexQueueTable(sequelize);
};

export const down: MigrationFn<QueryInterface> = async ({
  context: sequelize,
}) => {
  await sequelize.dropTable('files_to_index_queue');
};

async function createFilesToIndexQueueTable(sequelize: QueryInterface) {
  await withTransaction(sequelize, async (transaction) => {
    await sequelize.createTable(
      'files_to_index_queue',
      {
        cid: {
          type: DataTypes.STRING,
          allowNull: false,
          primaryKey: true,
        },
        status: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        last_updated: {
          type: DataTypes.DATE(3),
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)'),
        },
        create_at: {
          type: DataTypes.DATE(3),
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP(3)')
        },
      },
      {
        transaction,
      },
    );

    await sequelize.addIndex('files_to_index_queue', ['status'], {
      transaction,
    });
    await sequelize.addIndex('files_to_index_queue', ['last_updated'], {
      transaction,
    });
    await sequelize.addIndex('files_to_index_queue', ['create_at'], {
      transaction,
    });
  });
}

