import path from 'path';
import fs from 'fs';
import YAML from 'yaml';
import lodash from 'lodash';
import { NavNode } from '../types';

const { isError } = lodash;

const getCodaNavUrls = (nav: NavNode[]): string[] => {
  const urls: string[] = [];
  const visit = (node: NavNode) => {
    for (const [_, value] of Object.entries(node)) {
      if (typeof value === 'string' && value.startsWith('https://coda.io/')) {
        urls.push(value);
      } else if (Array.isArray(value)) {
        value.forEach(visit);
      }
    }
  };
  nav.forEach(visit);
  return urls;
}

interface ParsedMkDocsYaml {
  docs_dir?: string;
  nav?: NavNode[];
}

interface Config {
  docsDir: string;
  codaNavUrls: string[];
  parsedMkDocsYaml: ParsedMkDocsYaml;
}

export const mkDocsConfigReader = async (options: {
  directory: string;
}): Promise<Config> => {
  const { directory } = options;
  const configPath = path.join(directory, 'mkdocs.yml');
  try {
    const yaml = await fs.promises.readFile(configPath);
    const parsed: ParsedMkDocsYaml = YAML.parse(yaml.toString('utf-8'));
    return {
      docsDir: parsed.docs_dir ?? 'docs',
      codaNavUrls: parsed.nav ? getCodaNavUrls(parsed.nav) : [],
      parsedMkDocsYaml: parsed,
    };
  } catch (e) {
    if (isError(e)) {
      throw new Error(`Could not locate or parse ${configPath}`, e);
    }
    throw e;
  }
}
