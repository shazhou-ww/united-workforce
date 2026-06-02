import { type ReactFlowInstance, useReactFlow } from "@xyflow/react";
import type { FC, PropsWithChildren } from "react";
import { createContext, useContext, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import type { AnyWorkNode } from "./type";

type Reduce<T> = (data: T) => T;
type Setter<T> = (ch: Reduce<T> | T) => void;

interface State<T, A> {
  readonly get: () => T;
  readonly set: Setter<T>;
  readonly use: () => T;
  readonly listen: (cb: VoidFunction) => VoidFunction;
  readonly actions: A;
  readonly onlyView: boolean;
}
type Use = <T, A>(sub: SubModel<T, A>) => [T, A];
// biome-ignore lint/suspicious/noExplicitAny: UseV intentionally erases the action type
type UseV = <T>(sub: SubModel<T, any>) => T;
type Create<T, A> = (set: Setter<T>, get: () => T, model: Model) => A;

export const uuid = () => Math.round((Math.random() + 1) * Date.now()).toString(36);

export function generate<T>(val: T) {
  const listener = new Set<VoidFunction>();
  const get = () => val;
  function set(ch: T | ((prev: T) => T)) {
    const next = typeof ch === "function" ? (ch as (prev: T) => T)(val) : ch;
    if (Object.is(val, next)) return;
    val = next;
    for (const call of listener) {
      call();
    }
  }
  const listen = (call: VoidFunction) => {
    listener.add(call);
    return () => listener.delete(call);
  };
  const use = () => useSyncExternalStore(listen, get, get);
  return { get, set, use, listen };
}

class SubModel<T, A> {
  public readonly name: string;
  private readonly make: () => T;
  private readonly create: Create<T, A>;
  private readonly onlyView: boolean;

  constructor(name: string, _make: () => T, _create: Create<T, A>, _onlyView = false) {
    this.name = name;
    this.make = _make;
    this.create = _create;
    this.onlyView = _onlyView;
  }

  public gen(model: Model): State<T, A> {
    const { get, set, use, listen } = generate(this.make());
    const actions = this.create(set, get, model);
    return { get, set, use, listen, actions, onlyView: this.onlyView };
  }

  use(): [T, A] {
    // biome-ignore lint/correctness/useHookAtTopLevel: use() is called as a hook by consumers
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

// biome-ignore lint/suspicious/noExplicitAny: snapshot data is heterogeneous
type Snapshot = [name: string, data: any];
class Model {
  private ustack: Snapshot[][] = [];
  private rstack: Snapshot[][] = [];
  private transaction = 0;
  // biome-ignore lint/suspicious/noExplicitAny: backup stores heterogeneous state values
  private backup = new Map<string, any>();
  public flow = {} as ReactFlowInstance<AnyWorkNode>;
  private stackListeners = new Set<() => void>();
  public readonly stackState: readonly [boolean, boolean] = [false, false];

  // biome-ignore lint/suspicious/noExplicitAny: store holds heterogeneous state types
  private readonly store: Map<string, State<any, any>>;
  public readonly use: Use;

  // biome-ignore lint/suspicious/noExplicitAny: store holds heterogeneous state types
  constructor(store: Map<string, State<any, any>>, use: Use) {
    this.store = store;
    this.use = use;
  }

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
  };

  private triggerStackState() {
    // @ts-expect-error
    this.stackState = [this.canUndo(), this.canRedo()];
    for (const call of this.stackListeners) {
      call();
    }
  }

  private getStackState = () => this.stackState;
  public useStackState() {
    const get = this.getStackState;
    return useSyncExternalStore(this.listenStackState, get, get);
  }

  public log() {
    // biome-ignore lint/suspicious/noExplicitAny: debug log accumulates heterogeneous values
    const snapshots: Record<string, any> = {};
    for (const [name, state] of this.store) {
      snapshots[name] = state.get();
    }
  }

  public undo() {
    const { ustack, rstack, store } = this;
    const item = ustack.pop();
    if (!item) return;
    const step: Snapshot[] = [];
    for (const [name, data] of item) {
      const entry = store.get(name);
      if (!entry) continue;
      const { get, set } = entry;
      step.push([name, get()]);
      set(data);
    }
    rstack.push(step);
    this.triggerStackState();
  }

  public redo() {
    const { ustack, rstack, store } = this;
    const item = rstack.pop();
    if (!item) return;
    const step: Snapshot[] = [];
    for (const [name, data] of item) {
      const entry = store.get(name);
      if (!entry) continue;
      const { get, set } = entry;
      step.push([name, get()]);
      set(data);
    }
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
      for (const [name, state] of this.store) {
        if (state.onlyView) continue;
        this.backup.set(name, state.get());
      }
    }
    this.transaction += 1;
    return this.endTransaction;
  }

  public endTransaction = () => {
    if (this.transaction === 0) return;
    this.transaction -= 1;
    if (this.transaction === 0) {
      const changes: Snapshot[] = [];
      for (const [name, state] of this.store) {
        if (state.onlyView) continue;
        const before = this.backup.get(name);
        if (Object.is(before, state.get())) continue;
        changes.push([name, before]);
      }
      this.backup.clear();
      if (changes.length === 0) return;
      this.ustack.push(changes);
      this.rstack.length = 0;
      this.triggerStackState();
    }
  };
}

function build() {
  // biome-ignore lint/suspicious/noExplicitAny: store holds heterogeneous state types
  const store = new Map<string, State<any, any>>();

  // biome-ignore lint/suspicious/noExplicitAny: memo cache stores heterogeneous values
  const mem: Record<string, any> = {};
  function use<T, A>(m: SubModel<T, A>): [T, A] {
    const state = query(m);
    return [state.get(), state.actions];
  }

  const model = new Model(store, use);
  if (process.env.NODE_ENV === "development") {
    // @ts-expect-error
    window.__md__ = model;
  }

  function query<T, A>(m: SubModel<T, A>): State<T, A> {
    const exist = store.get(m.name);
    if (exist) return exist as State<T, A>;
    const created = m.gen(model);
    store.set(m.name, created);
    return created;
  }

  return { query, model, mem, use };
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
  }, [instance, model]);
  return null;
}

export const ModelProvider: FC<PropsWithChildren> = (p) => (
  <Context.Provider value={useMemo(build, [])}>{p.children}</Context.Provider>
);

function defineModel<T, A>(name: string, make: () => T, create: Create<T, A>) {
  return new SubModel<T, A>(name, make, create);
}

// biome-ignore lint/suspicious/noExplicitAny: default create returns setter directly
const defaultCreate: Create<any, Setter<any>> = (set) => set;
function defineView<T, A>(name: string, make: () => T, create: Create<T, A>): SubModel<T, A>;
function defineView<T>(name: string, make: () => T): SubModel<T, Setter<T>>;
function defineView<T>(
  name: string,
  make: () => T,
  create?: Create<T, unknown>,
): SubModel<T, unknown> {
  // biome-ignore lint/suspicious/noExplicitAny: wraps into SubModel with erased action type
  return new SubModel<T, any>(name, make, create ?? defaultCreate, true);
}

function memoize<T>(init: (use: Use, model: Model) => T) {
  const id = uuid();
  return {
    use(): T {
      // biome-ignore lint/correctness/useHookAtTopLevel: use() is called as a hook by consumers
      const { mem, model, use } = useContext(Context);
      if (!mem[id]) {
        mem[id] = init(use, model);
      }
      return mem[id] as T;
    },
  };
}

function compute<T>(calc: (use: UseV) => T) {
  const id = uuid();
  return {
    use(): T {
      // biome-ignore lint/correctness/useHookAtTopLevel: use() is called as a hook by consumers
      const { mem, query } = useContext(Context);
      let state: ReturnType<typeof generate<T>> = mem[id];
      if (state) return state.use();

      // biome-ignore lint/suspicious/noExplicitAny: deps collect heterogeneous SubModels
      const deps = new Set<SubModel<any, any>>();
      // biome-ignore lint/suspicious/noExplicitAny: useV erases action type
      let usev = (m: SubModel<any, any>) => {
        deps.add(m);
        return query(m).get();
      };
      mem[id] = state = generate<T>(calc(usev));
      if (deps.size) {
        usev = (m) => query(m).get();
        const update = () => state.set(calc(usev));
        for (const m of deps) {
          query(m).listen(update);
        }
      }
      return state.use();
    },
  };
}

export const define = {
  model: defineModel,
  view: defineView,
  memoize,
  compute,
};
