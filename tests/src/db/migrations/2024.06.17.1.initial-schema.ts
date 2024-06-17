import { DataTypes, QueryInterface, Sequelize } from 'sequelize';
import { MigrationFn } from 'umzug';
import { withTransaction } from '../db-utils';

export const up: MigrationFn<QueryInterface> = async ({
  context: sequelize,
}) => {
  await createConfigTable(sequelize);
  await createAccountsTable(sequelize);
  await createOrdersTables(sequelize);
};

export const down: MigrationFn<QueryInterface> = async ({
  context: sequelize,
}) => {
  await sequelize.dropTable('orders')
  await sequelize.dropTable('accounts');
  await sequelize.dropTable('config');
};

async function createConfigTable(sequelize: QueryInterface) {
  await withTransaction(sequelize, async (transaction) => {
    await sequelize.createTable('config', {
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
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)'),
      },
      create_at: {
        type: DataTypes.DATE(3),
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP(3)')
      },
    }, {
      transaction
    });
  });
}

async function createAccountsTable(sequelize: QueryInterface) {
  await withTransaction(sequelize, async (transaction) => {
    await sequelize.createTable(
      'accounts',
      {
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

    await sequelize.addIndex('accounts', ['address'], {
      transaction,
      unique: true
    });
    await sequelize.addIndex('accounts', ['type'], {
      transaction,
    });
    await sequelize.addIndex('accounts', ['last_updated'], {
      transaction,
    });
    await sequelize.addIndex('accounts', ['create_at'], {
      transaction,
    });
  });
}


async function createOrdersTables(sequelize: QueryInterface) {
  await withTransaction(sequelize, async (transaction) => {
    await sequelize.createTable(
      'orders',
      {
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

    await sequelize.addIndex('orders', ['cid'], {
      transaction,
      unique: true
    });
    await sequelize.addIndex('orders', ['last_updated'], {
      transaction,
    });
    await sequelize.addIndex('orders', ['create_at'], {
      transaction,
    });
  });
}

