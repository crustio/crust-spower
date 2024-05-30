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

export interface WorkReportsToProcessRecord extends WorkReportsToProcess {
  id: number;
  status: WorkReportsProcessStatus;
  last_updated: number;
  create_at: number;
}

export interface WorkReportsToProcessOperator {
  addWorkReports: (workReports: WorkReportsToProcess[]) => Promise<number>;
  getPendingWorkReports: (count: number) => Promise<WorkReportsToProcessRecord[]>;
  updateWorkReportRecordsStatus: (ids: number[], status: WorkReportsProcessStatus) => DbWriteResult;
}

/// updated_files_to_process table
type UpdatedFileToProcessStatus = 'new' | 'processed' | 'failed';

export interface UpdatedFileToProcessRecord {
  id: number;
  update_block: number;
  updated_files: string;
  status: WorkReportsProcessStatus;
  last_updated: number;
  create_at: number;
}

export interface UpdatedFilesToProcessOperator {
  addUpdatedFiles: (updatedFilesMap: Map<number, UpdatedFileToProcess[]>) => Promise<number>;
  getPendingUpdatedFiles: (count: number) => Promise<UpdatedFileToProcessRecord[]>;
  updateRecordsStatus: (ids: number[], status: UpdatedFileToProcessStatus) => DbWriteResult;
}

// /// file_info_v2_to_index table
// type FileInfoV2ToIndexStatus = 'new' | 'processed' | 'failed';

// export interface FileInfoV2ToIndexRecord {
//   id: number;
//   cid: string;
//   update_block: number;
//   status: FileInfoV2ToIndexStatus;
//   last_updated: number;
//   create_at: number;
// }

// export interface FileInfoV2ToIndexOperator {
//   addToIndexFiles: (toIndexFiles: Map<string, Set<number>>) => Promise<nubmer>;
//   getPendingToIndexFileCids: (count: number, update_block: number) => Promise<string[]>;
//   updateRecordsStatus: (cids: string[], update_block: number, status: FileInfoV2ToIndexStatus) => DbWriteResult;
// }

/// file_info_v2 table

export interface FileInfoV2Record {
  id: number;
  cid: string;
  file_info: string;
  update_block: number;
  last_updated: number;
  create_at: number;
}

export interface FileInfoV2Operator {
  add: (fileInfoV2Map: Map<string, FileInfoV2>, update_block: number) => Promise<number>;
  getFileInfoV2AtBlock: (cids: string[], update_block: number) => Promise<FileInfoV2Record[]>;
  getNonExistCids: (cids: string[], update_block: number) => Promise<string[]>;
}