export interface ChainConfig {
  endPoint: string;
  placeOrderAccountsNumber: number;
  placeOrderFrequency: number;
  placeOrderLimit: number;
  groupAccountsNumber: number;
  sworkerAccountsNumber: number;
}

export interface DatabaseConfig {
  dialect: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

export interface SPowerConfig {
  chain: ChainConfig;
  database: DatabaseConfig;
}
