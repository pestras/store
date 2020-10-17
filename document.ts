import { BehaviorSubject, of } from "rxjs";
import { distinctUntilObjChanged } from "./operators/distinctUntilObjChanged";
import { Store, XDB } from "./xdb";
import { switchMap, map, shareReplay } from "rxjs/operators";
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

export class Document<T = any> {
  private _idleSub = new BehaviorSubject<boolean>(false);
  private _dataSub = new BehaviorSubject<T>(null);
  private _store: Store;

  readonly idle$ = this._idleSub.pipe(shareReplay(1));
  readonly data$ = this._dataSub.pipe(gate(this.idle$), distinctUntilObjChanged(), shareReplay(1));

  constructor(xdb?: XDB, readonly publishAfterStoreSync = false) {
    if (xdb) {
      this._store = new Store(xdb, this.constructor.name);

      this._store.ready$.pipe(switchMap(() => this._store.get<T>(this.storeKey)))
        .subscribe(data => {
          if (typeof this.storeMap === "function") this._dataSub.next(this.storeMap(data));
          else this._dataSub.next(data);
          this.onReady();
        });
    } else this.onReady();
  }

  onReady(): void { this.idle = true };

  protected get store() { return this._store; }
  get isIdle() { return this._idleSub.getValue(); }
  get storeKey() { return this.constructor.name; }
  get linked() { return !!this._store; }

  protected set idle(val: boolean) { this._idleSub.next(val); }

  get(): T;
  get(keyPath: string): any;
  get(keyPath?: string) {
    let data = this._dataSub.getValue();
    return keyPath ? getValue(data, keyPath) : data;
  }

  watch(keyPaths: string[]) { return this._dataSub.pipe( gate(this.idle$), distinctUntilObjChanged(keyPaths), shareReplay(1)); }

  protected storeMap?(doc: T): T;

  protected update(data: Partial<T>, replace = false): Promise<T> {
    return new Promise((res, rej) => {
      if (!data) return res();
      let curr = this._dataSub.getValue();

      if (curr && !replace) Object.assign(curr, data);
      else curr = <T>data;

      if (!this.publishAfterStoreSync || !this._store) this._dataSub.next(curr);

      if (this._store) {
        this._store.update(this.storeKey, curr, true).subscribe(() => {
          this.publishAfterStoreSync && this._dataSub.next(curr);
          res(curr);
        }, err => rej(err));

      } else res(curr);
    });
  }

  protected remove(keyPaths: string[]): Promise<T> {
    return new Promise((res, rej) => {
      let data = this._dataSub.getValue();
      if (!data) return res();

      omit(data, keyPaths);

      if (!this.publishAfterStoreSync || !this._store) this._dataSub.next(data);

      if (this._store) {
        this._store.update(this.storeKey, data).subscribe(() => {
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
        this._store.delete(this.storeKey).subscribe(() => {
          this.publishAfterStoreSync && this._dataSub.next(null);
          res();
        }, err => rej(err));
        
      } else res();
    });
  }
}