import { CodaError, CodaFetchFactory } from '@modethirteen/coda-client';
import { Readable } from 'stream';
import { Logger } from 'winston';
import { isError } from 'lodash';

interface CodaPage {
  id: string;
  parentId?: string;
  docId: string;
  browserLink: string;
  contentType: 'canvas' | 'embed';
  name: string;
  subtitle?: string;
};

interface CodaResolvedBrowserLinkResponse {
  resource: {
    href: string;
  };
};

interface CodaApiResponse {
  id: string;
  type: string;
  isEffectivelyHidden: boolean;
}

interface CodaPageApiResponse extends CodaApiResponse {
  contentType: 'canvas' | 'embed';
  name: string;
  browserLink: string;
  subtitle: string;
  children?: { href: string; }[];
  parent?: {
    id: string;
  };
}

export type CodaPipelineResult = {
  id: string;
  parentId?: string;
  title: string;
  subtitle?: string;
  url: string;
  text: string;
  doc: {
    id: string;
    title: string;
  };
}

export interface CodaStreamFactoryInterface {
  newStream(urls: string[], options?: { deep?: boolean; }): Promise<Readable>;
}

export class CodaStreamFactory implements CodaStreamFactoryInterface {
  public static async new(options: {
    codaFetchFactory: CodaFetchFactory;
    logger: Logger;   
  }) {
    const { codaFetchFactory, logger } = options;
    return new CodaStreamFactory(
      logger,
      await codaFetchFactory.newCodaFetch({ useCache: true }),
      await codaFetchFactory.newCodaFetch(),
    );
  }

  private constructor(
    private readonly logger: Logger,
    private readonly cachingCodaClient: typeof fetch,
    private readonly codaClient: typeof fetch,
  ) {}

  public async newStream(urls: string[], options?: { deep?: boolean }): Promise<Readable> {
    const { deep = false } = options ?? {};
    return Readable.from(this.execute(urls, deep));
  }

  private async * execute(urls: string[], deep: boolean): AsyncGenerator<CodaPipelineResult, void, undefined> {
    let resultCount = 0;
    const apiUrls: string[] = [];
    const browserLinks: Set<string> = new Set();

    // convert urls to API locations if necessary
    for (const url of urls) {
      if (!url.toLocaleLowerCase('en-US').startsWith('https://coda.io/apis/')) {
        try {
          const response = await this.codaClient(`https://coda.io/apis/v1/resolveBrowserLink?url=${url}`);
          const r = await response.json() as CodaResolvedBrowserLinkResponse;
          apiUrls.push(r.resource.href);
        } catch (e) {
          this.logger.error(`Could not resolve a valid Coda API URL from ${url}`, e);
          continue;
        }
      } else {
        apiUrls.push(url);
      }
    }

    // limit the item count to 1 if a deep scan was not requested. this will ensure that if a document
    // URL was included in the list, only the first page of the document will be returned
    for await (const page of this.buildCodaPageHierarchy(apiUrls, deep, { limit: deep ? undefined : 1 })) {
      const { browserLink, contentType, docId, id, parentId, name, subtitle } = page;
      if (contentType !== 'canvas') {
        continue;
      }
      if (browserLinks.has(browserLink)) {
        this.logger.debug(`Skipping duplicate linked Coda page located at ${browserLink}`);
        continue;
      }
      let docJson: { name: string; };
      try {
        const r = await this.codaClient(`https://coda.io/apis/v1/docs/${docId}`);
        docJson = await r.json();
      } catch (e) {
        if (CodaError.isCodaError(e)) {
          this.logger.warn(`Failed to retrieve linked Coda doc information located at ${e.response.url}`, e);
          continue;
        }
        throw e;
      }
      let exportJson: { href: string; };
      try {
        const r = await this.codaClient(`https://coda.io/apis/v1/docs/${docId}/pages/${id}/export`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({ outputFormat: 'markdown' }),
        });
        exportJson = await r.json();
      } catch (e) {
        if (CodaError.isCodaError(e)) {
          this.logger.warn(`Failed to export linked Coda page content located at ${e.response.url}`, e);
          continue;
        }
        throw e;
      }
      const text = await this.fetchCodaPageContent(exportJson.href);
      if (typeof text !== 'undefined') {
        browserLinks.add(browserLink);
        resultCount++
        yield {
          id,
          parentId,
          title: name,
          subtitle,
          url: browserLink,
          text,
          doc: {
            id: docId,
            title: docJson.name,
          },
        };
      }
    }
  }

  private async * buildCodaPageHierarchy(urls: string[], deep: boolean, options?: { limit?: number }): AsyncGenerator<CodaPage, void, undefined> {
    const { limit } = options ?? {};
    for (const url of urls) {
      let json: CodaApiResponse;
      try {
        const r = await this.cachingCodaClient(url);
        json = await r.json();
      } catch (e) {
        if (CodaError.isCodaError(e)) {
          this.logger.warn(`Failed to retrieve linked Coda page information located at ${e.response.url}`, e);
          continue;
        }
        throw e;
      }
      if (json.type === 'doc') {
        let pagesJson: { items: { href: string }[]; nextPageLink?: string; };
        let pagesHref: string | undefined = `https://coda.io/apis/v1/docs/${json.id}/pages?limit=100`;
        while (typeof pagesHref !== 'undefined') {
          try {
            const r = await this.cachingCodaClient(pagesHref);
            pagesJson = await r.json();
          } catch (e) {
            if (CodaError.isCodaError(e)) {
              this.logger.warn(`Failed to retrieve linked Coda doc information located at ${e.response.url}`, e);
              continue;
            }
            throw e;
          }
          const pages = pagesJson.items.map(c => c.href);
          yield * this.buildCodaPageHierarchy(
            limit ? pages.slice(0, Math.min(limit, pages.length)) : pages,
            false,
          );
          pagesHref = pagesJson.nextPageLink;
        }
      } else if (json.type === 'page' && !json.isEffectivelyHidden) {
        const pageJson = json as CodaPageApiResponse;
        const docIdMatches = url.match(/https:\/\/coda.io\/apis\/v1\/docs\/(.+?)\//);
        if (docIdMatches === null) {
          continue;
        }
        yield {
          id: pageJson.id,
          parentId: pageJson.parent?.id,
          docId: docIdMatches[1],
          browserLink: pageJson.browserLink,
          contentType: pageJson.contentType,
          name: pageJson.name,
          subtitle: pageJson.subtitle,
        };
        if (deep && pageJson.children) {
          yield * this.buildCodaPageHierarchy(pageJson.children.map(c => c.href), deep);
        }
      }
    }
  }

  private async fetchCodaPageContent(exportJsonHref: string, retries = 100, delay = 1000): Promise<string | undefined> {
    try {
      const r = await this.codaClient(exportJsonHref);
      const statusJson: { downloadLink?: string; error?: string } = await r.json();
      const { downloadLink, error } = statusJson;
      if (error) {
        throw new Error(error);
      }
      if (downloadLink) {
        const r = await fetch(downloadLink);
        return await r.text();
      }
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.fetchCodaPageContent(exportJsonHref, retries - 1, delay);
      } else {
        this.logger.warn(`Retries exhausted for fetching Coda page content located at ${exportJsonHref}`);
      }
    } catch (e) {
      if (CodaError.isCodaError(e) && e.response.status === 404) {
        if (retries > 0) {

          // Coda may respond to export requests with an HTTP 404. It seems to be a flaky endpoint
          // so it is treated simply as the download link not ready
          this.logger.info(`Ignoring HTTP 404 from ${exportJsonHref}`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.fetchCodaPageContent(exportJsonHref, retries - 1, delay);
        } else {
          this.logger.warn(`Retries exhausted for fetching Coda page content located at ${exportJsonHref}`);
          return undefined;
        }
      }
      if (isError(e)) {
        this.logger.warn(`Failed to download linked Coda page content located at ${exportJsonHref}`, e);
        return undefined;
      }
      throw e;
    }
    return undefined;
  }
}
