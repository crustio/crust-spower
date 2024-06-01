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
  await createUpdatedFilesToProcessTable(sequelize);
  await createFilesInfoV2Table(sequelize);
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

async function createUpdatedFilesToProcessTable(sequelize: QueryInterface) {
  await withTransaction(sequelize, async (transaction) => {
    await sequelize.createTable(
      'updated_files_to_process',
      {
        id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          primaryKey: true,
        },
        update_block: {
          type: DataTypes.INTEGER,
          allowNull: false,
          unique: true,
        },
        is_file_info_v2_retrieved: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
        },
        updated_files: {
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

    await sequelize.addIndex('updated_files_to_process', ['update_block'], {
      transaction,
    });
    await sequelize.addIndex('updated_files_to_process', ['status','update_block', 'is_file_info_v2_retrieved'], {
      transaction,
    });
    await sequelize.addIndex('updated_files_to_process', ['last_updated'], {
      transaction,
    });
    await sequelize.addIndex('updated_files_to_process', ['create_at'], {
      transaction,
    });
  });
}

async function createFilesInfoV2Table(sequelize: QueryInterface) {
  await withTransaction(sequelize, async (transaction) => {
    await sequelize.createTable(
      'files_info_v2',
      {
        id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          primaryKey: true,
        },
        cid: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        update_block: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        file_info: {
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

    await sequelize.addIndex('files_info_v2', ['cid', 'update_block'], {
      transaction,
      unique: true,
    });
    await sequelize.addIndex('files_info_v2', ['last_updated'], {
      transaction,
    });
    await sequelize.addIndex('files_info_v2', ['create_at'], {
      transaction,
    });
  });
}