export type DatabaseLock = <T>(task: () => Promise<T>) => Promise<T>;
export function createDatabaseLock(): DatabaseLock {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task, task);
    tail = result.catch(() => undefined);
    return result;
  };
}
