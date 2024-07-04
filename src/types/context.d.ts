import { Dayjs } from 'dayjs';
import CrustApi from '../chain';
import { Sequelize } from 'sequelize';
import PolkadotJsGCLock from '../tasks/polkadot-js-gc-lock';

export interface AppContext {
  startTime: Dayjs;
  config: NormalizedConfig;
  api: CrustApi;
  database: Sequelize;
  gcLock: PolkadotJsGCLock;
}
