import { BehaviorSubject, of } from "rxjs";
import { distinctUntilObjChanged } from "./operators/distinctUntilObjChanged";
import { Store, XDB } from "./xdb";
import { switchMap, map, shareReplay, distinctUntilChanged } from "rxjs/operators";
import { getValue } from '@pestras/toolbox/object/get-value';
import { omit } from '@pestras/toolbox/object/omit';
import { gate } from "./operators/gate";

export enum SYNC_MODE {
  NONE = 0,
  /** pull data from the object store to the memory */
  PULL,
  /** pull data from the object store and merge them to the existing in the memory */
  MERGE_PULL,
  /** puSh data from the memody and merge them to the existing in the object store */
  MERGE_PUSH,
  /** push data from the memory to the object store */
  PUSH
}

export abstract class Document<T = any> {
  private _idleSub = new BehaviorSubject<boolean>(false);
  private _dataSub = new BehaviorSubject<T>(null);
  private _store: Store;
  
  readonly idle$ = this._idleSub.pipe(distinctUntilChanged(), shareReplay(1));
  private _data$ = this._dataSub.pipe(gate(this.idle$), map(doc => this.map(doc)));
  readonly data$ = this._data$.pipe(distinctUntilObjChanged(), shareReplay(1));

  constructor(readonly name?: string, xdb?: XDB, readonly publishAfterStoreSync = false) {
    if (this.name && xdb) {
      this._store = new Store(xdb, this.name);

      this._store.ready$.pipe(switchMap(() => this._store.get<T>(this.name)))
        .subscribe(data => {
          this._dataSub.next(this.map(data));
          this.onReady();
        });
    } else {
      this.onReady();
    }
  }

  protected onReady(): void { this.idle = true };

  protected get store() { return this._store; }
  get isIdle() { return this._idleSub.getValue(); }
  get linked() { return !!this._store; }

  protected set idle(val: boolean) { this._idleSub.next(val); }
  
  protected map(doc: T): T { return !!doc ? Object.assign({}, doc) : null };
  
  get(): T;
  get(keyPath: string): any;
  get(keyPath?: string) {
    let data = this._dataSub.getValue();
    return keyPath
      ? getValue(data, keyPath)
      : this.map(data);
  }

  watch(keyPaths: string[]) { return this._data$.pipe(distinctUntilObjChanged(keyPaths), shareReplay(1)); }


  protected update(data: Partial<T>, replace = false): Promise<T> {
    return new Promise((res, rej) => {
      if (!data) return res(null);
      let curr = this.get();

      if (curr && !replace) Object.assign(curr, data);
      else curr = this.map(<T>data);

      if (!this.publishAfterStoreSync || !this._store) this._dataSub.next(curr);

      if (this._store) {
        this._store.update(this.name, curr, true).subscribe(() => {
          this.publishAfterStoreSync && this._dataSub.next(curr);
          res(curr);
        }, err => rej(err));

      } else res(curr);
    });
  }

  protected remove(keyPaths: string[]): Promise<T> {
    return new Promise((res, rej) => {
      let data = this.get();
      if (!data) return res(null);

      omit(data, keyPaths);

      if (!this.publishAfterStoreSync || !this._store) this._dataSub.next(data);

      if (this._store) {
        this._store.update(this.name, data).subscribe(() => {
          this.publishAfterStoreSync && this._dataSub.next(data);
          res(data);
        }, err => rej(err));

      } else res(data);
    });
  }

  protected clear(): Promise<void> {
    return new Promise((res, rej) => {
      if (this._dataSub.getValue() === null) return res();
      if (!this.publishAfterStoreSync || !this._store) this._dataSub.next(null);

      if (this._store) {
        this._store.delete(this.name).subscribe(() => {
          this.publishAfterStoreSync && this._dataSub.next(null);
          res();
        }, err => rej(err));

      } else res();
    });
  }
}