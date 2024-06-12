import { Dayjs } from 'dayjs';
import CrustApi from '../chain';
import { SPowerConfig } from './spower-config';

export interface AppContext {
  startTime: Dayjs;
  config: NormalizedConfig;
  api: CrustApi;
  database: Sequelize;
}
