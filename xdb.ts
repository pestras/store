import { Observable, of, BehaviorSubject, forkJoin, throwError } from "rxjs";
import { filter, switchMap, distinctUntilChanged } from "rxjs/operators";

/**
 * XDB Abstract Class
 * --------------------------------------------------------------------------------------------------------------
 */
export abstract class XDB {
  protected _stores = new Map<string, Store | ListStore<any>>();
  protected _openSub = new BehaviorSubject(false);
  protected _db: IDBDatabase;

  readonly open$ = this._openSub.pipe(distinctUntilChanged());

  private static Connections = new Map<string, XDB>();

  constructor(readonly name: string, protected _v: number = 1) {
    if (!XDB.Supported) {
      this.onError(new Error('indexeddb not supported'));
      return null;
    }

    if (XDB.Connections.has(this.name)) {
      let db = XDB.Connections.get(this.name);
      if (this._v !== db.version) db._v = this._v;
      return db;
    } else {
      XDB.Connections.set(this.name, this);
    }
  }

  static get Supported() { return !!window.indexedDB; }

  static CloseAll(force = false) {
    for (let db of XDB.Connections.values()) db.close();
  }

  static DropAll() {
    let obs: Observable<void>[] = [];
    for (let db of XDB.Connections.values()) obs.push(db.drop());
    return forkJoin(obs);
  }

  get isOpen() { return this._openSub.getValue(); }
  get version() { return this._v; }

  updateVersion(val: number) {
    if (this._v === val) return of(null);
    if (this.isOpen) {
      this.close();
      this._v = val;
      return this.open();
    } else {
      return of(null);
    }
  }

  protected abstract onUpgrade(version: number): void;

  protected abstract onError(err: Error): void;

  protected abstract onBlock(): void;

  open() {
    return new Observable<void>(subscriber => {
      if (this.isOpen) {
        subscriber.next();
        subscriber.complete();
        return;
      }

      let req = indexedDB.open(this.name, this.version);

      req.addEventListener('success', () => {
        this._db = req.result;
        this._openSub.next(true);
        subscriber.next();
        subscriber.complete();
      });

      req.addEventListener('error', () => {
        this._openSub.next(false);
        this.onError(req.error);
        subscriber.error(req.error);
        subscriber.complete();
      });

      req.addEventListener('blocked', () => {
        this._openSub.next(false);
        this.onBlock();
        subscriber.error(new Error(`db ${self.name} is blocked`));
        subscriber.complete();
      });

      req.addEventListener('upgradeneeded', (e: IDBVersionChangeEvent) => {
        this._db = req.result;
        this.onUpgrade(e.oldVersion);
      });
    });
  }

  close() {
    this._db && this._db.close();
    this._db = null;
    this._openSub.next(false);
  }

  drop() {
    this.close();
    XDB.Connections.delete(this.name);
    return new Observable<void>(subscriber => {
      let req = indexedDB.deleteDatabase(name);

      req.addEventListener('success', () => {
        subscriber.next();
        subscriber.complete();
      });

      req.addEventListener('error', () => {
        subscriber.error(req.error);
        subscriber.complete();
      });
    });
  }

  createStore(name: string, keyPath?: string) {
    if (this._db.objectStoreNames.contains(name)) return;
    if (!keyPath) this._db.createObjectStore(name);
    else this._db.createObjectStore(name, { keyPath: keyPath });
  }

  dropStore(name: string) {
    if (this.isOpen) this._db.deleteObjectStore(name);
  }

  transaction(storeNames: string[], mode?: IDBTransactionMode) {
    return this.isOpen ? of(this._db.transaction(storeNames, mode)) : throwError(new Error(`${this.name} db is closed`));
  }

  transComplete() {
    return (source: Observable<IDBTransaction>) => {
      return new Observable<void>(subscriber => {
        return source.subscribe({
          next(trans) {
            trans.oncomplete = function () {
              subscriber.next();
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
          error(err) { subscriber.error(err); subscriber.complete() },
          complete() { subscriber.complete() }
        });
      });
    }
  }
}


/**
 * Store Class
 * --------------------------------------------------------------------------------------------------------------
 */
export class Store {
  protected _keys = new Set<IDBValidKey>();
  protected _readySub = new BehaviorSubject<boolean>(false);

  readonly ready$ = this._readySub.pipe(filter(ready => ready), distinctUntilChanged());

  constructor(protected _db: XDB, readonly name: string) {
    this._db.open$
      .pipe(filter(open => open), switchMap(() => this._db.transaction([this.name], 'readonly')))
      .subscribe(trans => {
        let req = trans.objectStore(this.name).getAllKeys();

        req.addEventListener('success', () => {
          this._keys = new Set(req.result);
          this._readySub.next(true);
        });

        req.addEventListener('error', () => {
          throw req.error;
        });
      });
  }

  get ready() { return this._readySub.getValue(); }

  drop() {
    if (this._db.isOpen) this._db.dropStore(this.name);
  }

  hasKey(key: IDBValidKey) { return this._keys.has(key); }

  get<T = any>(id: IDBValidKey) {
    return this._db.transaction([this.name], 'readonly')
      .pipe(switchMap(trans => {
        return new Observable<T>(subscriber => {
          let req = trans.objectStore(this.name).get(id);

          req.addEventListener('success', () => {
            subscriber.next(req.result);
            subscriber.complete();
          });

          req.addEventListener('error', () => {
            subscriber.error(req.error);
            subscriber.complete();
          });
        });
      }));
  }

  update<T = any>(key: IDBValidKey, doc: Partial<T>, upsert?: boolean): Observable<void>;
  update<T = any>(key: IDBValidKey, doc: Partial<T>, upsert?: boolean, trans?: IDBTransaction): Observable<IDBTransaction>;
  update<T = any>(key: IDBValidKey, doc: Partial<T>, upsert = true, trans?: IDBTransaction): Observable<any> {
    let trans$ = trans ? of(trans) : this._db.transaction([this.name], 'readwrite');
    return trans$.pipe(switchMap(trans => {
      return new Observable<any>(subscriber => {
        let os = trans.objectStore(this.name);
        let req: IDBRequest;

        if (this.hasKey(key)) req = os.put(doc, key);
        else if (upsert) req = os.add(doc, key);
        else {
          subscriber.next(trans);
          subscriber.complete();
        }

        if (trans) {
          subscriber.next(trans);
          subscriber.complete();
          return;
        }

        req.addEventListener('success', () => {
          this._keys.add(key);
          subscriber.next();
          subscriber.complete();
        });

        req.addEventListener('error', () => {
          subscriber.error(req.error);
          subscriber.complete();
        });
      });
    }));
  }

  delete(key: IDBValidKey): Observable<void>;
  delete(key: IDBValidKey, trans?: IDBTransaction): Observable<IDBTransaction>;
  delete(key: IDBValidKey, trans?: IDBTransaction): Observable<any> {
    let trans$ = trans ? of(trans) : this._db.transaction([this.name], 'readwrite');
    return trans$.pipe(switchMap(trans => {
      if (!this.hasKey(key)) return of(trans);
      return new Observable<any>(subscriber => {
        let req = trans.objectStore(this.name).delete(key);

        if (trans) {
          subscriber.next(trans);
          subscriber.complete();
          return;
        }

        req.addEventListener('success', () => {
          this._keys.delete(key);
          subscriber.next();
          subscriber.complete();
        });

        req.addEventListener('error', () => {
          subscriber.error(req.error);
          subscriber.complete();
        });
      });
    }));
  }

  clear(): Observable<void>;
  clear(trans: IDBTransaction): Observable<IDBTransaction>;
  clear(trans?: IDBTransaction): Observable<any> {
    let trans$ = trans ? of(trans) : this._db.transaction([this.name], 'readwrite');
    return trans$.pipe(switchMap(trans => {
      return new Observable<any>(subscriber => {
        let self = this;
        let req = trans.objectStore(this.name).clear();

        if (trans) {
          subscriber.next(trans);
          subscriber.complete();
          return;
        }

        req.addEventListener('success', () => {
          this._keys.clear();
          subscriber.next();
          subscriber.complete();
        });

        req.addEventListener('error', () => {
          subscriber.error(req.error);
          subscriber.complete();
        });
      });
    }));
  }
}



/**
 * List Store Class
 * --------------------------------------------------------------------------------------------------------------
 */
export class ListStore<T> extends Store {

  constructor(_db: XDB, name: string, readonly keyPath: IDBValidKey) {
    super(_db, name);
  }

  get<U = T>(id: IDBValidKey) { return super.get<U>(id); }

  getAll() {
    return this._db.transaction([this.name], 'readonly').pipe(switchMap(trans => {
      return new Observable<T[]>(subscriber => {
        let req = trans.objectStore(this.name).getAll();

        req.addEventListener('success', () => {
          subscriber.next();
          subscriber.complete();
        });

        req.addEventListener('error', () => {
          subscriber.error(req.error);
          subscriber.complete();
        });
      });
    }));
  }

  update<U = T>(key: IDBValidKey, doc: U, upsert?: boolean): Observable<void>
  update<U = T>(key: IDBValidKey, doc: U, upsert?: boolean, trans?: IDBTransaction): Observable<IDBTransaction>
  update<U = T>(key: IDBValidKey, doc: U, upsert = true, trans?: IDBTransaction): Observable<any> {
    let trans$ = trans ? of(trans) : this._db.transaction([this.name], 'readwrite');
    return trans$.pipe(switchMap(trans => {
      return new Observable<any>(subscriber => {
        let os = trans.objectStore(this.name);
        let req: IDBRequest;
        doc[<string>this.keyPath] = key;

        if (this.hasKey(key)) req = os.put(doc);
        else if (upsert) req = os.add(doc);
        else {
          subscriber.next(trans);
          subscriber.complete();
        }

        if (trans) {
          subscriber.next(trans);
          subscriber.complete();
          return;
        }

        req.addEventListener('success', () => {
          this._keys.add(key);
          subscriber.next();
          subscriber.complete();
        });

        req.addEventListener('error', () => {
          subscriber.error(req.error);
          subscriber.complete();
        });
      });
    }))
  }

  updateMany(docs: T[], upsert?: boolean): Observable<void>;
  updateMany(docs: T[], upsert?: boolean, trans?: IDBTransaction): Observable<IDBTransaction>;
  updateMany(docs: T[], upsert = true, trans?: IDBTransaction): Observable<any> {
    let trans$ = trans ? of(trans) : this._db.transaction([this.name], 'readwrite');
    return trans$.pipe(switchMap(trans => {
      return new Observable<any>(subscriber => {
        for (let doc of docs)
          if (this.hasKey(doc[<string>this.keyPath])) trans.objectStore(this.name).put(doc);
          else if (upsert) trans.objectStore(this.name).add(doc);

        if (trans) {
          subscriber.next(trans);
          subscriber.complete();
          return;
        }

        trans.addEventListener('complete', () => {
          if (upsert) for (let doc of docs) this._keys.add(doc[<string>this.keyPath]);
          subscriber.next();
          subscriber.complete();
        });

        trans.addEventListener('error', () => {
          subscriber.error(trans.error);
          subscriber.complete();
        });
      });
    }));
  }

  deleteMany(keys: IDBValidKey[]): Observable<void>;
  deleteMany(keys: IDBValidKey[], trans?: IDBTransaction): Observable<IDBTransaction>;
  deleteMany(keys: IDBValidKey[], trans?: IDBTransaction): Observable<any> {
    let trans$ = trans ? of(trans) : this._db.transaction([this.name], 'readwrite');
    return trans$.pipe(switchMap(trans => {
      return new Observable<any>(subscriber => {
        keys = keys.filter(key => !this.hasKey(key));
        for (let key of keys) trans.objectStore(this.name).delete(key);

        if (trans) {
          subscriber.next(trans);
          subscriber.complete();
          return;
        }

        trans.addEventListener('complete', () => {
          for (let key of keys) this._keys.delete(key);
          subscriber.next();
          subscriber.complete();
        });

        trans.addEventListener('error', () => {
          subscriber.error(trans.error);
          subscriber.complete();
        });
      });
    }));
  }
}