import { CodaPipelineResult } from '@modethirteen/coda-stream';
import lodash from 'lodash';
import { Writable } from 'stream';
import { Logger } from 'winston';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import YAML from 'yaml';
import { NavNode } from '../types';

interface Page {
  id: string;
  parentId?: string;
  title: string;
  filename: string;
}

type ConfigurationWriterMode = 'overwrite' | 'merge';

const { isError } = lodash;

const getHashedPageId = (result: CodaPipelineResult) => {
  const sha1 = crypto.createHash('sha256')
    .update(result.doc.id + result.id)
    .digest('hex');
  return sha1.slice(0, 8);
};

const buildNavTree = (pages: Page[], parentId: string | undefined = undefined): NavNode[] => pages
  .filter(p => p.parentId === parentId)
  .map(p => {
    const children = buildNavTree(pages, p.id);
    const node: NavNode = {
      [p.title]: children.length > 0 ? [{ ['Overview']: p.filename }, ...children] : p.filename,
    };
    return node;
  });

const findNavIndexFilename = (node: NavNode | NavNode[]): string | undefined => {
  if (Array.isArray(node)) {
    for (const subNode of node) {
      const result = findNavIndexFilename(subNode);
      if (result) {
        return result;
      }
    }
  } else {
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (typeof value === 'string') {
        return value;
      } else if (Array.isArray(value)) {
        const result = findNavIndexFilename(value);
        if (result) {
          return result;
        }
      }
    }
  }
  return undefined;
};

/*const replaceCodaUrls = (nav: NavNode[], lookup: { [url: string]: string }): NavNode[] => {
  const walkNav = (node: NavNode): NavNode => {
    const newNode: NavNode = {};
    for (const key in node) {
      const value = node[key];
      if (typeof value === 'string') {
        newNode[key] = lookup[value] ?? value;
      } else if (Array.isArray(value)) {
        newNode[key] = value.map(walkNav);
      }
    }
    return newNode;
  };
  return nav.map(walkNav);
}*/

export class MkDocsWriter extends Writable {
  private readonly logger: Logger;
  private readonly directory: string;
  private readonly mode: ConfigurationWriterMode;
  //private readonly triggerUrl: string;
  private readonly docsPath: string;
  private readonly docs: Record<string, {
    title: string;
    pages: Page[];
  }> = {};

  public constructor(options: {
    logger: Logger;
    directory: string;
    docsDirectory?: string;
    mode: ConfigurationWriterMode;
   // triggerUrl: string;
  }) {
    super({ objectMode: true });
    const {
      logger,
      directory,
      docsDirectory = 'docs',
      mode,
   //   triggerUrl,
    } = options;
    this.logger = logger;
    this.directory = directory;
    this.mode = mode;
  //  this.triggerUrl = triggerUrl;
    this.docsPath = path.join(directory, docsDirectory);
  }

  /**
   * @internal
   */
  async _write(
    result: CodaPipelineResult,
    _e: any,
    done: (error?: Error | null) => void,
  ) {
    try {
      const { id, parentId, title, text, doc } = result;
      const filename = `${getHashedPageId(result)}.md`;
      await fs.promises.mkdir(this.docsPath, { recursive: true });
      await fs.promises.writeFile(path.join(this.docsPath, filename), text);
      (this.docs[doc.id] ??= { title: doc.title, pages: [] }).pages.push({
        id, parentId, title, filename
      });
      done();
    } catch (e) {
      if (isError(e)) {
        this.logger.error('There was a problem writing a Markdown file to disk', e);
        done(e);
      }
      throw e;
    }
  }

  /**
   * @internal
   */
   async _final(done: (error?: Error | null) => void) {
    try {
      if (this.mode === 'overwrite') {
        await fs.promises.mkdir(this.directory, { recursive: true });
        let config: any = {
          site_name: Object.keys(this.docs).join('_'),
          plugins: ['techdocs-core'],
        };
        const pages = Object.values(this.docs).map(d => d.pages).flat();
        const pageIds = pages.map(p => p.id);
        const nodes = buildNavTree(pages.map(p => ({
          ...p,

          // remove parentIds that were not included in this Coda export
          parentId: p.parentId && pageIds.includes(p.parentId) ? p.parentId : undefined,
        })));
        if (nodes.length) {
          config = {
            ...config,
            nav: nodes,
            plugins: [
              ...config.plugins,
              {
                redirects: {
                  redirect_maps: {
                    'index.md': findNavIndexFilename(nodes),
                  },
                },
              },
            ],
          };
        };
        await fs.promises.writeFile(path.join(this.directory, 'mkdocs.yml'), YAML.stringify(config));
      } else if (this.mode === 'merge') {
       // const config = await mkDocsConfigReader({ directory: this.directory });
       // const parsed = config.parsedMkDocsYaml;
      } else {
        throw new Error(`Unsupported configuration writer mode '${this.mode}'`);
      }
      done();
    } catch (e) {
      if (isError(e)) {
        this.logger.error('There was a problem writing the mkdocs.yml file to disk', e);
        done(e);
      }
    }
  }
}
