import { SPowerConfig } from '../types/spower-config';
import fse from 'fs-extra';
import { validateConfig } from './config.schema';

export async function loadConfig(file: string): Promise<SPowerConfig> {
  const c = await fse.readFile(file, 'utf8');
  const config = validateConfig(JSON.parse(c));
  return config;
}
