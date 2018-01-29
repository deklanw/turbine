import {
  Behavior,
  sinkBehavior,
  isBehavior,
  Stream,
  Now,
  streamFromEvent,
  behaviorFromEvent,
  Future
} from "@funkia/hareactive";
import {
  Component,
  runComponent,
  viewObserve,
  Showable,
  Child,
  isChild,
  toComponent
} from "./component";
import { id, mergeDeep, assign, copyRemaps } from "./utils";

export type EventName = keyof HTMLElementEventMap;

export type Cp<A> = Component<A>;
export type Ch<A> = Child<A>;

export type StreamDescription<A> = [EventName, (evt: any) => A, A];

export function streamDescription<A, N extends EventName>(
  eventName: N,
  f: (evt: HTMLElementEventMap[N]) => A
): StreamDescription<A> {
  return <any>[eventName, f]; // The third value don't exist it's for type info only
}

export type StreamDescriptions = {
  [name: string]: StreamDescription<any>;
};

export type OutputStream<T extends StreamDescriptions> = {
  [K in keyof T]: Stream<T[K][2]>
};

export type BehaviorDescription<A> = [
  EventName,
  (evt: any) => A,
  (elm: HTMLElement) => A,
  A
];

export function behaviorDescription<A, N extends EventName>(
  eventName: N,
  f: (evt: HTMLElementEventMap[N]) => A,
  init: (elm: HTMLElement) => A
): BehaviorDescription<A> {
  return <any>[eventName, f, init]; // The fourth value don't exist it's for type info only
}

export type BehaviorDescriptions = {
  [name: string]: BehaviorDescription<any>;
};

export type BehaviorOutput<T extends BehaviorDescriptions> = {
  [K in keyof T]: Behavior<T[K][3]>
};

export type ActionDefinitions = {
  [name: string]: (element: HTMLElement, value: any) => void;
};

export type Actions = {
  [name: string]: Stream<any>;
};

export type Setters = {
  [name: string]: Behavior<any>;
};

export type Style = {
  [N in keyof CSSStyleDeclaration]?:
    | Behavior<CSSStyleDeclaration[N]>
    | CSSStyleDeclaration[N]
};

export type ClassNames = Behavior<string> | string;

export type ClassToggles = {
  [name: string]: boolean | Behavior<boolean>;
};

export type ClassDescription =
  | ClassNames
  | ClassToggles
  | ClassDescriptionArray;

export interface ClassDescriptionArray extends Array<ClassDescription> {}

export type InitialProperties = {
  streams?: StreamDescriptions;
  behaviors?: BehaviorDescriptions;
  style?: Style;
  props?: {
    [name: string]: Showable | Behavior<Showable | boolean>;
  };
  attrs?: {
    [name: string]: (Showable | boolean) | Behavior<Showable | boolean>;
  };
  actionDefinitions?: ActionDefinitions;
  actions?: Actions;
  setters?: { [name: string]: Behavior<any> };
  class?: ClassDescription;
  entry?: { class?: string };
};

export type DefaultOutput = {
  [E in EventName]: Stream<HTMLElementEventMap[E]>
};

export type InitialOutput<P extends InitialProperties> = OutputStream<
  (P & { streams: StreamDescriptions })["streams"]
> &
  BehaviorOutput<(P & { behaviors: BehaviorDescriptions })["behaviors"]> &
  DefaultOutput;

// An array of names of all DOM events
export const allDomEvents: EventName[] = <any>Object.getOwnPropertyNames(
  Object.getPrototypeOf(Object.getPrototypeOf(document))
)
  .filter((i) => i.indexOf("on") === 0)
  .map((name) => name.slice(2));

// Output streams that _all_ elements share
const defaultStreams: StreamDescriptions = {};

for (const name of allDomEvents) {
  defaultStreams[name] = streamDescription(name, id);
}

const defaultProperties = {
  streams: defaultStreams
};

const attributeSetter = (element: HTMLElement) => (
  key: string,
  value: Showable | boolean
) => {
  if (value === true) {
    element.setAttribute(key, "");
  } else if (value === false) {
    element.removeAttribute(key);
  } else {
    element.setAttribute(key, value.toString());
  }
};

const propertySetter = (element: HTMLElement) => (
  key: string,
  value: Showable | boolean
) => ((<any>element)[key] = value);

const classSetter = (element: HTMLElement) => (key: string, value: boolean) =>
  element.classList.toggle(key, value);

const styleSetter = (element: HTMLElement) => (key: string, value: string) =>
  (element.style[<any>key] = value);

function handleObject<A>(
  object: { [key: string]: A | Behavior<A> } | undefined,
  element: HTMLElement,
  createSetter: (element: HTMLElement) => (key: string, value: A) => void
): void {
  if (object !== undefined) {
    const setter = createSetter(element);
    for (const key of Object.keys(object)) {
      const value = object[key];
      if (isBehavior(value)) {
        viewObserve((newValue) => setter(key, newValue), value);
      } else {
        setter(key, value);
      }
    }
  }
}

function handleCustom(
  elm: HTMLElement,
  isStreamActions: boolean,
  actionDefinitions: ActionDefinitions,
  actions: Actions | Setters | undefined
): void {
  if (actions !== undefined) {
    for (const name of Object.keys(actions)) {
      const actionTrigger = actions[name];
      const actionDefinition = actionDefinitions[name];
      if (isStreamActions) {
        actionTrigger.subscribe((value) => actionDefinition(elm, value));
      } else {
        viewObserve(
          (value) => actionDefinition(elm, value),
          <any>actionTrigger
        );
      }
    }
  }
}

function handleClass(
  desc: ClassDescription | ClassDescription[],
  elm: HTMLElement
): void {
  if (isBehavior(desc)) {
    let previousClasses: string[];
    viewObserve((value) => {
      if (previousClasses !== undefined) {
        elm.classList.remove(...previousClasses);
      }
      previousClasses = value.split(" ");
      elm.classList.add(...previousClasses);
    }, desc);
  } else if (Array.isArray(desc)) {
    for (const d of desc) {
      handleClass(d, elm);
    }
  } else if (typeof desc === "string") {
    const classes = desc.split(" ");
    elm.classList.add(...classes);
  } else {
    handleObject(desc, elm, classSetter);
  }
}

function handleEntryClass(desc: string, elm: HTMLElement): void {
  const classes = desc.split(" ");
  elm.classList.add(...classes);
  // Wait two frames so that we get one frame with the class
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      elm.classList.remove(...classes);
    });
  });
}

class DomComponent<A> extends Component<A> {
  child: Component<any> | undefined;
  constructor(
    private tagName: string,
    private props: Properties<A> & { output?: OutputNames<A> },
    child?: Child
  ) {
    super();
    if (props.output !== undefined) {
      this.explicitOutput = Object.keys(props.output);
    }
    if (child !== undefined) {
      this.child = toComponent(child);
      if (this.child.explicitOutput !== undefined) {
        if (this.explicitOutput === undefined) {
          this.explicitOutput = this.child.explicitOutput;
        } else {
          this.explicitOutput = this.explicitOutput.concat(
            this.child.explicitOutput
          );
        }
      }
    }
  }
  run(parent: Node, destroyed: Future<boolean>): A {
    let output: any = {};
    const elm = document.createElement(this.tagName);

    handleObject(<any>this.props.style, elm, styleSetter);
    handleObject(this.props.attrs, elm, attributeSetter);
    handleObject(this.props.props, elm, propertySetter);
    if (this.props.class !== undefined) {
      handleClass(this.props.class, elm);
    }
    if (this.props.entry) {
      if (this.props.entry.class !== undefined) {
        handleEntryClass(this.props.entry.class, elm);
      }
    }
    if (this.props.actionDefinitions !== undefined) {
      handleCustom(elm, true, this.props.actionDefinitions, this.props.actions);
      handleCustom(
        elm,
        false,
        this.props.actionDefinitions,
        this.props.setters
      );
    }
    if (this.props.behaviors !== undefined) {
      for (const name of Object.keys(this.props.behaviors)) {
        const [evt, extractor, initialFn] = this.props.behaviors[name];
        let a: Behavior<any> | undefined = undefined;
        const initial = initialFn(elm);
        Object.defineProperty(output, name, {
          enumerable: true,
          get: (): Behavior<any> => {
            if (a === undefined) {
              a = behaviorFromEvent(elm, evt, initial, extractor);
            }
            return a;
          }
        });
      }
    }
    if (this.props.streams !== undefined) {
      for (const name of Object.keys(this.props.streams)) {
        const [evt, extractor] = this.props.streams[name];
        let a: Stream<any> | undefined = undefined;
        if (output[name] === undefined) {
          Object.defineProperty(output, name, {
            enumerable: true,
            get: (): Stream<any> => {
              if (a === undefined) {
                a = streamFromEvent(elm, evt, extractor);
              }
              return a;
            }
          });
        }
      }
    }
    parent.appendChild(elm);
    if (this.props.output !== undefined) {
      output = copyRemaps(this.props.output, output);
    }
    if (this.child !== undefined) {
      const childOutput = runComponent(elm, this.child, destroyed.mapTo(false));
      if (this.child.explicitOutput !== undefined) {
        for (const prop of this.child.explicitOutput) {
          output[prop] = childOutput[prop];
        }
      }
      // assign(output, childOutput);
    }
    destroyed.subscribe((toplevel) => {
      if (toplevel) {
        parent.removeChild(elm);
      }
      // TODO: cleanup listeners
    });
    return output;
  }
}

function parseCSSTagname(cssTagName: string): [string, InitialProperties] {
  const parsedTag = cssTagName.split(/(?=\.)|(?=#)|(?=\[)/);
  const result: InitialProperties = {};
  for (let i = 1; i < parsedTag.length; i++) {
    const token = parsedTag[i];
    switch (token[0]) {
      case "#":
        result.props = result.props || {};
        result.props.id = token.slice(1);
        break;
      case ".":
        result.class = result.class || {};
        (result.class as any)[token.slice(1)] = true;
        break;
      case "[":
        result.attrs = result.attrs || {};
        const attr = token.slice(1, -1).split("=");
        result.attrs[attr[0]] = attr[1] || "";
        break;
      default:
        throw new Error("Unknown symbol");
    }
  }
  return [parsedTag[0], result];
}

export type OutputNames<A> = {
  [name: string]: keyof A;
};

export type Properties<A> = InitialProperties;

export type PropsOutput<A, O extends OutputNames<A>> = {
  output?: O;
} & InitialProperties;

export type OutputRenamed<A, B extends OutputNames<A>> = {
  [N in keyof B]: A[B[N]]
} &
  A;

export type ChArr1<A> = [Ch<A>];
export type ChArr2<A, B> = [Ch<A>, Ch<B>];
export type ChArr3<A, B, C> = [Ch<A>, Ch<B>, Ch<C>];
export type ChArr4<A, B, C, D> = [Ch<A>, Ch<B>, Ch<C>, Ch<D>];
export type ChArr5<A, B, C, D, E> = [Ch<A>, Ch<B>, Ch<C>, Ch<D>, Ch<E>];
export type ChArr6<A, B, C, D, E, F> = [
  Ch<A>,
  Ch<B>,
  Ch<C>,
  Ch<D>,
  Ch<E>,
  Ch<F>
];
export type ChArr7<A, B, C, D, E, F, G> = [
  Ch<A>,
  Ch<B>,
  Ch<C>,
  Ch<D>,
  Ch<E>,
  Ch<F>,
  Ch<G>
];
export type ChArr8<A, B, C, D, E, F, G, H> = [
  Ch<A>,
  Ch<B>,
  Ch<C>,
  Ch<D>,
  Ch<E>,
  Ch<F>,
  Ch<G>,
  Ch<H>
];
export type ChArr9<A, B, C, D, E, F, G, H, I> = [
  Ch<A>,
  Ch<B>,
  Ch<C>,
  Ch<D>,
  Ch<E>,
  Ch<F>,
  Ch<G>,
  Ch<H>,
  Ch<I>
];

export type Generator = IterableIterator<any>;
// `A` is the parents output
export type ElementCreator<A> = {
  (): Cp<A>;
  // We cannot know what a generator function outputs
  (generator: Generator): Cp<any>;
  <O extends OutputNames<A> = {}>(
    props: PropsOutput<A, O>,
    generator: Generator
  ): Cp<any>;
  // Properties are given
  <B, O extends OutputNames<A> = {}>(
    props: PropsOutput<A, O>,
    child?: ChArr1<B>
  ): Cp<B & OutputRenamed<A, O>>;
  <B, C, O extends OutputNames<A> = {}>(
    props: PropsOutput<A, O>,
    child?: ChArr2<B, C>
  ): Cp<B & C & OutputRenamed<A, O>>;
  <B, C, D, O extends OutputNames<A> = {}>(
    props: PropsOutput<A, O>,
    child?: ChArr3<B, C, D>
  ): Cp<B & C & D & OutputRenamed<A, O>>;
  <B, C, D, E, O extends OutputNames<A> = {}>(
    props: PropsOutput<A, O>,
    child?: ChArr4<B, C, D, E>
  ): Cp<B & C & D & E & OutputRenamed<A, O>>;
  <B, C, D, E, F, O extends OutputNames<A> = {}>(
    props: PropsOutput<A, O>,
    child?: ChArr5<B, C, D, E, F>
  ): Cp<B & C & D & E & F & OutputRenamed<A, O>>;
  <B, C, D, E, F, G, O extends OutputNames<A> = {}>(
    props: PropsOutput<A, O>,
    child?: ChArr6<B, C, D, E, F, G>
  ): Cp<B & C & D & E & F & G & OutputRenamed<A, O>>;
  <O extends OutputNames<A>, B>(props: PropsOutput<A, O>, child?: Ch<B>): Cp<
    B & OutputRenamed<A, O>
  >;
  <B>(props: Properties<A>, child: Child<B>): Cp<B>;
  // Properties aren't given
  <B, C>(child: ChArr2<B, C>): Cp<A & B & C>;
  <B, C, D>(child: ChArr3<B, C, D>): Cp<A & B & C & D>;
  <B, C, D, E>(child: ChArr4<B, C, D, E>): Cp<A & B & C & D & E>;
  <B, C, D, E, F>(child: ChArr5<B, C, D, E, F>): Cp<A & B & C & D & E & F>;
  <B, C, D, E, F, G>(child: ChArr6<B, C, D, E, F, G>): Cp<
    A & B & C & D & E & F & G
  >;
  <B, C, D, E, F, G, H>(child: ChArr7<B, C, D, E, F, G, H>): Cp<
    A & B & C & D & E & F & G & H
  >;
  <B, C, D, E, F, G, H, I>(child: ChArr8<B, C, D, E, F, G, H, I>): Cp<
    A & B & C & D & E & F & G & H & I
  >;
  <B, C, D, E, F, G, H, I, J>(child: ChArr9<B, C, D, E, F, G, H, I, J>): Cp<
    A & B & C & D & E & F & G & H & I & J
  >;
  <B>(child: Ch<B>): Cp<A & B>;
  (props: Properties<A>): Cp<A>;
};

export function element<P extends InitialProperties>(
  tagName: string,
  props?: P
): ElementCreator<InitialOutput<P>> {
  const [parsedTagName, tagProps] = parseCSSTagname(tagName);
  const mergedProps: P = mergeDeep(
    props,
    mergeDeep(defaultProperties, tagProps)
  );
  function createElement(
    newPropsOrChildren?: InitialProperties | Child,
    newChildrenOrUndefined?: Child
  ): Component<InitialOutput<P>> {
    if (newChildrenOrUndefined === undefined && isChild(newPropsOrChildren)) {
      return new DomComponent<InitialOutput<P>>(
        parsedTagName,
        mergedProps,
        newPropsOrChildren
      );
    } else {
      const newProps = mergeDeep(mergedProps, newPropsOrChildren);
      return new DomComponent<InitialOutput<P>>(
        parsedTagName,
        newProps,
        newChildrenOrUndefined
      );
    }
  }
  return createElement as any;
}
