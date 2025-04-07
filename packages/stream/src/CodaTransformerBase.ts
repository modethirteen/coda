import { Transform } from 'stream';
import { CodaPipelineResult } from '@modethirteen/coda-stream';
import { isError } from 'lodash';

export abstract class CodaTransformerBase extends Transform {
  public constructor() {
    super({ objectMode: true });
  }

  public abstract transform(result: CodaPipelineResult): Promise<CodaPipelineResult>;

  public abstract finalize(): Promise<void>;

  /**
   * @internal
   */
  async _transform(
    result: CodaPipelineResult,
    _: any,
    done: (error?: Error | null) => void,
  ) {
    try {
      const object = await this.transform(result);
      if (typeof object === 'undefined') {
        done();
        return;
      }
      if (Array.isArray(object)) {
        object.forEach(o => this.push(o));
        done();
        return;
      }
      this.push(object);
      done();
    } catch (e) {
      if (!isError(e)) {
        throw e;
      }
      done(e);
    }
  }

  /**
   * @internal
   */
  async _final(done: (error?: Error | null) => void) {
    try {
      await this.finalize();
      done();
    } catch (e) {
      if (!isError(e)) {
        throw e;
      }
      done(e);
    }
  }
}
