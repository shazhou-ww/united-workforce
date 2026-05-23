type Maper<T> = {
  [key: string]: T;
};
type Listen<T> = (data: T) => void;

// biome-ignore lint/suspicious/noExplicitAny: generic event map requires any
export class Eventer<M extends Maper<any>> {
  // biome-ignore lint/complexity/noBannedTypes: Set<Function> needed for heterogeneous listener types
  private lisenters = {} as { [K in keyof M]: Set<Function> };

  public on<K extends keyof M>(key: K, lisenter: Listen<M[K]>) {
    let set = this.lisenters[key];
    if (set === undefined) {
      set = new Set();
      this.lisenters[key] = set;
    }

    set.add(lisenter);
    return () => this.off(key, lisenter);
  }

  public off<K extends keyof M>(key: K, lisenter?: Listen<M[K]>) {
    const set = this.lisenters[key];
    if (set === undefined) return;
    if (lisenter === undefined) set.clear();
    else set.delete(lisenter);
  }

  public emit<K extends keyof M>(key: K, data: M[K]) {
    const set = this.lisenters[key];
    if (set === undefined) return;
    // Todo: maybe implement stoping bubble
    for (const call of set) {
      call(data);
    }
  }
}
