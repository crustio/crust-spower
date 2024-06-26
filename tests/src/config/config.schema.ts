import Joi = require('joi');
import { SPowerConfig } from '../types/spower-config';
import { createChildLogger } from '../utils/logger';

const chainConfigSchema = Joi.object().keys({
  endPoint: Joi.string().required(),
  placeOrderAccountsNumber: Joi.number().required(),
  placeOrderFrequency: Joi.number().required(),
  placeOrderLimit: Joi.number().required(),
  groupAccountsNumber: Joi.number().required(),
  sworkerAccountsNumber: Joi.number().required(),
});

const databaseConfigSchema = Joi.object().keys({
  dialect: Joi.string().required(),
  host: Joi.string().required(),
  port: Joi.number().required(),
  username: Joi.string().required(),
  password: Joi.string().required(),
  database: Joi.string().required(),
});

const configSchema = Joi.object()
  .keys({
    chain: chainConfigSchema.required(),
    database: databaseConfigSchema.required(),
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
