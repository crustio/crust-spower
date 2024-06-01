export interface ChainConfig {
  account: string;
  endPoint: string;
  backup: string;
  password: string;
  workReportsProcesserBatchSize: number;
  spowerCalculateBatchSize: number;
}

export interface TelemetryConfig {
  endPoint: string;
}

export interface SPowerConfig {
  chain: ChainConfig;
  telemetry: TelemetryConfig;
  dataDir: string;
}
