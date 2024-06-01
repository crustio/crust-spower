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
  getPendingWorkReports: (count: number) => Promise<WorkReportsToProcessRecord[]>;
  updateStatus: (ids: number[], status: WorkReportsProcessStatus) => DbWriteResult;
}

/// updated_files_to_process table
type UpdatedFileToProcessStatus = 'new' | 'processed' | 'failed';

export interface UpdatedFileToProcessRecord {
  id: number;
  update_block: number;
  updated_files: string;
  status: WorkReportsProcessStatus;
  last_updated: Date;
  create_at: Date;
}

export interface UpdatedFilesToProcessOperator {
  addUpdatedFiles: (updateBlock: number, isFileInfoV2Retrieved: boolean, updatedFiles: UpdatedFileToProcess[]) => Promise<number>;
  getMinimumUnProcessedBlockWithFileInfoV2Data: () => Promise<number>;
  getPendingUpdatedFilesTillBlock: (updateBlock: number) => Promise<UpdatedFileToProcessRecord[]>;
  updateRecordsStatus: (ids: number[], status: UpdatedFileToProcessStatus) => DbWriteResult;
}

/// file_info_v2 table

export interface FileInfoV2Record {
  id: number;
  cid: string;
  file_info: string;
  update_block: number;
  last_updated: Date;
  create_at: Date;
}

export interface FileInfoV2Operator {
  add: (fileInfoV2Map: Map<string, FileInfoV2>, updateBlock: number) => Promise<number>;
  getFileInfoV2AtBlock: (cids: string[], updateBlock: number) => Promise<FileInfoV2Record[]>;
  getNonExistCids: (cids: string[], updateBlock: number) => Promise<string[]>;
}