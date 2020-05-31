import { BehaviorSubject, Observable, empty, of } from "rxjs";
import { filterNil } from "./operators/filterNil";
import { map, filter, switchMap, tap } from "rxjs/operators";
import { ListStore, XDB } from "./xdb";
import { distinctUntilObjChanged } from "./operators/distinctUntilObjChanged";
import { distinctUntilArrChanged } from "./operators/distinctUntilArrChanged";
import { SYNC_MODE } from "./document";

export interface CollectionOptions<U = { [key: string]: any }> {
  publishAfterStoreSync?: boolean;
  defaultState?: U;
}

export class Doc<T, U> {
  constructor(
    public id: IDBValidKey,
    public doc: T,
    public state: U
  ) { }
}

export class Collection<T, U = { [key: string]: any }> {
  private _id: string;
  private _dataSub = new BehaviorSubject<Map<IDBValidKey, Doc<T, U>>>(null);
  private _activeSub = new BehaviorSubject<Doc<T, U>>(null);
  private _readySub = new BehaviorSubject<boolean>(false);
  private _ustore: ListStore<Doc<T, U>>;
  private _db: XDB;
  private _store: ListStore<Doc<T, U>>;
  private _dState: U;
  private _loadingSub = new BehaviorSubject<boolean>(true);
  private _publishAfterStoreSync: boolean;

  readonly docs$ = this._dataSub.pipe(filterNil(), map(data => this.toArray(data)));
  readonly count$ = this._dataSub.pipe(map(data => data?.size || 0));
  readonly loading$ = this._loadingSub.asObservable();
  readonly active$ = this._activeSub.asObservable();
  readonly ready$ = this._readySub.pipe(filter(ready => ready));

  constructor(keyPath: string, db?: XDB, options?: CollectionOptions<U>) {
    this._id = keyPath;
    this._dState = options.defaultState;
    this._publishAfterStoreSync = !!options.publishAfterStoreSync;
    this._db = db || null;

    if (!this._db) this._readySub.next(true);
    else {
      this._store = new ListStore<Doc<T, U>>(this._db, this.constructor.name, 'id');
      this._store.ready$.pipe(switchMap(() => this._store.getAll()))
        .subscribe(data => {
          this._dataSub.next(this.docsToMap(data));
          this._readySub.next(true);
        });
    }
  }

  protected get map() { return this._dataSub.getValue() || new Map<IDBValidKey, Doc<T, U>>(); }

  protected toArray(data: Map<IDBValidKey, Doc<T, U>>) { return Array.from(data.values()); }

  protected docsToMap(docs: Doc<T, U>[]) {
    let map = new Map<IDBValidKey, Doc<T, U>>();
    for (let doc of docs) map.set(doc.id, doc);
    return map;
  }

  get ready() { return this._readySub.getValue(); }
  get docs() { return this.toArray(this.map); }
  get count() { return this.map.size; }
  get active() { return this._activeSub.getValue(); }

  protected set loading(val: boolean) { this._loadingSub.next(val); }

  private _get(map: Map<IDBValidKey, Doc<T, U>>, id: IDBValidKey): Doc<T, U>;
  private _get(map: Map<IDBValidKey, Doc<T, U>>, filter: (doc: Doc<T, U>) => boolean): Doc<T, U>;
  private _get(map: Map<IDBValidKey, Doc<T, U>>, filter: IDBValidKey | ((doc: Doc<T, U>) => boolean)) {
    if (typeof filter === 'function') {
      for (let doc of this.toArray(map))
        if (filter(doc)) return doc;
    } else return map.get(filter);
  }

  get(id: IDBValidKey): Doc<T, U>;
  get(filter: (doc: Doc<T, U>) => boolean): Doc<T, U>;
  get(filter: IDBValidKey | ((doc: Doc<T, U>) => boolean)) {
    return this._get(this.map, <any>filter);
  }

  has(id: IDBValidKey): boolean;
  has(filter: (doc: Doc<T, U>) => boolean): boolean;
  has(filter: IDBValidKey | ((doc: Doc<T, U>) => boolean)) {
    return this._get(this.map, <any>filter) !== undefined;
  }

  private _getMany(map: Map<IDBValidKey, Doc<T, U>>, ids: IDBValidKey[]): Doc<T, U>[];
  private _getMany(map: Map<IDBValidKey, Doc<T, U>>, filter: (doc: Doc<T, U>) => boolean): Doc<T, U>[];
  private _getMany(map: Map<IDBValidKey, Doc<T, U>>, filter: IDBValidKey[] | ((doc: Doc<T, U>) => boolean)) {
    let result: Doc<T, U>[] = [];
    if (typeof filter === 'function') {
      for (let doc of this.toArray(map))
        if (filter(doc)) result.push(doc);
    } else for (let id of filter) {
      let doc = map.get(id);
      !!doc && result.push(doc);
    }
    return result;
  }

  getMany(id: IDBValidKey[]): Doc<T, U>[];
  getMany(filter: (doc: Doc<T, U>) => boolean): Doc<T, U>[];
  getMany(filter: IDBValidKey[] | ((doc: Doc<T, U>) => boolean)) {
    return this._getMany(this.map, <any>filter);
  }

  select(id: IDBValidKey, keys?: string[]): Observable<Doc<T, U>>;
  select(filter: (doc: Doc<T, U>) => boolean, keys?: string[]): Observable<Doc<T, U>>;
  select(filter: IDBValidKey | ((doc: Doc<T, U>) => boolean), keys?: string[]) {
    let root$: Observable<Doc<T, U>>;
    if (typeof filter === "function") root$ = this.docs$.pipe(map(docs => { for (let doc of docs) if (filter(doc)) return doc }));
    else root$ = this._dataSub.pipe(map(m => m.get(filter)));

    return root$.pipe(distinctUntilObjChanged(keys));
  }

  selectMany(id: IDBValidKey[], keys?: string[]): Observable<Doc<T, U>[]>;
  selectMany(filter: (doc: Doc<T, U>) => boolean, keys?: string[]): Observable<Doc<T, U>[]>;
  selectMany(filter: IDBValidKey[] | ((doc: Doc<T, U>) => boolean), keys?: string[]) {
    let root$: Observable<Doc<T, U>[]>;
    if (typeof filter === "function") root$ = this.docs$.pipe(map(docs => docs.filter(doc => filter(doc))));
    else root$ = this._dataSub.pipe(map(m => filter.map(id => m.get(id)).filter(doc => !!doc)));

    return root$.pipe(distinctUntilArrChanged('id', <string[]>keys));
  }

  protected setActive(id?: IDBValidKey): void {
    this._activeSub.next(id ? this.map.get(id) : null);
  }

  protected insert(entry: T, state = this._dState, overwrite = false, cb?: (doc: Doc<T, U>) => void): void {
    let map = this.map;

    if (map.has(entry[this._id]) && !overwrite) {
      cb && cb(null);
      return;
    }

    let doc = new Doc<T, U>(entry[this._id], entry, state || this._dState);
    this.map.set(entry[this._id], doc);

    if (!this._publishAfterStoreSync || !this._store) {
      this._dataSub.next(map);
      cb && cb(doc);
    }

    if (this._store) this._store.update(doc.id, doc).subscribe(() => {
      if (this._publishAfterStoreSync) this._dataSub.next(map);
      cb && cb(doc);
    });
  }

  protected insertMany(entries: T[], state = this._dState, overwrite = false, cb?: (data: Doc<T, U>[]) => void): void {
    let map = this.map;
    let inserted: Doc<T, U>[] = [];

    for (let entry of entries) {
      if (map.has(entry[this._id]) && !overwrite) continue;
      let doc = new Doc<T, U>(entry[this._id], entry, state || this._dState);
      this.map.set(entry[this._id], doc)
      inserted.push(doc);
    };

    if (inserted.length === 0) {
      cb && cb([]);
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

  protected update(id: IDBValidKey, update: Partial<T>, state?: U, cb?: (doc: Doc<T, U>) => void): void {
    let map = this.map;

    if (!map.has(id)) {
      cb && cb(null);
      return;
    }

    let doc = map.get(id);
    Object.assign(doc.doc, update);
    if (state) Object.assign(doc.state, state);
    this.map.set(id, doc);

    if (!this._publishAfterStoreSync || !this._store) {
      this._dataSub.next(map);
      cb && cb(doc)
    }

    if (this._store) this._store.update(id, doc, false).subscribe(() => {
      if (this._publishAfterStoreSync) this._dataSub.next(map);
      cb && cb(doc)
    });
  }

  protected updateMany(ids: IDBValidKey[], update: Partial<T>, state?: U, cb?: (updated: Doc<T, U>[]) => void): void
  protected updateMany(filter: (doc: Doc<T, U>) => boolean, update: Partial<T>, state?: U, cb?: (updated: Doc<T, U>[]) => void): void
  protected updateMany(filter: IDBValidKey[] | ((doc: Doc<T, U>) => boolean), update: Partial<T>, state = this._dState, cb?: (updated: Doc<T, U>[]) => void): void {
    let map = this.map;
    let updated: Doc<T, U>[] = [];

    if (typeof filter === "function") {
      for (let doc of this.docs) {
        if (!filter(doc)) continue;
        Object.assign(doc.doc, update);
        if (state) Object.assign(doc.state, state);
        this.map.set(doc.id, doc);
        updated.push(doc);
      }
    } else {
      for (let id of filter) {
        let doc = map.get(id);
        if (!doc) continue;
        Object.assign(doc.doc, update);
        if (state) Object.assign(doc.state, state);
        this.map.set(doc.id, doc);
        updated.push(doc);
      }
    }

    if (updated.length === 0) {
      cb && cb([]);
      return;
    }

    if (!this._publishAfterStoreSync || !this._store) {
      this._dataSub.next(map);
      cb && cb(updated);
    }

    if (this._store) this._store.updateMany(updated, false).subscribe(() => {
      if (this._publishAfterStoreSync) this._dataSub.next(map);
      cb && cb(updated);
    });
  }

  protected updatedState(ids: IDBValidKey[], state: U, cb?: (updated: Doc<T, U>[]) => void): void {
    let map = this.map;
    let updated: Doc<T, U>[] = [];

    for (let id of ids) {
      if (!this.map.has(id)) continue;
      let doc = this.map.get(id);
      Object.assign(doc.state, state);
      updated.push(doc);
    }

    if (updated.length === 0) {
      cb && cb([]);
      return;
    }

    if (!this._publishAfterStoreSync || !this._store) {
      this._dataSub.next(map);
      cb && cb(updated);
    }

    if (this._store) this._store.updateMany(updated, false).subscribe(() => {
      if (this._publishAfterStoreSync) this._dataSub.next(map);
      cb && cb(updated);
    });
  }

  protected replaceOne(entry: T, state?: U, upsert = false, cb?: (oldDoc: Doc<T, U>, newDoc: Doc<T, U>) => void): void {
    let map = this.map;
    let newDoc = new Doc(entry[this._id], entry, state || this._dState);

    if (!map.has(newDoc.id) && !upsert) {
      cb && cb(null, null);
      return;
    }

    let oldDoc = map.get(newDoc.id) || null;
    map.set(newDoc.id, newDoc);

    if (!this._publishAfterStoreSync || !this._store) {
      this._dataSub.next(map);
      cb && cb(oldDoc, newDoc);
    }

    if (this._store) this._store.update(newDoc.id, newDoc, true).subscribe(() => {
      if (this._publishAfterStoreSync) this._dataSub.next(map);
      cb && cb(oldDoc, newDoc);
    });
  }

  protected replaceAll(entries: T[], state?: U, cb?: (docs: Doc<T, U>[]) => void): void {
    let docs = entries.map(entry => new Doc(entry[this._id], entry, state || this._dState));
    let map = this.docsToMap(docs);

    if (!this._publishAfterStoreSync || !this._store) {
      this._dataSub.next(map);
      cb && cb(docs);
    }

    if (this._store) this._store.updateMany(docs, true).subscribe(() => {
      if (this._publishAfterStoreSync) this._dataSub.next(map);
      cb && cb(docs);
    });
  }

  protected removeOne(id: IDBValidKey, cb?: (doc: Doc<T, U>) => void): void {
    let map = this.map;
    let doc = map.get(id);

    if (!doc) {
      cb && cb(doc);
      return;
    }

    if (!this._publishAfterStoreSync || !this._store) {
      this._dataSub.next(map);
      cb && cb(doc);
    }

    if (this._store) this._store.delete(id).subscribe(() => {
      if (this._publishAfterStoreSync) this._dataSub.next(map);
      cb && cb(doc);
    });
  }

  protected removeMany(ids: IDBValidKey[], cb?: (deleted: Doc<T, U>[]) => void): void
  protected removeMany(filter: (doc: Doc<T, U>) => boolean, cb?: (deleted: Doc<T, U>[]) => void): void
  protected removeMany(filter: IDBValidKey[] | ((doc: Doc<T, U>) => boolean), cb?: (deleted: Doc<T, U>[]) => void): void {
    let map = this.map;
    let removed: Doc<T, U>[] = [];

    if (typeof filter === "function") {
      for (let doc of this.docs) {
        if (!filter(doc)) continue;
        this.map.delete(doc.id);
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
      cb && cb(removed);
    }

    if (this._store) this._store.deleteMany(removed.map(doc => doc.id)).subscribe(() => {
      if (this._publishAfterStoreSync) this._dataSub.next(map);
      cb && cb(removed);
    });
  }

  protected clear(cb?: () => void): void {
    let map = new Map<IDBValidKey, Doc<T, U>>();
    if (!this._publishAfterStoreSync || !this._store) {
      this._dataSub.next(map);
      this._activeSub.next(null);
      cb && cb();
    }

    if (this._store) this._store.clear().subscribe(() => {
      if (this._publishAfterStoreSync) {
        this._dataSub.next(map);
        this._activeSub.next(null);
      }

      cb && cb();
    });
  }

  protected sync(mode = SYNC_MODE.PULL) {
    if (this._store || mode === SYNC_MODE.NONE) return empty();
    if (mode === SYNC_MODE.PULL) return this._store.getAll().pipe(map(data => this._dataSub.next(this.docsToMap(data))));
    if (mode === SYNC_MODE.MERGE_PULL) {
      return this._store.getAll().pipe(
        map(docs => {
          let map = this.map;
          for (let doc of docs) map.set(doc.id, doc);
          this._dataSub.next(map);
        })
      );    
    }

    if (mode === SYNC_MODE.MERGE_PUSH) return this._store.updateMany(this.docs);
    else return this._store.clear().pipe(switchMap(() => this._store.updateMany(this.docs)));
  }

  protected link(db?: XDB, mode = SYNC_MODE.PULL) {
    if (!db) {
      if (this._ustore) {
        this._store = this._ustore;
        this._ustore = null;
        return this.sync(mode);
      }

    } else {
      this._ustore = null;
      this._readySub.next(false);
      this._store = this._ustore = null;
      this.clear();
      this._db = db;
      this._store = new ListStore<Doc<T,U>>(this._db, this.constructor.name, 'id');
      return this._store.ready$.pipe(tap(() => !!mode && this.sync(mode)));
    }

    return empty();
  }

  protected unlink(clear = true) {
     this._ustore = this._store;
    this._store = null;
    this._db = null;
    if (clear) this.clear();
    return this;
  }
}