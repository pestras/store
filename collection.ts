import { BehaviorSubject, Observable, of, combineLatest } from "rxjs";
import { filterNil } from "./operators/filterNil";
import { map, filter, switchMap, tap } from "rxjs/operators";
import { ListStore, XDB } from "./xdb";
import { distinctUntilObjChanged } from "./operators/distinctUntilObjChanged";
import { distinctUntilArrChanged } from "./operators/distinctUntilArrChanged";
import { SYNC_MODE, Document } from "./document";

export interface CollectionOptions<U = { [key: string]: any }> {
  publishAfterStoreSync?: boolean;
  defaultStateFac?: () => U;
}

export class ActiveDocumnet<T> extends Document<T> {
  constructor(observable$: Observable<Partial<T>>) {
    super();

    observable$.subscribe(data => {
      if (data) this.update(data);
      else this.clear();
    });
  }
}

export class Collection<T> {
  private _dataSub = new BehaviorSubject<Map<IDBValidKey, T>>(null);
  private _activeSub = new BehaviorSubject<IDBValidKey>(null);
  private _readySub = new BehaviorSubject<boolean>(false);
  private _ustore: ListStore<T>;
  private _store: ListStore<T>;
  private _loadingSub = new BehaviorSubject<boolean>(true);

  readonly docs$ = this._dataSub.pipe(filterNil(), map(data => this.toArray(data)));
  readonly count$ = this._dataSub.pipe(map(data => data?.size || 0));
  readonly loading$ = this._loadingSub.asObservable();
  readonly ready$ = this._readySub.pipe(filter(ready => ready));
  readonly active = new ActiveDocumnet<T>(combineLatest(this._activeSub, this._dataSub).pipe(switchMap(([id]) => this.select(id))));

  constructor(readonly keyPath: string, private _db: XDB = null, private _publishAfterStoreSync = true) {
    if (!this._db) this._readySub.next(true);
    else {
      this._db.store(this.constructor.name, this.keyPath)
        .pipe(
          tap(store => this._store = <ListStore<T>>store),
          switchMap(() => this._store.getAll())
        )
        .subscribe(data => {
          this._dataSub.next(this.docsToMap(data));
          this._readySub.next(true);
        });
    }
  }

  protected get map() { return this._dataSub.getValue() || new Map<IDBValidKey, T>(); }

  protected toArray(data: Map<IDBValidKey, T>) { return Array.from(data.values()); }

  protected docsToMap(docs: T[]) {
    let map = new Map<IDBValidKey, T>();
    for (let doc of docs) map.set(doc[this.keyPath], doc);
    return map;
  }

  get ready() { return this._readySub.getValue(); }
  get docs() { return this.toArray(this.map); }
  get count() { return this.map.size; }

  protected set loading(val: boolean) { this._loadingSub.next(val); }

  private _get(map: Map<IDBValidKey, T>, id: IDBValidKey): T;
  private _get(map: Map<IDBValidKey, T>, filter: (doc: T) => boolean): T;
  private _get(map: Map<IDBValidKey, T>, filter: IDBValidKey | ((doc: T) => boolean)) {
    if (typeof filter === 'function') {
      for (let doc of this.toArray(map))
        if (filter(doc)) return doc;
    } else return map.get(filter);
  }

  get(id: IDBValidKey): T;
  get(filter: (doc: T) => boolean): T;
  get(filter: IDBValidKey | ((doc: T) => boolean)) {
    return this._get(this.map, <any>filter);
  }

  has(id: IDBValidKey): boolean;
  has(filter: (doc: T) => boolean): boolean;
  has(filter: IDBValidKey | ((doc: T) => boolean)) {
    return this._get(this.map, <any>filter) !== undefined;
  }

  private _getMany(map: Map<IDBValidKey, T>, ids: IDBValidKey[]): T[];
  private _getMany(map: Map<IDBValidKey, T>, filter: (doc: T) => boolean): T[];
  private _getMany(map: Map<IDBValidKey, T>, filter: IDBValidKey[] | ((doc: T) => boolean)) {
    let result: T[] = [];
    if (typeof filter === 'function') {
      for (let doc of this.toArray(map))
        if (filter(doc)) result.push(doc);
    } else for (let id of filter) {
      let doc = map.get(id);
      !!doc && result.push(doc);
    }
    return result;
  }

  getMany(id: IDBValidKey[]): T[];
  getMany(filter: (doc: T) => boolean): T[];
  getMany(filter: IDBValidKey[] | ((doc: T) => boolean)) {
    return this._getMany(this.map, <any>filter);
  }

  select(id: IDBValidKey, keys?: string[]): Observable<T>;
  select(filter: (doc: T) => boolean, keys?: string[]): Observable<T>;
  select(filter: IDBValidKey | ((doc: T) => boolean), keys?: string[]) {
    let root$: Observable<T>;
    if (typeof filter === "function") root$ = this.docs$.pipe(map(docs => { for (let doc of docs) if (filter(doc)) return doc }));
    else root$ = this._dataSub.pipe(map(m => this.get(filter)));

    return root$.pipe(distinctUntilObjChanged(keys));
  }

  selectMany(id: IDBValidKey[], keys?: string[]): Observable<T[]>;
  selectMany(filter: (doc: T) => boolean, keys?: string[]): Observable<T[]>;
  selectMany(filter: IDBValidKey[] | ((doc: T) => boolean), keys?: string[]) {
    let root$: Observable<T[]>;
    if (typeof filter === "function") root$ = this.docs$.pipe(map(docs => docs.filter(doc => filter(doc))));
    else root$ = this._dataSub.pipe(map(m => filter.map(id => this.get(id)).filter(doc => !!doc)));

    return root$.pipe(distinctUntilArrChanged(<keyof T>this.keyPath, <string[]>keys));
  }

  protected setActive(id?: IDBValidKey): void {
    this._activeSub.next(id);
  }

  protected insert(doc: T, overwrite = false, cb?: (doc: T) => void): void {
    let map = this.map;

    if (map.has(doc[this.keyPath]) && !overwrite) {
      cb && cb(null);
      return;
    }

    this.map.set(doc[this.keyPath], doc);

    if (!this._publishAfterStoreSync || !this._store) {
      this._dataSub.next(map);
      (!this._store && cb) && cb(doc);
    }

    if (this._store) this._store.update(doc[this.keyPath], doc).subscribe(() => {
      if (this._publishAfterStoreSync) this._dataSub.next(map);
      cb && cb(doc);
    });
  }

  protected insertMany(docs: T[], overwrite = false, cb?: (data: T[]) => void): void {
    let map = this.map;
    let inserted: T[] = [];

    for (let doc of docs) {
      if (map.has(doc[this.keyPath]) && !overwrite) continue;
      this.map.set(doc[this.keyPath], doc)
      inserted.push(doc);
    };

    if (inserted.length === 0) {
      (!this._store && cb) && cb([]);
      return;
    }

    if (!this._publishAfterStoreSync || !this._store) {
      this._dataSub.next(map);
      cb && cb(inserted)
    }

    if (this._store) this._store.updateMany(inserted).subscribe(() => {
      if (this._publishAfterStoreSync) this._dataSub.next(map);
      cb && cb(inserted)
    });
  }

  protected update(id: IDBValidKey, update: Partial<T>, cb?: (doc: T) => void): void {
    let map = this.map;

    if (!map.has(id)) {
      cb && cb(null);
      return;
    }

    let doc = map.get(id);
    Object.assign(doc, update);
    this.map.set(id, doc);

    if (!this._publishAfterStoreSync || !this._store) {
      this._dataSub.next(map);
      (!this._store && cb) && cb(doc)
    }

    if (this._store) this._store.update(id, doc, false).subscribe(() => {
      if (this._publishAfterStoreSync) this._dataSub.next(map);
      cb && cb(doc)
    });
  }

  protected updateMany(ids: IDBValidKey[], update: Partial<T>, cb?: (updated: T[]) => void): void
  protected updateMany(filter: (doc: T) => boolean, update: Partial<T>, cb?: (updated: T[]) => void): void
  protected updateMany(filter: IDBValidKey[] | ((doc: T) => boolean), update: Partial<T>, cb?: (updated: T[]) => void): void {
    let map = this.map;
    let updated: T[] = [];

    if (typeof filter === "function") {
      for (let doc of this.docs) {
        if (!filter(doc)) continue;
        Object.assign(doc, update);
        this.map.set(doc[this.keyPath], doc);
        updated.push(doc);
      }
    } else {
      for (let id of filter) {
        let doc = map.get(id);
        if (!doc) continue;
        Object.assign(doc, update);
        this.map.set(doc[this.keyPath], doc);
        updated.push(doc);
      }
    }

    if (updated.length === 0) {
      cb && cb([]);
      return;
    }

    if (!this._publishAfterStoreSync || !this._store) {
      this._dataSub.next(map);
      (!this._store && cb) && cb(updated);
    }

    if (this._store) this._store.updateMany(updated, false).subscribe(() => {
      if (this._publishAfterStoreSync) this._dataSub.next(map);
      cb && cb(updated);
    });
  }

  protected replaceOne(newDoc: T, upsert = false, cb?: (oldDoc: T, newDoc: T) => void): void {
    let map = this.map;

    if (!map.has(newDoc[this.keyPath]) && !upsert) {
      cb && cb(null, null);
      return;
    }

    let oldDoc = map.get(newDoc[this.keyPath]) || null;
    map.set(newDoc[this.keyPath], newDoc);

    if (!this._publishAfterStoreSync || !this._store) {
      this._dataSub.next(map);
      (!this._store && cb) && cb(oldDoc, newDoc);
    }

    if (this._store) this._store.update(newDoc[this.keyPath], newDoc, true).subscribe(() => {
      if (this._publishAfterStoreSync) this._dataSub.next(map);
      cb && cb(oldDoc, newDoc);
    });
  }

  protected replaceAll(docs: T[], cb?: (docs: T[]) => void): void {
    let map = this.docsToMap(docs);

    if (!this._publishAfterStoreSync || !this._store) {
      this._dataSub.next(map);
      (!this._store && cb) && cb(docs);
    }

    if (this._store) this._store.updateMany(docs, true).subscribe(() => {
      if (this._publishAfterStoreSync) this._dataSub.next(map);
      cb && cb(docs);
    });
  }

  protected removeOne(id: IDBValidKey, cb?: (doc: T) => void): void {
    let map = this.map;
    let doc = map.get(id);

    if (!doc) {
      cb && cb(doc);
      return;
    }

    if (!this._publishAfterStoreSync || !this._store) {
      this._dataSub.next(map);
      (!this._store && cb) && cb(doc);
    }

    if (this._store) this._store.delete(id).subscribe(() => {
      if (this._publishAfterStoreSync) this._dataSub.next(map);
      cb && cb(doc);
    });
  }

  protected removeMany(ids: IDBValidKey[], cb?: (deleted: T[]) => void): void
  protected removeMany(filter: (doc: T) => boolean, cb?: (deleted: T[]) => void): void
  protected removeMany(filter: IDBValidKey[] | ((doc: T) => boolean), cb?: (deleted: T[]) => void): void {
    let map = this.map;
    let removed: T[] = [];

    if (typeof filter === "function") {
      for (let doc of this.docs) {
        if (!filter(doc)) continue;
        this.map.delete(doc[this.keyPath]);
        removed.push(doc);
      }
    } else {
      for (let id of filter) {
        let doc = map.get(id);
        if (!doc) continue;
        this.map.delete(id);
        removed.push(doc);
      }
    }

    if (!this._publishAfterStoreSync || !this._store) {
      this._dataSub.next(map);
      (!this._store && cb) && cb(removed);
    }

    if (this._store) this._store.deleteMany(removed.map(doc => doc[this.keyPath])).subscribe(() => {
      if (this._publishAfterStoreSync) this._dataSub.next(map);
      cb && cb(removed);
    });
  }

  protected clear(cb?: () => void): void {
    let map = new Map<IDBValidKey, T>();
    if (!this._publishAfterStoreSync || !this._store) {
      this._dataSub.next(map);
      (!this._store && cb) && cb();
    }

    if (this._store) this._store.clear().subscribe(() => {
      if (this._publishAfterStoreSync) this._dataSub.next(map);

      cb && cb();
    });
  }

  protected sync(mode = SYNC_MODE.PULL) {
    if (!this._store || mode === SYNC_MODE.NONE) return of([]);
    if (mode === SYNC_MODE.PULL) return this._store.getAll().pipe(map(data => this._dataSub.next(this.docsToMap(data))));
    if (mode === SYNC_MODE.MERGE_PULL) {
      return this._store.getAll().pipe(
        map(docs => {
          let map = this.map;
          for (let doc of docs) map.set(doc[this.keyPath], doc);
          this._dataSub.next(map);
        })
      );
    }

    if (mode === SYNC_MODE.MERGE_PUSH) return this._store.updateMany(this.docs);
    else return this._store.clear().pipe(switchMap(() => this._store.updateMany(this.docs)));
  }

  protected link(db?: XDB, mode = SYNC_MODE.PULL) {
    if (!db) {
      this._store = this._ustore || null;
      this._ustore = null;
      return mode !== SYNC_MODE.NONE && !!this._store ? this.sync(mode) : of([]);
    }

    this._readySub.next(false);
    this._store = this._ustore = null;
    this.clear();
    this._db = db;
    return db.store(this.constructor.name, this.keyPath).pipe(tap(store => this._store = <ListStore<T>>store), switchMap(() => this.sync(mode)));
  }

  protected unlink(clear = true) {
    this._ustore = this._store;
    this._store = null;
    this._db = null;
    if (clear) this.clear();
    return this;
  }
}

let col = new Collection('_id');