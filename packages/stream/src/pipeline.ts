import { pipeline as basePipeline, Writable } from 'stream';
import { CodaStreamFactory } from './CodaStreamFactory';
import { CodaTransformerBase } from './CodaTransformerBase';

export const pipeline = async (options: {
  streamFactory: CodaStreamFactory;
  transformers: CodaTransformerBase[];
  writer: Writable;
  urls: string[];
  deep?: boolean;
}) => {
  const { streamFactory, transformers, writer, urls, deep } = options;
  const stream = await streamFactory.newStream(urls, { deep });
  await new Promise<void>((resolve, reject) => {
    try {
      basePipeline(
        [stream, ...transformers, writer], (error: NodeJS.ErrnoException | null) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        },
      );
    } catch(e) {
      reject(e);
    }
  });
};
