import Joi = require('joi');
import { SPowerConfig } from '../types/spower-config';
import { createChildLogger } from '../utils/logger';

const chainConfigSchema = Joi.object().keys({
  account: Joi.string().required(),
  endPoint: Joi.string().required(),
  backup: Joi.string().required(),
  password: Joi.string().required(),
  workReportsProcessorInterval: Joi.number().required(),
  workReportsProcesserBatchSize: Joi.number().required(),
  workReportsProcesserFilesCountLimit: Joi.number().required(),
  filesV2SyncBatchSize: Joi.number().required(),
  filesV2IndexAllKeyBatchSize: Joi.number().required(),
  filesV2IndexChangedSyncInterval: Joi.number().required(),
  spowerReadyPeriod: Joi.number().required(),
  spowerCalculateBatchSize: Joi.number().required(),
  spowerServiceEffectiveBlock: Joi.number().required(),
});

const databaseConfigSchema = Joi.object().keys({
  dialect: Joi.string().required(),
  host: Joi.string().required(),
  port: Joi.number().required(),
  username: Joi.string().required(),
  password: Joi.string().required(),
  database: Joi.string().required(),
});

const telemetryConfigSchema = Joi.object().keys({
  endPoint: Joi.string().required(),
});

const apiConfigSchema = Joi.object().keys({
  port: Joi.number().required(),
});

const configSchema = Joi.object()
  .keys({
    chain: chainConfigSchema.required(),
    telemetry: telemetryConfigSchema.required(),
    database: databaseConfigSchema.required(),
    api: apiConfigSchema.required(),
  })
  .unknown();

const logger = createChildLogger({
  moduleId: 'config',
});

export function validateConfig(config: unknown): SPowerConfig {
  const r = configSchema.validate(config, {
    allowUnknown: true,
  });
  if (r.error) {
    logger.error('invalid config', r.error.message);
    for (const details of r.error.details) {
      logger.error(details.message);
    }
    throw new Error('invalid config');
  }
  return r.value as SPowerConfig;
}
