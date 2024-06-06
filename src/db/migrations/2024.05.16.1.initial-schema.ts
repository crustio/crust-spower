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
    last_updated: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  });

  await createWorkReportsToProcessTable(sequelize);
  // await createUpdatedFilesToProcessTable(sequelize);
  // await createFilesInfoV2Table(sequelize);
  await createFilesV2Table(sequelize);
  await createFilesV2ReplicasTables(sequelize);
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
        report_block: {
          type: DataTypes.INTEGER,
          allowNull: false,
          unique: true,
        },
        work_reports: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        status: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        last_updated: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        create_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
      },
      {
        transaction,
      },
    );

    await sequelize.addIndex('work_reports_to_process', ['report_block'], {
      transaction,
    });
    await sequelize.addIndex('work_reports_to_process', ['status','report_block'], {
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

async function createFilesV2Table(sequelize: QueryInterface) {
  await withTransaction(sequelize, async (transaction) => {
    await sequelize.createTable(
      'files_v2',
      {
        cid: {
          type: DataTypes.STRING,
          allowNull: false,
          primaryKey: true,
        },
        file_info: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        last_sync_block: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        last_sync_time: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        need_sync: {
          type: DataTypes.BOOLEAN,
          allowNull: true,
        },
        is_closed: {
          type: DataTypes.BOOLEAN,
          allowNull: true,
        },
        last_spower_update_block: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        last_spower_update_time: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        next_spower_update_block: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        is_spower_updating: {
          type: DataTypes.BOOLEAN,
          allowNull: true,
        },
        last_updated: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        create_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
      },
      {
        transaction,
      },
    );

    await sequelize.addIndex('files_v2', ['need_sync'], {
      transaction,
    });
    await sequelize.addIndex('files_v2', ['is_closed'], {
      transaction,
    });
    await sequelize.addIndex('files_v2', ['next_spower_update_block', 'need_sync'], {
      transaction,
    });
    await sequelize.addIndex('files_v2', ['is_spower_updating'], {
      transaction,
    });
    await sequelize.addIndex('files_v2', ['last_updated'], {
      transaction,
    });
    await sequelize.addIndex('files_v2', ['create_at'], {
      transaction,
    });
  });
}

