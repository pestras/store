import { Observable, of, BehaviorSubject, throwError, Subscriber, onErrorResumeNext, Subject } from "rxjs";
import { filter, map, switchMap, distinctUntilChanged } from "rxjs/operators";

export class Store {
  protected _keys = new Set<IDBValidKey>();
  protected _readySub = new BehaviorSubject<boolean>(false);

  readonly ready$ = this._readySub.pipe(filter(ready => ready));

  constructor(
    protected _db: XDB,
    readonly name: string
  ) {
    this._db.transaction(this.name, 'readonly').subscribe(trans => {
      let self = this;
      let req = trans.objectStore(this.name).getAllKeys();
      req.onsuccess = function (this: Store) {
        this._keys = new Set(req.result);
        this._readySub.next(true);
        self._db.keepAlive || self._db.close();
      }.bind(this);
      req.onerror = function () {
        console.log(req.error);
        self._db.keepAlive || self._db.close();
      }
    });
  }

  get ready() { return this._readySub.getValue(); }

  hasKey(key: IDBValidKey) { return this._keys.has(key); }

  get<T = any>(id: IDBValidKey) {
    return this._db.open().pipe(
      switchMap(() => this._db.transaction(this.name, 'readonly')),
      switchMap(trans => {
        return new Observable<T>(subscriber => {
          let self = this;
          let req = trans.objectStore(this.name).get(id);

          req.onsuccess = function () {
            subscriber.next(req.result);
            self._db.keepAlive || self._db.close();
            subscriber.complete();
          }
          req.onerror = function () {
            subscriber.error(req.error);
            self._db.keepAlive || self._db.close();
            subscriber.complete();
          }
        });
      }))
  }

  update<T = any>(key: IDBValidKey, doc: Partial<T>, upsert?: boolean): Observable<boolean>;
  update<T = any>(key: IDBValidKey, doc: Partial<T>, upsert?: boolean, trans?: IDBTransaction): Observable<IDBTransaction>;
  update<T = any>(key: IDBValidKey, doc: Partial<T>, upsert = true, trans?: IDBTransaction): Observable<any> {
    let single = !trans;
    let trans$ = trans ? of(trans) : this._db.transaction(this.name, 'readwrite');
    return this._db.open().pipe(
      switchMap(() => trans$),
      switchMap(trans => {
        return new Observable<any>(subscriber => {
          let self = this;
          let os = trans.objectStore(this.name);
          let req: IDBRequest;

          if (this.hasKey(key)) req = os.put(doc, key);
          else if (upsert) os.add(doc, key);
          else {
            subscriber.next(single ? true : trans);
            subscriber.complete();
          }

          if (!single) return subscriber.next(trans);

          req.onsuccess = function () {
            self._keys.add(key);
            self._db.keepAlive || self._db.close();
            subscriber.next(true);
            subscriber.complete();
          };

          req.onerror = function () {
            subscriber.error(req.error);
            self._db.keepAlive || self._db.close();
            subscriber.complete();
          }
        });
      }));
  }

  delete(key: IDBValidKey): Observable<boolean>;
  delete(key: IDBValidKey, trans?: IDBTransaction): Observable<IDBTransaction>;
  delete(key: IDBValidKey, trans?: IDBTransaction): Observable<any> {
    let single = !trans;
    let trans$ = trans ? of(trans) : this._db.transaction(this.name, 'readwrite');
    return this._db.open().pipe(
      switchMap(() => trans$),
      switchMap(trans => {
        if (!this.hasKey(key)) return of(trans);
        return new Observable<any>(subscriber => {
          let self = this;
          let req = trans.objectStore(this.name).delete(key);

          if (!single) return subscriber.next(trans);

          req.onsuccess = function () {
            self._keys.delete(key);
            self._db.keepAlive || self._db.close();
            subscriber.next(true);
            subscriber.complete();
          };

          req.onerror = function () {
            subscriber.error(req.error);
            self._db.keepAlive || self._db.close();
            subscriber.complete();
          }
        });
      }));
  }

  clear(): Observable<boolean>;
  clear(trans: IDBTransaction): Observable<IDBTransaction>;
  clear(trans?: IDBTransaction): Observable<any> {
    let single = !trans;
    let trans$ = trans ? of(trans) : this._db.transaction(this.name, 'readwrite');
    return this._db.open().pipe(
      switchMap(() => trans$),
      switchMap(trans => {
        return new Observable<any>(subscriber => {
          let self = this;
          let req = trans.objectStore(this.name).clear();

          if (!single) return subscriber.next(trans);

          req.onsuccess = function () {
            self._keys.clear();
            self._db.keepAlive || self._db.close();
            subscriber.next(true);
            subscriber.complete();
          };

          req.onerror = function () {
            subscriber.error(req.error);
            self._db.keepAlive || self._db.close();
            subscriber.complete();
          }
        });
      }))
  }
}

export class ListStore<T> extends Store {

  constructor(_db: XDB, name: string, readonly keyPath: IDBValidKey) {
    super(_db, name);

    this._db.transaction(this.name).subscribe(trans => {
      trans.objectStore(this.name).createIndex(<string>this.keyPath, <string>this.keyPath, { unique: true });
    })
  }

  get<U = T>(id: IDBValidKey) { return super.get<U>(id); }

  getAll() {
    return this._db.open().pipe(
      switchMap(() => this._db.transaction(this.name, 'readonly')),
      switchMap(trans => {
        return new Observable<T[]>(subscriber => {
          let self = this;
          let req = trans.objectStore(this.name).getAll();

          req.onsuccess = function () {
            subscriber.next(req.result);
            self._db.keepAlive || self._db.close();
            subscriber.complete();
          }

          req.onerror = function () {
            subscriber.error(req.error);
            self._db.keepAlive || self._db.close();
            subscriber.complete();
          }
        });
      }));
  }

  update<U = T>(key: IDBValidKey, doc: U, upsert?: boolean): Observable<boolean>
  update<U = T>(key: IDBValidKey, doc: U, upsert?: boolean, trans?: IDBTransaction): Observable<IDBTransaction>
  update<U = T>(key: IDBValidKey, doc: U, upsert = true, trans?: IDBTransaction): Observable<any> {
    let single = !trans;
    let trans$ = trans ? of(trans) : this._db.transaction(this.name, 'readwrite');
    return this._db.open().pipe(
      switchMap(() => trans$),
      switchMap(trans => {
        return new Observable<any>(subscriber => {
          let self = this;
          let os = trans.objectStore(this.name);
          let req: IDBRequest;
          doc[<string>this.keyPath] = key;

          if (this.hasKey(key)) req = os.put(doc);
          else if (upsert) os.add(doc);
          else {
            subscriber.next(single ? true : trans);
            single && !this._db.keepAlive && this._db.close();
            subscriber.complete();
          }

          if (!single) return subscriber.next(trans);

          req.onsuccess = function () {
            self._keys.add(key);
            subscriber.next(true);
            self._db.keepAlive || self._db.close();
            subscriber.complete();
          }

          req.onerror = function () {
            subscriber.error(req.error);
            self._db.keepAlive || self._db.close();
            subscriber.complete();
          }
        });
      }))
  }

  updateMany(docs: T[], upsert?: boolean): Observable<boolean>;
  updateMany(docs: T[], upsert?: boolean, trans?: IDBTransaction): Observable<IDBTransaction>;
  updateMany(docs: T[], upsert = true, trans?: IDBTransaction): Observable<any> {
    let single = !trans;
    let trans$ = trans ? of(trans) : this._db.transaction(this.name, 'readwrite');
    return this._db.open().pipe(
      switchMap(() => trans$),
      switchMap(trans => {
        return new Observable<any>(subscriber => {
          for (let doc of docs)
            if (this.hasKey(doc[<string>this.keyPath])) trans.objectStore(this.name).put(doc);
            else if (upsert) trans.objectStore(this.name).add(doc);

          if (!single) return subscriber.next(trans);

          let self = this;
          trans.oncomplete = function () {
            if (upsert) for (let doc of docs) self._keys.add(doc[<string>self.keyPath]);
            subscriber.next(true);
            self._db.keepAlive || self._db.close();
            subscriber.complete();
          }

          trans.onerror = function () {
            subscriber.error(trans.error);
            self._db.keepAlive || self._db.close();
            subscriber.complete();
          }
        });
      }));
  }

  deleteMany(keys: IDBValidKey[]): Observable<boolean>;
  deleteMany(keys: IDBValidKey[], trans?: IDBTransaction): Observable<IDBTransaction>;
  deleteMany(keys: IDBValidKey[], trans?: IDBTransaction): Observable<any> {
    let single = !trans;
    let trans$ = trans ? of(trans) : this._db.transaction(this.name, 'readwrite');
    return this._db.open().pipe(
      switchMap(() => trans$),
      switchMap(trans => {
        return new Observable<any>(subscriber => {
          let self = this;

          keys = keys.filter(key => !self.hasKey(key));
          for (let key of keys) trans.objectStore(this.name).delete(key);

          if (!single) return subscriber.next(trans);

          trans.oncomplete = function () {
            for (let key of keys) self._keys.delete(key);
            subscriber.next(true);
            self._db.keepAlive || self._db.close();
            subscriber.complete();
          }

          trans.onerror = function () {
            subscriber.error(trans.error);
            self._db.keepAlive || self._db.close();
            subscriber.complete();
          }
        });
      }));
  }
}

export interface XDBOptions {
  keepAlive: boolean;
}

export class XDB {
  protected _stores = new Map<string, Store>();
  protected _listStores = new Map<string, ListStore<any>>();
  protected _upgradeSub = new Subject<number>();
  protected _blockSub = new Subject<void>();
  protected _errorSub = new Subject<any>();
  protected _open = false;
  protected _healthySub = new BehaviorSubject<boolean>(null);
  protected _db: IDBDatabase;

  readonly healthy$ = this._healthySub.pipe(filter(v => v !== null), distinctUntilChanged());
  readonly ready$ = this.healthy$.pipe(filter(v => v));
  readonly upgrade$ = this._upgradeSub.asObservable();
  readonly block$ = this._blockSub.asObservable();
  readonly error$ = this._errorSub.asObservable();

  private static Connections = new Map<string, XDB>();

  constructor(readonly name: string, protected _v: number = 1, readonly keepAlive = false) {
    if (!XDB.Supported) {
      this._healthySub.next(false);
      this._errorSub.next('indexeddb not supported');
    }
    if (XDB.Connections.has(this.name)) {
      let db = XDB.Connections.get(this.name);
      if (this._v !== db.version) db._v = this._v;
      return db;
    } else {
      XDB.Connections.set(this.name, this);
      this.open().subscribe(() => {
        this.keepAlive || this.close();
        this._healthySub.next(true);
      }, () => this._healthySub.next(false))
    }
  }

  static get Supported() { return !!window.indexedDB; }

  static CloseAll() {
    for (let db of XDB.Connections.values()) db.close();
  }

  get isOpen() { return this._open; }
  get version() { return this._v; }
  set version(val: number) { this._v = val; }

  open() {
    return new Observable<boolean>(subscriber => {
      if (this._db && this._open) {
        subscriber.next(true);
        subscriber.complete();
        return;
      }

      let req = indexedDB.open(this.name, this.version);
      let self = this;

      req.onsuccess = function (e: Event) {
        self._open = true;
        self._db = req.result;
        subscriber.next(true);
        subscriber.complete();
      }

      req.onerror = function (e: Event) {
        self._open = false;
        subscriber.error({ name: `error opening ${self.name} db`, error: req.error });
        self._errorSub.next({ name: `error opening ${self.name} db`, error: req.error });
        subscriber.complete();
      }

      req.onblocked = function () {
        self._open = false;
        subscriber.error({ name: `db ${self.name} is blocked` });
        self._blockSub.next();
        subscriber.complete();
      }

      req.onupgradeneeded = function (e) {
        self._upgradeSub.next(e.oldVersion);
      }
    });
  }

  close() {
    this._db && this._db.close();
    this._db = null;
    this._open = false;
  }

  drop() {
    this.close();
    XDB.Connections.delete(this.name);
    return new Observable<void>(subscriber => {
      let req = indexedDB.deleteDatabase(name);

      req.onsuccess = function () {
        subscriber.next();
        subscriber.complete();
      }

      req.onerror = function () {
        subscriber.error(req.error);
        subscriber.complete();
      }
    })
  }

  store(name: string) {
    if (this._stores.has(name)) return of(this._stores.get(name));
    if (this._listStores.has(name)) return throwError(name + ' is already exists as a list store');

    return this.open().pipe(switchMap(db => {
      return new Observable<Store>(subscriber => {
        let self = this;
        if (!this._db.objectStoreNames.contains(name)) {
          let os = this._db.createObjectStore(name);
          os.transaction.oncomplete = function () {
            let store = new Store(self, name);
            self._stores.set(name, store);
            if (!self.keepAlive) self.close();
            subscriber.next(store);
            subscriber.complete();
          }
        } else {
          let store = new Store(self, name);
          self._stores.set(name, store);
          if (!this.keepAlive) this.close();
          subscriber.next(store);
          subscriber.complete();
        }
      });
    }));
  }

  listStore<T = any>(name: string, keyPath: IDBValidKey) {
    if (this._listStores.has(name)) return of(this._listStores.get(name));
    if (this._stores.has(name)) return throwError(name + ' is already exists as a store');

    return this.open().pipe(switchMap(db => {
      return new Observable<ListStore<T>>(subscriber => {
        let self = this;
        if (!this._db.objectStoreNames.contains(name)) {
          let os = this._db.createObjectStore(name);
          os.transaction.oncomplete = function () {
            let store = new ListStore<T>(self, name, keyPath);
            self._listStores.set(name, store);
            if (!self.keepAlive) self.close();
            subscriber.next(store);
            subscriber.complete();
          }
        } else {
          let store = new ListStore<T>(this, name, keyPath);
          self._listStores.set(name, store);
          if (!this.keepAlive) this.close();
          subscriber.next(store);
          subscriber.complete();
        }
      });
    }));
  }

  transaction(storeNames: string | string[], mode?: IDBTransactionMode) {
    return this.open().pipe(map(() => this._db.transaction(storeNames, mode)));
  }

  transComplete() {
    let self = this;
    return function (source: Observable<IDBTransaction>) {
      return new Observable<void>(subscriber => {
        return source.subscribe({
          next(trans) {
            trans.oncomplete = function () {
              subscriber.next();
              self.keepAlive || self.close();
              subscriber.complete();
            }
            trans.onerror = function () {
              subscriber.error(trans.error);
              subscriber.complete();
            }
            trans.onabort = function () {
              subscriber.error('aborted');
              subscriber.complete();
            }
          },
          error(err) { subscriber.error(err) },
          complete() { subscriber.complete() }
        });
      });
    }
  }

  dropStore(name: string) {
    this._db.deleteObjectStore(name);
  }
}