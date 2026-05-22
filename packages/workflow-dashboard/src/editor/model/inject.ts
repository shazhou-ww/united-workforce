/**
 * 外部注入的回调函数，存到这里以方便内部调用，避免透传
 */

import { define } from "../context.tsx";
import { Injection } from '../injection.ts';


const NOOP = () => {};
const placeholder = new Injection(NOOP);

function make(): Injection {
  return placeholder;
}

export const injection = define.view('injection', make, (set) => {
  function reset() {
    set(make());
  }

  function inject(instance: Injection) {
    set(instance);
    return reset;
  }

  return inject;
});
