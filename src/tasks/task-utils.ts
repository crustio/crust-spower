import { Function0, Function3 } from 'lodash';
import { Logger } from 'winston';
import { AppContext } from '../types/context';
import { SimpleTask } from '../types/tasks';
import { formatError } from '../utils';
import { createChildLoggerWith } from '../utils/logger';

export type IsStopped = Function0<boolean>;

export async function makeIntervalTask(
  startDelay: number,
  interval: number, // in millseconds
  name: string,
  context: AppContext,
  loggerParent: Logger,
  handlerFn: Function3<AppContext, Logger, IsStopped, Promise<void>>,
  showIndicateLog = true,
): Promise<SimpleTask> {
  if (startDelay <= 0 || interval <= 0) {
    throw new Error('invalid arg, interval should be greater than 0');
  }
  const logger = createChildLoggerWith({ moduleId: name }, loggerParent);
  let timer: NodeJS.Timeout;
  let stopped = false;

  const doInterval = async () => {
    if (stopped) {
      return;
    }
    let startTime = performance.now();
    try {
      if (showIndicateLog) {
        logger.info(`start task: "${name}"`);
      }
      await handlerFn(context, logger, () => stopped);
    } catch (e) {
      logger.error(
        'unexpected execption running task "%s", %s',
        name,
        formatError(e),
      );
    } finally {
      if (showIndicateLog) {
        let endTime = performance.now();
        logger.info(`task done: "${name}". Time cost: ${(endTime-startTime).toFixed(2)}ms`);
      }
      if (!stopped) {
        timer = setTimeout(doInterval, interval);
      }
    }
  };
  return {
    name,
    start: () => {
      logger.info(`task "${name}" started`);
      timer = setTimeout(doInterval, startDelay);
      stopped = false;
    },
    stop: async () => {
      logger.info(`task "${name}" stopped`);
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
      return true;
    },
  };
}
