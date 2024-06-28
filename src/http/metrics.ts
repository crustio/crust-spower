import { AppContext } from '../types/context';
import { Request, Response } from 'express';
import { createChildLogger } from '../utils/logger';

const logger = createChildLogger({ moduleId: 'api-metrics' });

export async function stats(_req: Request, res: Response, _context: AppContext): Promise<void> {

    const result = {
        name: 'hello stats'
      };
    
    logger.debug(`stats: ${JSON.stringify(result)}`);

    res.json(result);
}