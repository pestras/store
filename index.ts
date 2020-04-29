import { Observable, BehaviorSubject } from 'rxjs';
import { Unique } from 'tools-box/unique';

interface Selector<T> {
  id: string;
  keys: (keyof T)[];
  bs: BehaviorSubject<T>;
  o: Observable<T>;
}

export class Store<T> {
  private dataBS = new BehaviorSubject<T>(null);
  private selectors: Selector<T>[] = [];

  readonly data$ = this.dataBS.asObservable();

  constructor(data?: T) {
    if (data) this.dataBS.next(data);
  }

  private updateSelectors(keys: (keyof T)[], force = false) {
    let data = this.get();
    for (let selector of this.selectors) {
      if (force)
        selector.bs.next(data);
      else
        for (let key of selector.keys)
          if (keys.indexOf(key) > -1) {
            selector.bs.next(data);
            break;
          }
    }
  }

  get data() {
    return this.dataBS.getValue();
  }

  get(): T;
  get<U extends keyof T>(key: U): T[U];
  get<U extends keyof T>(key?: U) {
    let data = this.dataBS.getValue();
    if (!key)
      return data;
    else
      return data ? data[key] : null;
  }

  watch(keys: (keyof T)[]) {
    let id = Unique.Get();
    let bs = new BehaviorSubject<T>(this.get());
    let o = bs.asObservable();

    this.selectors.push({ id, bs, o, keys });
    return o;
  }

  protected set(data: Partial<T>): Store<T>;
  protected set<U extends keyof T>(key: U, value: T[U], upsert?: boolean): Store<T>;
  protected set<U extends keyof T>(key: T | U, value?: T[U], upsert = false) {
    let data = this.get();

    if (typeof key === "string") {
      if (!data) {
        if (!upsert) return this;
        data = <any>{ [key]: value };
      } else {
        data[<U>key] = value;
      }

      this.dataBS.next(data);
      this.updateSelectors([<U>key]);
    } else {
      this.dataBS.next(<T>key);
      this.updateSelectors(!!key ? <U[]>Object.keys(<T>key) : [], !key);
    }

    return this;
  }

  protected update(data: Partial<T>) {
    let curr = this.get();
    Object.assign(curr, data);
    this.dataBS.next(curr);
    this.updateSelectors(<any>Object.keys(data));
    return this;
  }

  protected remove(key: keyof T) {
    let data = this.get();
    if (!data) return this;
    delete data[key];
    this.dataBS.next(data);
    this.updateSelectors([key], true);
    return this;
  }

  protected clear() {
    if (this.data === null) return this;
    this.dataBS.next(null);
    this.updateSelectors([], true);
    return this;
  }
}