import { CodaPipelineResult, CodaTransformerBase } from '@modethirteen/coda-stream';
import { remark } from 'remark';
import remarkNormalizeHeadings from 'remark-normalize-headings';
import remarkStringify from 'remark-stringify';

export class MkDocsMarkdownFormatter extends CodaTransformerBase {
  public async transform(result: CodaPipelineResult): Promise<CodaPipelineResult> {
    const { title, subtitle, url } = result;
    let { text } = result;
    text = `
# ${title}

${subtitle}

!!! info "This page is maintained on Coda"

    This content was generated from the [${title}](${url}) page. You can modify the page or suggest changes on Coda.

${text}
`;
    const markdown = await remark()
      .use(remarkNormalizeHeadings)
      .use(remarkStringify, {
        fences: false,
      })
      .process(text);
    return {
      ...result,
      text: String(markdown),
    };
  }
  
  public async finalize(): Promise<void> {
    return Promise.resolve();
  }
}
