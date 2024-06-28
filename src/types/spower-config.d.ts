export interface ChainConfig {
  account: string;
  endPoint: string;
  backup: string;
  password: string;
  workReportsProcessorInterval: number;
  workReportsProcesserBatchSize: number;
  workReportsProcesserFilesCountLimit: number;
  filesV2SyncBatchSize: number;
  filesV2IndexAllKeyBatchSize: number;
  filesV2IndexChangedSyncInterval: number;
  spowerReadyPeriod: number;
  spowerCalculateBatchSize: number;
}

export interface TelemetryConfig {
  endPoint: string;
}

export interface DatabaseConfig {
  dialect: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

export interface ApiConfig {
  port: number;
}

export interface SPowerConfig {
  chain: ChainConfig;
  telemetry: TelemetryConfig;
  database: DatabaseConfig;
  api: ApiConfig;
}
