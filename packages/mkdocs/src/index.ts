import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import exporter from './commands/exporter.js';

yargs(hideBin(process.argv))
  .command(exporter)
  .help()
  .argv
