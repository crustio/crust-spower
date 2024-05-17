import { Dayjs } from 'dayjs';
import { WorkReportsToProcess } from './chain';

type DbResult<T> = Promise<T | null>;
type DbWriteResult = Promise<void>;

export interface SDatabase {
  getConfig: (name: string) => Promise<string | null>;
}

/// Config Table
export interface ConfigOperator {
  readString: (name: string) => DbResult<string>;
  saveString: (name: string, v: string) => DbWriteResult;
  readInt: (name: string) => DbResult<number>;
  saveInt: (name: string, v: number) => DbWriteResult;
  readTime: (name: string) => DbResult<Dayjs>;
  saveTime: (name: string, v: Dayjs) => DbWriteResult;
  readJson: (name: string) => DbResult<unknown>;
  saveJson: (name: string, v: unknown) => DbWriteResult;
}

export interface LatestBlockTime {
  block: number;
  time: number;
}

/// WorkReportsProcess table
type WorkReportsProcessStatus = 'new' | 'processed' | 'failed' | 'done';

export interface WorkReportsToProcessRecord extends WorkReportsToProcess {
  id: number;
  status: FileStatus;
  last_updated: number;
  create_at: number;
}

export interface WorkReportsToProcessOperator {
  addWorkReports: (workReports: WorkReportsToProcess[]) => Promise<number>;
  getPendingWorkReports: (count: number) => Promise<WorkReportsToProcessRecord[]>;
  updateWorkReportRecordStatus: (id: number, status: WorkReportsProcessStatus) => DbWriteResult;
}
