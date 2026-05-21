import { createContext, useMemo, useSyncExternalStore, useContext, useLayoutEffect } from 'react';
import type { FC, PropsWithChildren } from 'react';
import { useReactFlow, ReactFlowInstance } from '@xyflow/react';
import type { AnyWorkNode } from './type';

type Reduce<T> = (data: T) => T;
type Setter<T> = (ch: Reduce<T> | T) => void;

interface State<T, A>  {
  readonly get: () => T;
  readonly set: Setter<T>;
  readonly use: () => T;
  readonly listen: (cb: VoidFunction) => VoidFunction;
  readonly actions: A;
  readonly onlyView: boolean;
}
type Use = <T, A>(sub: SubModel<T, A>) => [T, A];
type UseV = <T>(sub: SubModel<T, any>) => T;
type Create<T, A> = (set: Setter<T>, get: () => T, model: Model) => A;

export const uuid = () => Math.round((Math.random() + 1) * Date.now()).toString(36);

export function generate<T>(val: T) {
  const listener = new Set<VoidFunction>();
  const get = () => val;
  function set(ch: T | ((prev: T) => T)) {
    const next = (typeof ch === 'function') ? (ch as (prev: T) => T)(val) : ch;
    if (Object.is(val, next)) return;
    val = next;
    listener.forEach(call => call());
  }
  const listen = (call: VoidFunction) => {
    listener.add(call);
    return () => listener.delete(call);
  };
  const use = () => useSyncExternalStore(listen, get, get);
  return { get, set, use, listen };
}

class SubModel<T, A> {
  constructor(
    public readonly name: string,
    private make: () => T,
    private create: Create<T, A>,
    private onlyView = false,
  ) {}

  public gen(model: Model): State<T, A> {
    const { make, create, onlyView } = this;
    const { get, set, use, listen } = generate(make());
    const actions = create(set, get, model);
    return { get, set, use, listen, actions, onlyView };
  }

  use(): [T, A] {
    const { query } = useContext(Context);
    const { use, actions } = query(this);
    return [use(), actions];
  }
  useData(): T {
    const { query } = useContext(Context);
    return query(this).use();
  }
  useCreation(): A {
    const { query } = useContext(Context);
    return query(this).actions;
  }
}

type Snapshot = [name: string, data: any];
class Model {
  private ustack: Snapshot[][] = [];
  private rstack: Snapshot[][] = [];
  private transaction = 0;
  private backup = new Map<string, any>();
  public flow = {} as ReactFlowInstance<AnyWorkNode>;
  private stackListeners = new Set<() => void>();
  public readonly stackState: readonly [boolean, boolean] = [false, false];

  constructor(
    private readonly store: Map<string, State<any, any>>,
    public readonly use: Use,
  ) {}

  public reset() {
    this.ustack = [];
    this.rstack = [];
    this.transaction = 0;
    this.backup.clear();
    this.triggerStackState();
  }

  public readonly listenStackState = (cb: () => void) => {
    this.stackListeners.add(cb);
    return () => this.stackListeners.delete(cb);
  }

  private triggerStackState() {
    // @ts-expect-error
    this.stackState = [this.canUndo(), this.canRedo()];
    this.stackListeners.forEach(call => call());
  }

  private getStackState = () => this.stackState;
  public useStackState() {
    const get = this.getStackState;
    return useSyncExternalStore(this.listenStackState, get, get);
  }

  public log() {
    console.log('undo stack:', this.ustack);
    console.log('redo stack:', this.rstack);
    const snapshots: Record<string, any> = {};
    this.store.forEach((state, name) => {
      snapshots[name] = state.get();
    });
    console.log('current state:', snapshots);
  }

  public undo() {
    const { ustack, rstack, store } = this;
    const item = ustack.pop();
    if (!item) return;
    const step: Snapshot[] = [];
    item.forEach(([name, data]) => {
      const { get, set } = store.get(name)!;
      step.push([name, get()]);
      set(data);
    });
    rstack.push(step);
    this.triggerStackState();
  }

  public redo() {
    const { ustack, rstack, store } = this;
    const item = rstack.pop();
    if (!item) return;
    const step: Snapshot[] = [];
    item.forEach(([name, data]) => {
      const { get, set } = store.get(name)!;
      step.push([name, get()]);
      set(data);
    });
    ustack.push(step);
    this.triggerStackState();
  }

  public canUndo() {
    return this.ustack.length > 0;
  }

  public canRedo() {
    return this.rstack.length > 0;
  }

  public startTransaction() {
    if (this.transaction === 0) {
      this.backup.clear();
      this.store.forEach((state, name) => {
        if (state.onlyView) return;
        this.backup.set(name, state.get());
      });
    }
    this.transaction += 1;
    return this.endTransaction;
  }

  public endTransaction = () => {
    if (this.transaction === 0) return;
    this.transaction -= 1;
    if (this.transaction === 0) {
      const changes: Snapshot[] = [];
      this.store.forEach((state, name) => {
        if (state.onlyView) return;
        const before = this.backup.get(name);
        if (Object.is(before, state.get())) return;
        changes.push([name, before]);
      });
      this.backup.clear();
      if (changes.length === 0) return;
      this.ustack.push(changes);
      this.rstack.length = 0;
      this.triggerStackState();
    }
  }
}

function build() {
  const store = new Map<string, State<any, any>>();

  const mem: Record<string, any> = {};
  function use<T, A>(m: SubModel<T, A>): [T, A] {
    const state = query(m);
    return [state.get(), state.actions];
  }

  const model = new Model(store, use);
  if (process.env.NODE_ENV === 'development') {
    // @ts-ignore
    window.__md__ = model;
  }

  function query<T, A>(m: SubModel<T, A>): State<T, A> {
    const exist = store.get(m.name);
    if (exist) return exist as State<T, A>;
    const created = m.gen(model);
    store.set(m.name, created);
    return created;
  };

  return { query, model, mem, use }
}

const Context = createContext(build());

export function useModel() {
  return useContext(Context).model;
}

export function RegisterFlowToContext() {
  const { model } = useContext(Context);
  const instance = useReactFlow<AnyWorkNode>();
  useLayoutEffect(() => {
    model.flow = instance;
  }, [instance]);
  return null;
}

export const ModelProvider: FC<PropsWithChildren> = (p) => (
  <Context.Provider value={useMemo(build, [])}>
    {p.children}
  </Context.Provider>
);

function defineModel<T, A>(name: string, make: () => T, create: Create<T, A>) {
  return new SubModel<T, A>(name, make, create);
}

const defaultCreate: Create<any, Setter<any>> = (set) => set;
function defineView<T, A>(name: string, make: () => T, create: Create<T, A>): SubModel<T, A>
function defineView<T>(name: string, make: () => T): SubModel<T, Setter<T>>
function defineView<T>(name: string, make: () => T, create?: any): any {
  return new SubModel<T, any>(name, make, create ?? defaultCreate, true);
}

function memoize<T>(init: (use: Use, model: Model) => T) {
  const id = uuid();
  return {
    use(): T {
      const { mem, model, use } = useContext(Context);
      const fn = mem[id] || (mem[id] = init(use, model));
      return fn as T;
    },
  };
}

function compute<T>(calc: (use: UseV) => T) {
  const id = uuid();
  return {
    use(): T {
      const { mem, query } = useContext(Context);
      let state: ReturnType<typeof generate<T>> = mem[id];
      if (state) return state.use();

      const deps = new Set<SubModel<any, any>>();
      let usev = (m: SubModel<any, any>) => (deps.add(m), query(m).get());
      mem[id] = state = generate<T>(calc(usev));
      if (deps.size) {
        usev = m => query(m).get();
        const update = () => state.set(calc(usev));
        deps.forEach(m => query(m).listen(update));
      }
      return state.use();
    },
  }
}

export const define = {
  model: defineModel,
  view: defineView,
  memoize,
  compute,
};
