import Bluebird from 'bluebird';
import { AppContext } from '../types/context';
import { SimpleTask } from '../types/tasks';
import { createChildLogger } from '../utils/logger';
import { createWorkReportsIndexer } from './work-reports-indexer-task';
import { createWorkReportsProcessor } from './work-reports-processor-task';
import { createUpdatedFilesIndexer } from './updated-files-indexer-task';
import { createSpowerCalculator } from './spower-calculator-task';

/**
 * create simpile tasks which only handle start/stop
 */
export async function createSimpleTasks(
  context: AppContext,
): Promise<SimpleTask[]> {
  const logger = createChildLogger({ moduleId: 'simple-tasks' });
  const tasks = [
    createWorkReportsIndexer,
    createWorkReportsProcessor,
    createUpdatedFilesIndexer,
    createSpowerCalculator
  ];
  return Bluebird.mapSeries(tasks, (t) => {
    return t(context, logger);
  });
}
