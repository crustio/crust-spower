import { DataTypes, QueryInterface, Sequelize } from 'sequelize';
import { MigrationFn } from 'umzug';
import { withTransaction } from '../db-utils';

export const up: MigrationFn<QueryInterface> = async ({
  context: sequelize,
}) => {
  await createFileRecordsTable(sequelize);
  await createWorkReportsTable(sequelize);
};

export const down: MigrationFn<QueryInterface> = async ({
  context: sequelize,
}) => {
  await sequelize.dropTable('file_records');
  await sequelize.dropTable('work_reports');
};

async function createFileRecordsTable(sequelize: QueryInterface) {
  await withTransaction(sequelize, async (transaction) => {
    await sequelize.createTable(
      'file_records',
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

    await sequelize.addIndex('file_records', ['cid', 'group_address'], {
      transaction,
      unique: true
    });
    await sequelize.addIndex('file_records', ['group_address', 'reported_sworker_address'], {
      transaction,
    });
    await sequelize.addIndex('file_records', ['reported_sworker_address', 'is_to_cleanup', 'cleanup_done'], {
      transaction,
    });
    await sequelize.addIndex('file_records', ['last_updated'], {
      transaction,
    });
    await sequelize.addIndex('file_records', ['create_at'], {
      transaction,
    });
  });
}

async function createWorkReportsTable(sequelize: QueryInterface) {
    await withTransaction(sequelize, async (transaction) => {
    await sequelize.createTable(
      'work_reports',
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

    await sequelize.addIndex('work_reports', ['sworker_address', 'slot'], {
      transaction,
      unique: true
    });
    await sequelize.addIndex('work_reports', ['slot'], {
      transaction,
    });
    await sequelize.addIndex('work_reports', ['report_done'], {
      transaction,
    });
    await sequelize.addIndex('work_reports', ['last_updated'], {
      transaction,
    });
    await sequelize.addIndex('work_reports', ['create_at'], {
      transaction,
    });
  });
}

