import { Dayjs } from 'dayjs';
import CrustApi from '../chain';
import { SPowerConfig } from './spower-config';
import { Sequelize } from 'sequelize';

export interface AppContext {
  startTime: Dayjs;
  config: NormalizedConfig;
  api: CrustApi;
  database: Sequelize;
}
