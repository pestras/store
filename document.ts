import { BehaviorSubject, empty } from "rxjs";
import { distinctUntilObjChanged } from "./operators/distinctUntilObjChanged";
import { Store } from "./xdb";
import { filter, take, switchMap, map, tap } from "rxjs/operators";

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
  private _dataSub = new BehaviorSubject<T>(null);
  private _readySub = new BehaviorSubject<boolean>(false);
  private _uStore: Store;
  private _store: Store;

  readonly data$ = this._dataSub.asObservable();
  readonly ready$ = this._readySub.pipe(filter(synced => synced), take(1));

  constructor(store?: Store) {
    if (store) {
      this._store = store;

      this._store.ready$.pipe(switchMap(() => this._store.get<T>(this.storeKey)))
        .subscribe(data => {
          this._dataSub.next(data);
          this._readySub.next(true);
        });

    } else this._readySub.next(true);
  }

  get ready() { return this._readySub.getValue(); }
  get storeKey() { return this.constructor.name; }

  get(): T;
  get<U extends keyof T>(key: U): T[U];
  get<U extends keyof T>(key?: U) {
    let data = this._dataSub.getValue();
    return key ? data[key] || null : data;
  }

  watch(keys: string[] = []) { return this._dataSub.pipe(distinctUntilObjChanged(keys)); }

  protected update(data: Partial<T>, cb?: (data?: T) => void): Document<T> {
    if (!data) return this;
    let curr = this._dataSub.getValue();
    let isNew = !curr;
    Object.assign(curr || {}, data);
    this._dataSub.next(curr);
    if (this._store) this._store.update(this.storeKey, curr).subscribe(() => cb && cb(curr));
    return this;
  }

  protected remove(key: keyof T, cb?: (data?: T) => void): Document<T> {
    let data = this._dataSub.getValue();
    if (!data) return this;
    delete data[key];
    this._dataSub.next(data);
    if (this._store) this._store.update(this.storeKey, data).subscribe(() => cb && cb(data));
    return this;
  }

  protected clear(cb?: () => void): Document<T> {
    if (this._dataSub.getValue() === null) return this;
    this._dataSub.next(null);
    if (this._store) this._store.delete(this.storeKey).subscribe(() => cb && cb());
    return this;
  }

  protected sync(mode = SYNC_MODE.PULL) {
    if (!this._store) return empty();

    if (mode === SYNC_MODE.PULL)
      return this._store.get<T>(this.storeKey).pipe(map(data => this._dataSub.next(data)));
    else if (mode === SYNC_MODE.MERGE_PULL)
      return this._store.get<T>(this.storeKey).pipe(map(data => this._dataSub.next(Object.assign(this.get() || {}, data || <any>{}))));
    else if (mode === SYNC_MODE.MERGE_PUSH)
      return this._store.get<T>(this.storeKey).pipe(switchMap(data => this._store.update(this.storeKey, Object.assign(this.get() || {}, data || <any>{}))));
    else 
      return this._store.update(this.storeKey, this.get());
  }

  protected link(store?: Store, key: string = this.storeKey, mode = SYNC_MODE.MERGE_PULL) {
    if (!store) {
      this._store = this._uStore || null;
      this._uStore = null;
      if (this._store) return this.sync(mode);
    } else if (store && (key || this.storeKey)) {
      this._uStore = null;
      this._store = store;
      return this._store.ready$.pipe(tap(() => !!mode && this.sync(mode)))
    }

    return empty();
  }

  protected unlink(clear = true) {
    this._uStore = this._store;
    this._store = null;
    !!clear && this.clear();
    return this;
  }
}