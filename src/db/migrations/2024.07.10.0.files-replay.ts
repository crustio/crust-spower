import { DataTypes, QueryInterface, Sequelize } from 'sequelize';
import { MigrationFn } from 'umzug';
import { withTransaction } from '../db-utils';

export const up: MigrationFn<QueryInterface> = async ({
  context: sequelize,
}) => {
  await createFilesReplayQueueTable(sequelize);
};

export const down: MigrationFn<QueryInterface> = async ({
  context: sequelize,
}) => {
  await sequelize.dropTable('files_replay');
};

async function createFilesReplayQueueTable(sequelize: QueryInterface) {
  await withTransaction(sequelize, async (transaction) => {
    await sequelize.createTable(
      'files_replay',
      {
        id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          primaryKey: true,
          autoIncrement: true, 
        },
        cid: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        file_size: {
          type: DataTypes.BIGINT,
          allowNull: true,
        },
        status: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        replay_block: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        initial_calculated_at: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        initial_expired_at: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        latest_expired_at: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        initial_replica_count: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        one_hour_replica_count: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        two_hour_replica_count: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        three_hour_replica_count: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        six_hour_replica_count: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        one_day_replica_count: {
          type: DataTypes.INTEGER,
          allowNull: true,
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

    await sequelize.addIndex('files_replay', ['cid'], {
      transaction,
    });
    await sequelize.addIndex('files_replay', ['status'], {
      transaction,
    });
    await sequelize.addIndex('files_replay', ['replay_block'], {
      transaction,
    });
    await sequelize.addIndex('files_replay', ['last_updated'], {
      transaction,
    });
    await sequelize.addIndex('files_replay', ['create_at'], {
      transaction,
    });
  });
}

