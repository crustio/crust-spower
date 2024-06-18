import { DataTypes, QueryInterface, Sequelize } from 'sequelize';
import { MigrationFn } from 'umzug';
import { withTransaction } from '../db-utils';

export const up: MigrationFn<QueryInterface> = async ({
  context: sequelize,
}) => {
  await createGroupMembersTable(sequelize);
  await createSworkerKeysTable(sequelize);
};

export const down: MigrationFn<QueryInterface> = async ({
  context: sequelize,
}) => {
  await sequelize.dropTable('group_members')
};

async function createGroupMembersTable(sequelize: QueryInterface) {
  await withTransaction(sequelize, async (transaction) => {
    await sequelize.createTable(
      'group_members',
      {
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

    await sequelize.addIndex('group_members', ['group_address'], {
      transaction,
    });
    await sequelize.addIndex('group_members', ['last_updated'], {
      transaction,
    });
    await sequelize.addIndex('group_members', ['create_at'], {
      transaction,
    });
  });
}

async function createSworkerKeysTable(sequelize: QueryInterface) {
  await withTransaction(sequelize, async (transaction) => {
    await sequelize.createTable(
      'sworker_keys',
      {
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

    await sequelize.addIndex('sworker_keys', ['sworker_address'], {
      transaction,
      unique: true
    });
    await sequelize.addIndex('sworker_keys', ['last_updated'], {
      transaction,
    });
    await sequelize.addIndex('sworker_keys', ['create_at'], {
      transaction,
    });
  });
}