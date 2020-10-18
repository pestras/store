import { BehaviorSubject, Observable, of, combineLatest } from "rxjs";
import { filterNil } from "./operators/filterNil";
import { map, switchMap, tap, shareReplay, distinctUntilChanged } from "rxjs/operators";
import { ListStore, XDB } from "./xdb";
import { distinctUntilObjChanged } from "./operators/distinctUntilObjChanged";
import { distinctUntilArrChanged } from "./operators/distinctUntilArrChanged";
import { SYNC_MODE, Document } from "./document";
import { gate } from "./operators/gate";

export interface CollectionOptions<U = { [key: string]: any }> {
  publishAfterStoreSync?: boolean;
  defaultStateFac?: () => U;
}

export class ActiveDocumnet<T> extends Document<T> {
  constructor(observable$: Observable<Partial<T>>) {
    super();

    observable$.subscribe(data => {
      if (data) this.update(data, true);
      else this.clear();
    });
  }

  onReady() {
    this.idle = true;
  }
}

export class Collection<T> {
  private _idleSub = new BehaviorSubject<boolean>(false);
  private _dataSub = new BehaviorSubject<Map<IDBValidKey, T>>(null);
  private _activeSub = new BehaviorSubject<IDBValidKey>(null);
  private _store: ListStore<T>;

  readonly idle$ = this._idleSub.pipe(shareReplay(1));
  readonly docs$ = this._dataSub.pipe(filterNil(), gate(this.idle$), map(data => this.toArray(data)), shareReplay(1));
  readonly count$ = this._dataSub.pipe(map(data => data?.size || 0), distinctUntilChanged(), shareReplay(1));
  readonly active = new ActiveDocumnet<T>(combineLatest([this._activeSub, this._dataSub]).pipe(map(([id]) => this.get(id))));

  constructor(readonly keyPath: string, xdb: XDB = null, readonly publishAfterStoreSync = true) {
    if (xdb) {
      this._store = new ListStore<T>(xdb, this.constructor.name, keyPath);
      this._store.ready$
        .pipe(switchMap(() => this._store.getAll()))
        .subscribe(data => {
          if (typeof this.storeMap === "function") this._dataSub.next(this.docsToMap(data.map(doc => this.storeMap(doc))));
          else this._dataSub.next(this.docsToMap(data));
          this.onReady();
        });
    } else this.onReady();
  }

  protected onReady(): void { this.idle = true };

  protected get map() { return this._dataSub.getValue() || new Map<IDBValidKey, T>(); }

  protected toArray(data: Map<IDBValidKey, T>) { return Array.from(data.values()); }

  protected docsToMap(docs: T[]) {
    let map = new Map<IDBValidKey, T>();
    for (let doc of docs) map.set(doc[this.keyPath], doc);
    return map;
  }

  protected get store() { return this._store; }
  get isIdle() { return this._idleSub.getValue(); }
  get docs() { return this.toArray(this.map); }
  get count() { return this.map.size; }
  get linked() { return !!this._store; }

  protected set idle(val: boolean) { this._idleSub.next(val); }

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
    else root$ = this.docs$.pipe(map(m => this.get(filter)));

    return root$.pipe(distinctUntilObjChanged(keys), shareReplay(1));
  }

  has$(id: IDBValidKey, keys?: string[]): Observable<boolean>;
  has$(filter: (doc: T) => boolean, keys?: string[]): Observable<boolean>;
  has$(filter: IDBValidKey | ((doc: T) => boolean), keys?: string[]) {
    let root$: Observable<T>;
    if (typeof filter === "function") root$ = this.docs$.pipe(map(docs => { for (let doc of docs) if (filter(doc)) return doc }));
    else root$ = this.docs$.pipe(map(m => this.get(filter)));

    return root$.pipe(distinctUntilObjChanged(keys), map(doc => doc !== undefined), shareReplay(1));
  }

  selectAll(keys: string[]): Observable<T[]> {
    return this.docs$.pipe(distinctUntilArrChanged(<keyof T>this.keyPath, keys), shareReplay(1));
  }

  selectMany(id: IDBValidKey[], keys?: string[]): Observable<T[]>;
  selectMany(filter: (doc: T) => boolean, keys?: string[]): Observable<T[]>;
  selectMany(filter?: IDBValidKey[] | ((doc: T) => boolean), keys?: string[]) {
    let root$: Observable<T[]>;
    if (typeof filter === "function") root$ = this.docs$.pipe(map(docs => docs.filter(doc => filter(doc))));
    else root$ = this.docs$.pipe(map(m => filter.map(id => this.get(id)).filter(doc => !!doc)));

    return root$.pipe(distinctUntilArrChanged(<keyof T>this.keyPath, <string[]>keys), shareReplay(1));
  }

  protected storeMap?(doc: T): T;

  protected setActive(id?: IDBValidKey): void {
    this._activeSub.next(id);
  }

  protected insert(doc: T, overwrite = false): Promise<T> {
    return new Promise((res, rej) => {
      let map = this.map;

      if (map.has(doc[this.keyPath]) && !overwrite) return res(null);

      map.set(doc[this.keyPath], doc);

      if (!this.publishAfterStoreSync || !this._store) this._dataSub.next(map);

      if (this._store) {
        this._store.update(doc[this.keyPath], doc).subscribe(() => {
          if (this.publishAfterStoreSync) this._dataSub.next(map);
          res(doc);
        }, err => rej(err));

      } else res(doc);
    })
  }

  protected insertMany(docs: T[], overwrite = false): Promise<T[]> {
    return new Promise((res, rej) => {
      let map = this.map;
      let inserted: T[] = [];

      for (let doc of docs) {
        if (map.has(doc[this.keyPath]) && !overwrite) continue;
        map.set(doc[this.keyPath], doc)
        inserted.push(doc);
      };

      if (inserted.length === 0) return res([])

      if (!this.publishAfterStoreSync || !this._store) this._dataSub.next(map);

      if (this._store) {
        this._store.updateMany(inserted).subscribe(() => {
          if (this.publishAfterStoreSync) this._dataSub.next(map);
          res(inserted);
        }, err => rej(err));

      } else res(inserted);

    })
  }

  protected update(id: IDBValidKey, update: Partial<T>): Promise<T> {
    return new Promise((res, rej) => {
      let map = this.map;

      if (!map.has(id)) return res(null)

      let doc = map.get(id);
      Object.assign(doc, update);
      map.set(id, doc);

      if (!this.publishAfterStoreSync || !this._store) this._dataSub.next(map);

      if (this._store) {
        this._store.update(id, doc, false).subscribe(() => {
          if (this.publishAfterStoreSync) this._dataSub.next(map);
          res(doc)
        }, err => rej(err));

      } else res(doc);

    })
  }

  protected updateMany(ids: IDBValidKey[], update: Partial<T>): Promise<T[]>
  protected updateMany(filter: (doc: T) => boolean, update: Partial<T>): Promise<T[]>
  protected updateMany(filter: IDBValidKey[] | ((doc: T) => boolean), update: Partial<T>): Promise<T[]> {
    return new Promise((res, rej) => {
      let map = this.map;
      let updated: T[] = [];

      if (typeof filter === "function") {
        for (let doc of this.docs) {
          if (!filter(doc)) continue;
          Object.assign(doc, update);
          map.set(doc[this.keyPath], doc);
          updated.push(doc);
        }
      } else {
        for (let id of filter) {
          let doc = map.get(id);
          if (!doc) continue;
          Object.assign(doc, update);
          map.set(doc[this.keyPath], doc);
          updated.push(doc);
        }
      }

      if (updated.length === 0) return res([]);

      if (!this.publishAfterStoreSync || !this._store) this._dataSub.next(map);

      if (this._store) {
        this._store.updateMany(updated, false).subscribe(() => {
          if (this.publishAfterStoreSync) this._dataSub.next(map);
          res(updated);
        }, err => rej(err));

      } else res(updated);
    })
  }

  protected bulkUpdate(updates: Partial<T>[]): Promise<T[]> {
    return new Promise((res, rej) => {
      let map = this.map;
      let updated: T[] = [];

      for (let update of updates) {
        let id = update[this.keyPath];
        if (!id) continue;
        let doc = map.get(id);
        if (!doc) continue;
        Object.assign(doc, update);
        map.set(id, doc);
        updated.push(doc);
      }

      if (updated.length === 0) return res([])

      if (!this.publishAfterStoreSync || !this._store) this._dataSub.next(map);

      if (this._store) {
        this._store.updateMany(updated, false).subscribe(() => {
          if (this.publishAfterStoreSync) this._dataSub.next(map);
          res(updated);
        }, err => rej(err));

      } else res(updated);
    })
  }

  protected replaceOne(newDoc: T, upsert = false): Promise<[T, T]> {
    return new Promise((res, rej) => {
      let map = this.map;

      if (!map.has(newDoc[this.keyPath]) && !upsert) return res(null);

      let oldDoc = map.get(newDoc[this.keyPath]) || null;
      map.set(newDoc[this.keyPath], newDoc);

      if (!this.publishAfterStoreSync || !this._store) this._dataSub.next(map);

      if (this._store) {
        this._store.update(newDoc[this.keyPath], newDoc, true).subscribe(() => {
          if (this.publishAfterStoreSync) this._dataSub.next(map);
          res([oldDoc, newDoc]);
        }, err => rej(err));

      } else res([oldDoc, newDoc]);
    });
  }

  protected replaceMany(docs: T[], upsert = false): Promise<T[]> {
    return new Promise((res, rej) => {
      let map = this.map;
      let replaced: T[] = [];

      for (let doc of docs) {
        let oldDoc = map.get(doc[this.keyPath]);
        if (oldDoc || (!oldDoc && upsert)) {
          map.set(doc[this.keyPath], doc);
          replaced.push(doc);
        }
      }

      if (replaced.length === 0) return res([]);

      if (!this.publishAfterStoreSync || !this._store) this._dataSub.next(map);

      if (this._store) {
        this._store.updateMany(docs, true).subscribe(() => {
          if (this.publishAfterStoreSync) this._dataSub.next(map);
          res(replaced);
        }, err => rej(err));

      } res(replaced);
    })
  }

  protected replaceAll(docs: T[]): Promise<T[]> {
    return new Promise((res, rej) => {
      let map = this.docsToMap(docs);

      if (!this.publishAfterStoreSync || !this._store) this._dataSub.next(map);

      if (this._store) {
        this._store.clear().pipe(switchMap(() => this._store.updateMany(docs, true))).subscribe(() => {
          if (this.publishAfterStoreSync) this._dataSub.next(map);
          res(docs);
        }, err => rej(err));

      } else res(docs);
    })
  }

  protected removeOne(id: IDBValidKey): Promise<T> {
    return new Promise((res, rej) => {
      let map = this.map;
      let doc = map.get(id);

      if (!doc) return res(null);

      map.delete(id);

      if (!this.publishAfterStoreSync || !this._store) this._dataSub.next(map);

      if (this._store) {
        this._store.delete(id).subscribe(() => {
          if (this.publishAfterStoreSync) this._dataSub.next(map);
          res(doc);
        }, err => rej(err));

      } else res(doc);
    })
  }

  protected removeMany(ids: IDBValidKey[]): Promise<T[]>
  protected removeMany(filter: (doc: T) => boolean): Promise<T[]>
  protected removeMany(filter: IDBValidKey[] | ((doc: T) => boolean)): Promise<T[]> {
    return new Promise((res, rej) => {
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

      if (removed.length === 0) return res([]);

      if (!this.publishAfterStoreSync || !this._store) this._dataSub.next(map);

      if (this._store) {
        this._store.deleteMany(removed.map(doc => doc[this.keyPath])).subscribe(() => {
          if (this.publishAfterStoreSync) this._dataSub.next(map);
          res(removed);
        }, err => rej(err));

      } else res(removed);
    })
  }

  protected clear(): Promise<void> {
    return new Promise((res, rej) => {
      let map = new Map<IDBValidKey, T>();
      if (!this.publishAfterStoreSync || !this._store) this._dataSub.next(map);

      if (this._store) {
        this._store.clear().subscribe(() => {
          if (this.publishAfterStoreSync) this._dataSub.next(map);
          res();
        }, err => rej(err));

      } else res();
    });
  }
}