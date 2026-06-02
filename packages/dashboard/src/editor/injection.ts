import type { WorkFlowSteps } from "./trans";
import { Eventer } from "./utils/eventer";

interface PublicEvents {
  save: WorkFlowSteps;
}

interface PrivateEvents {
  load: WorkFlowSteps;
}

export const InternalField = Symbol("InternalField");

export class Injection extends Eventer<PrivateEvents> {
  public readonly emitPublic: Eventer<PublicEvents>["emit"];
  private inital_steps: WorkFlowSteps | undefined;

  constructor(emitPublic: Eventer<PublicEvents>["emit"], inital_steps?: WorkFlowSteps) {
    super();
    this.emitPublic = emitPublic;
    this.inital_steps = inital_steps;
  }

  public on: Eventer<PrivateEvents>["on"] = (type, lisenter) => {
    const off = super.on(type, lisenter);
    if (type === "load" && this.inital_steps) {
      lisenter(this.inital_steps);
      this.inital_steps = undefined;
    }
    return off;
  };
}

export class FlowModel {
  private readonly eventer = new Eventer<PublicEvents>();
  public on = this.eventer.on.bind(this.eventer);
  public off = this.eventer.off.bind(this.eventer);

  public readonly [InternalField]: Injection;

  constructor(inital_steps?: WorkFlowSteps) {
    this[InternalField] = new Injection(this.eventer.emit.bind(this.eventer), inital_steps);
  }

  public load(steps: WorkFlowSteps) {
    this[InternalField].emit("load", steps);
  }
}
