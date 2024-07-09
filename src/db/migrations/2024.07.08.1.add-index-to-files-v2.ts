import { QueryInterface } from 'sequelize';
import { MigrationFn } from 'umzug';
import { withTransaction } from '../db-utils';
import { noop } from 'lodash';

export const up: MigrationFn<QueryInterface> = async ({
  context: sequelize,
}) => {
  const indexes = await sequelize.showIndex('files_v2') as any;

  await withTransaction(sequelize, async (transaction) => {
    if (!indexes.some(index => index.name === 'files_v2_expired_at')) {
      await sequelize.addIndex('files_v2', ['expired_at'], {
        transaction,
      });
    }

    if (!indexes.some(index => index.name === 'files_v2_calculated_at')) {
      await sequelize.addIndex('files_v2', ['calculated_at'], {
        transaction,
      });
    }

    if (!indexes.some(index => index.name === 'files_v2_reported_replica_count')) {
      await sequelize.addIndex('files_v2', ['reported_replica_count'], {
        transaction,
      });
    }

    if (!indexes.some(index => index.name === 'files_v2_last_sync_block')) {
      await sequelize.addIndex('files_v2', ['last_sync_block'], {
        transaction,
      });
    }

    if (!indexes.some(index => index.name === 'files_v2_last_spower_update_block')) {
      await sequelize.addIndex('files_v2', ['last_spower_update_block'], {
        transaction,
      });
    }
  });
};

export const down: MigrationFn<QueryInterface> = async ({
  context: _sequelize,
}) => {
    noop();
};
