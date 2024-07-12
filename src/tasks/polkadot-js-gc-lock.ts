import { sleep } from "../utils";
import { createChildLogger } from "../utils/logger";

const logger = createChildLogger({ moduleId: 'polkadot-js-gc-lock' });

// Tasks that need to use polkadot-js api
export enum TaskName {
    WorkReportsIndexerTask = 'WorkReportsIndexerTask',
    WorkReportsProcessorTask = 'WorkReportsProcessorTask',
    FilesV2IndexerTask = 'FilesV2IndexerTask',
    SpowerCalculatorTask= 'SpowerCalculatorTask',
    FilesReplayTask = 'FilesReplayTask'
}

export default class PolkadotJsGCLock {
    private isInGCPhase = false;
    private tasksLockMap = new Map<string, boolean>();

    constructor() {
        
        const taskNames = Object.keys(TaskName);
        taskNames.forEach(taskName => {
            this.tasksLockMap.set(taskName, false);
        });
    }

    public async acquireTaskLock(taskName: TaskName): Promise<void> {
        do {
            if (this.isInGCPhase) {
                // In gc phase, wait until gc complete
                logger.info(`In gc phase, wait until gc complete - '${taskName}'`);
                // Release the task lock first
                this.tasksLockMap.set(taskName.toString(), false);

                await sleep(3000);
            } else {
                logger.debug(`Acquired the task lock successfully - '${taskName}'`);
                this.tasksLockMap.set(taskName.toString(), true);
                break;
            }
        } while(true);
    }

    public async releaseTaskLock(taskName: TaskName) {
        this.tasksLockMap.set(taskName.toString(), false);
    }

    public async acquireGCLock(): Promise<boolean> {
        const MaxRetryTimes = 100;
        let retryTimes = 0;
        do {
            // Set the flag first
            this.isInGCPhase = true;

            logger.info(`Acquiring the gc lock...`);
            // Check whether all tasks have released the lock
            let allReleased = true;
            for (const [_taskName, isLocked] of this.tasksLockMap) {
                if (isLocked) {
                    allReleased = false;
                }
            }

            if (allReleased) {
                logger.info(`Acquired the gc lock successfully`);
                return true;
            } else {
                retryTimes++;
                if (retryTimes > MaxRetryTimes) {
                    // Exceed the max retry times, release the lock and return false
                    this.isInGCPhase = false;
                    return false;
                }
                // Keep waiting
                await sleep(3000);
            }
        } while(true);
    }

    public async releaseGCLock(): Promise<void> {
        this.isInGCPhase = false;
    }
}