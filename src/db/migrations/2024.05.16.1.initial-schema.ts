import { DataTypes, QueryInterface } from 'sequelize';
import { MigrationFn } from 'umzug';
import { withTransaction } from '../db-utils';

export const up: MigrationFn<QueryInterface> = async ({
  context: sequelize,
}) => {
  await sequelize.createTable('config', {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      primaryKey: true,
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
  });

  await createWorkReportsToProcessTable(sequelize);
};

export const down: MigrationFn<QueryInterface> = async ({
  context: sequelize,
}) => {
  await sequelize.dropTable('work_reports_to_process');
  await sequelize.dropTable('config');
};

async function createWorkReportsToProcessTable(sequelize: QueryInterface) {
  await withTransaction(sequelize, async (transaction) => {
    await sequelize.createTable(
      'work_reports_to_process',
      {
        id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          primaryKey: true,
        },
        sworker_anchor: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        report_slot: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        block_number: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        extrinsic_index: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        reporter: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        owner: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        reported_srd_size: {
          type: DataTypes.BIGINT,
          allowNull: false,
        },
        reported_files_size: {
          type: DataTypes.BIGINT,
          allowNull: false,
        },
        added_files: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        deleted_files: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        status: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        last_updated: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        create_at: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
      },
      {
        transaction,
      },
    );

    await sequelize.addIndex('work_reports_to_process', ['sworker_anchor','report_slot'], {
      transaction,
      unique: true
    });
    await sequelize.addIndex('work_reports_to_process', ['report_slot'], {
      transaction,
    });
    await sequelize.addIndex('work_reports_to_process', ['status','block_number'], {
      transaction,
    });
    await sequelize.addIndex('work_reports_to_process', ['last_updated'], {
      transaction,
    });
    await sequelize.addIndex('work_reports_to_process', ['create_at'], {
      transaction,
    });
  });
}
