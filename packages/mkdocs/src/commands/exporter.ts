import { CommandModule, Argv, ArgumentsCamelCase } from 'yargs';
import { CodaStreamFactory, pipeline } from '@modethirteen/coda-stream';
import { CodaFetchFactory, MemoryCache } from '@modethirteen/coda-client';
import { MkDocsWriter } from '../lib/MkDocsWriter.js';
import { MkDocsMarkdownFormatter } from '../lib/MkDocsMarkdownFormatter.js';
import logger from '../lib/logger.js';

interface ExporterArgs {
  url: string;
  dir?: string;
}

const handler = async (args: ArgumentsCamelCase<ExporterArgs>) => {
  const { dir, url } = args;
  await pipeline({
    streamFactory: await CodaStreamFactory.new({
      codaFetchFactory: new CodaFetchFactory({
        cache: new MemoryCache({
          logger,
          ttl: 60 * 60 * 1000,
        }),
        token: 'a7dfa13d-d86b-4d01-a38f-1cf6dab6254f',
        logger,
      }),
      logger,
    }),
    transformers: [
      new MkDocsMarkdownFormatter(),
    ],
    writer: new MkDocsWriter({
      directory: dir ?? './',
      logger,
      mode: 'overwrite',
    }),
    urls: [url],
    deep: true,
  });
};

const exporter: CommandModule<{}, ExporterArgs> = {
  command: 'export <url> [dir]',
  describe: 'Export a Coda document, page, or page hierarchy',
  builder: (yargs: Argv) => {
    return yargs
      .positional('url', {
        description: 'The location of a Coda document, page, or page hierarchy',
        type: 'string',
        demandOption: true,
      })
      .positional('dir', {
        description: 'The location to write the mkdocs.yml file and docs dir',
        type: 'string',
        default: './',
      })
  },
  handler,
}

export default exporter;
