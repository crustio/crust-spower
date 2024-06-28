import { Dayjs } from 'dayjs';
import CrustApi from '../chain';
import { Sequelize } from 'sequelize';

export interface AppContext {
  startTime: Dayjs;
  config: NormalizedConfig;
  api: CrustApi;
  database: Sequelize;
}
