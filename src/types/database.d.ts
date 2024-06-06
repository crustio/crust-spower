import { Dayjs } from 'dayjs';
import { WorkReportsToProcess } from './chain';
import { AppContext } from './context';

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

/// work_reports_to_process table
type WorkReportsProcessStatus = 'new' | 'processed' | 'failed';

export interface WorkReportsToProcessRecord {
  id: number;
  report_block: number;
  work_reports: string;
  status: WorkReportsProcessStatus;
  last_updated: Date;
  create_at: Date;
}

export interface WorkReportsToProcessOperator {
  addWorkReports: (reportBlock: number, workReports: WorkReportsToProcess[]) => Promise<number>;
  getPendingWorkReports: (count: number, beforeBlock: number) => Promise<WorkReportsToProcessRecord[]>;
  updateStatus: (ids: number[], status: WorkReportsProcessStatus) => DbWriteResult;
}

/// files_v2 table
export interface FilesV2Record {
  cid: string;
  file_info: string;
  last_sync_block: number;
  last_sync_time: Date;
  need_sync: boolean;
  is_closed: boolean;
  last_spower_update_block: number;
  last_spower_update_time: Date;
  next_spower_update_block: number;
  is_spower_updating: boolean;
  last_updated: Date;
  create_at: Date;
}

export interface FilesV2Operator {
  upsertFilesV2: (fileInfoV2Map: Map<string, FileInfoV2>, syncBlock: number, context: AppContext) => Promise<[number, number]>;
  upsertNeedSync: (cids: string[]) => Promise<[number, number]>;
  setIsClosed: (cids: string[], currBlock: number) => Promise<number>;
  getNeedSync: (count: number) => Promise<string[]>;
  getNeedSpowerUpdateRecords: (count: number, currBlock: number) => Promise<FilesV2Record[]>;
  deleteRecords: (cids: string[]) => Promise<number>;
  updateRecords: (records: FilesV2Record[]) => Promise<number>;
  insertRecords: (records: FilesV2Record[]) => Promise<number>;
  getExistingCids: (cids: string[]) => Promise<string[]>;
  setIsSpowerUpdating: (cids: string[]) => Promise<number>;
  clearIsSpowerUpdating: () => Promise<number>;
}
