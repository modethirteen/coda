export interface CacheInterface {
  set(url: string, response: Response): void;
  get(url: string): Response | undefined;
}
