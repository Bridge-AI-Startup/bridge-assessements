export function createKeyedAsyncLock() {
  const pendingByKey = new Map<string, Promise<unknown>>();

  return async function withKeyLock<T>(
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = pendingByKey.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = previous.then(() => gate);
    pendingByKey.set(key, pending);

    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (pendingByKey.get(key) === pending) {
        pendingByKey.delete(key);
      }
    }
  };
}
