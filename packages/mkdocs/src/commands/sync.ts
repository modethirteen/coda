import { CommandModule, Argv, ArgumentsCamelCase } from 'yargs';
import { CodaStreamFactory, pipeline } from '@modethirteen/coda-stream';
import { CodaFetchFactory, MemoryCache } from '@modethirteen/coda-client';
import { MkDocsWriter } from '../lib/MkDocsWriter.js';
import { MkDocsMarkdownFormatter } from '../lib/MkDocsMarkdownFormatter.js';
import logger from '../lib/logger.js';
import { mkDocsConfigReader } from '../lib/mkDocsConfigReader.js';

interface SyncArgs {
  dir?: string;
}

const handler = async (args: ArgumentsCamelCase<SyncArgs>) => {
  const directory = args.dir ?? './';
  const config = await mkDocsConfigReader({ directory });
  const { docsDir, codaNavUrls } = config;
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
      directory,
      docsDirectory: docsDir,
      logger,
      mode: 'merge',
    }),
    urls: codaNavUrls,
    deep: false,
  });
};

const exporter: CommandModule<{}, SyncArgs> = {
  command: 'sync [dir]',
  describe: 'Replace mkdocs.yml linked Coda pages with exported Markdown content',
  builder: (yargs: Argv) => {
    return yargs
      .positional('dir', {
        description: 'The location of the mkdocs.yml file and docs dir',
        type: 'string',
        default: './',
      })
  },
  handler,
}

export default exporter;
