import express, {Application, NextFunction} from 'express';
import {Request, Response} from 'express';
import * as bodyParser from 'body-parser';
import timeout from 'connect-timeout';
import { processFilesToIndexQueue, replayFiles, stats } from './api';
import { AppContext } from '../types/context';
import { createChildLogger } from '../utils/logger';

const logger = createChildLogger({ moduleId: 'http-api-server' });

export default class CrustSpowerHttpServer {
  private readonly context: AppContext;
  private readonly port: string;
  private readonly app: Application;

  constructor(context: AppContext) {
    this.context = context;

    this.port = context.config.api.port;
    
    this.app = express();
  }

  async initServer(): Promise<void> {

    this.app.use(bodyParser.json({limit: '50mb'}));
    this.app.use(bodyParser.urlencoded({limit: '50mb', extended: true}));
    this.app.use(bodyParser.json());
    this.app.use(this.loggingResponse);

    // API timeout handler
    this.app.use(timeout('600s'));

    // Get routes
    this.app.get('/api/v1/stats', (req, res) => { stats(req, res, this.context); });

    // Post routes
    this.app.post('/api/v1/files_queue/process', (req, res) => { processFilesToIndexQueue(req, res, this.context); });
    this.app.post('/api/v1/files/replay', (req, res) => { replayFiles(req, res, this.context); });

    // Error handler
    this.app.use(this.errorHandler);
    process.on('uncaughtException', (err: Error) => {
      logger.error(`☄️ [global] Uncaught exception ${err.message}`);
      this.errorHandler(err, null, null, null);
    });
  }

  async run(): Promise<void> {
    this.app.listen(this.port, () => {
      logger.info(
        `⚡️ [global]: Crust Spower HTTP API Server is running at https://localhost:${this.port}`
      );
    });
  }

  private errorHandler(
    err: any,
    _req: Request | null,
    res: Response | null,
    _next: any
  ) {
    const errMsg: string = '' + err ? err.message : 'Unknown error';
    logger.error(`☄️ [global]: Error catched: ${errMsg}.`);
    if (res) {
      res.status(400).send({
        status: 'error',
        message: errMsg,
      });
    }
  };

  private loggingResponse (_: Request, res: Response, next: NextFunction) {
    const send = res.send;
    res.send = function (...args: any) {
      if (args.length > 0) {
        logger.info(`  ↪ [${res.statusCode}]: ${args[0]}`);
      }
      send.call(res, ...args);
    } as any;
    next();
  };
}
