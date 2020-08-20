import { BehaviorSubject, of } from "rxjs";
import { distinctUntilObjChanged } from "./operators/distinctUntilObjChanged";
import { Store } from "./xdb";
import { filter, switchMap, map, tap } from "rxjs/operators";
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
  private _uStore: Store;
  private _store: Store;


  readonly idle$ = this._idleSub.asObservable();
  readonly data$ = this._dataSub.pipe(gate(this.idle$));

  constructor(store?: Store, readonly publishAfterStoreSync = false) {
    if (store) {
      this._store = store;

      this._store.ready$.pipe(switchMap(() => this._store.get<T>(this.storeKey)))
        .subscribe(data => {
          if (typeof this.storeMap === "function") this._dataSub.next(this.storeMap(data));
          else this._dataSub.next(data)
        });
    };
  }

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

  watch(keyPaths: string[] = []) { return this._dataSub.pipe(distinctUntilObjChanged(keyPaths)); }

  protected storeMap?(doc: T): T;

  protected update(data: Partial<T>): Promise<T> {
    return new Promise((res, rej) => {
      if (!data) return res();
      let curr = this._dataSub.getValue();

      if (curr) Object.assign(curr, data);
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

  protected clear(cb?: () => void): Promise<void> {
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

  protected sync(mode = SYNC_MODE.PULL) {
    if (!this._store || !mode) return of(null);

    if (mode === SYNC_MODE.PULL) return this._store.get<T>(this.storeKey).pipe(map(data => {
      if (typeof this.storeMap === "function") this._dataSub.next(this.storeMap(data));
      else this._dataSub.next(data);
    }));
    if (mode === SYNC_MODE.MERGE_PULL) return this._store.get<T>(this.storeKey).pipe(map(data => {
      if (typeof this.storeMap === "function") {
        let curr = this.get();
        if (curr) Object.assign(curr, data);
        else curr = <T>data;
        this._dataSub.next(Object.assign(curr, this.storeMap(data)))
      }
      else this._dataSub.next(Object.assign(this.get() || {}, data))
    }));
    if (mode === SYNC_MODE.MERGE_PUSH) return this._store.get<T>(this.storeKey).pipe(switchMap(data => this._store.update(this.storeKey, Object.assign(this.get() || {}, data || <any>{}))));
    return this._store.update(this.storeKey, this.get());
  }

  protected link(store?: Store, mode = SYNC_MODE.PULL) {
    if (this._store) return;
    if (!store) this._store = this._uStore || null;
    else this._store = store;

    this._uStore = null;
    return mode !== SYNC_MODE.NONE && !!this._store ? this.sync(mode) : of(null);
  }

  protected unlink(clearDoc = true) {
    this._uStore = this._store;
    this._store = null;
    !!clearDoc && this.clear();
    return this;
  }
}