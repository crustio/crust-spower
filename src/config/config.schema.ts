import Joi = require('joi');
import { SPowerConfig } from '../types/spower-config';
import { createChildLogger } from '../utils/logger';

const chainConfigSchema = Joi.object().keys({
  account: Joi.string().required(),
  endPoint: Joi.string().required(),
});

const telemetryConfigSchema = Joi.object().keys({
  endPoint: Joi.string().required(),
});

const configSchema = Joi.object()
  .keys({
    chain: chainConfigSchema.required(),
    telemetry: telemetryConfigSchema.required(),
    dataDir: Joi.string().default('data').required()
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
