import { Observable, BehaviorSubject } from 'rxjs';
import { filter, map, finalize } from 'rxjs/operators';
import { Unique } from 'tools-box/unique';

export type DocId = string | number;

interface Selector<T> {
  id: string;
  filter: any | ((doc: T) => boolean) | keyof T,
  indexValue?: DocId,
  bs: BehaviorSubject<T>;
  o: Observable<T>;
}

interface MultiSelector<T> {
  id: string;
  filter: any[] | ((doc: T) => boolean) | keyof T,
  indexValues?: DocId[],
  bs: BehaviorSubject<T[]>;
  o: Observable<T[]>;
}

export class MapStore<T> {
  private id: DocId;
  private dataBS = new BehaviorSubject<Map<DocId, T>>(null);
  private selectors: Selector<T>[] = [];
  private multiSelectors: MultiSelector<T>[] = [];
  private indexes: { [key: string]: Map<DocId, DocId> } = {};

  readonly select$ = this.dataBS.pipe(filter(data => !!data), map(data => this.toArray(data)));
  readonly count$ = this.select$.pipe(map(data => data.length));

  constructor(
    id: keyof T,
    data?: T[],
    indexes: (keyof T)[] = []
  ) {
    this.id = <DocId>id;
    if (data) this.dataBS.next(this.toMap(data));

    if (indexes.length > 0) {
      for (let index of indexes)
        if (index !== id) this.addIndex(index, data);
    }
  }

  private get hasIndexes() { return Object.keys(this.indexes).length > 0; }

  private addIndex(key: keyof T, data: T[]) {
    let map = new Map<DocId, DocId>();

    if (data && data.length > 0) {
      for (let entry of data) {
        let id = entry[this.id];
        map.set(<any>entry[key], id);
      }
    }

    this.indexes[<string>key] = map;
  }

  private toArray<U = T>(data: Map<DocId, U>) {
    return Array.from(data.values());
  }

  private toMap(data: T[]) {
    let map = new Map<DocId, T>();
    for (let val of data) map.set(val[this.id], val);
    return map;
  }

  private get map() {
    return this.dataBS.getValue() || new Map<DocId, T>();
  }

  private removeSelector(id: string) {
    let index = this.selectors.findIndex(selector => selector.id === id);
    this.selectors.splice(index, 1);
  }

  private removeMultiSelector(id: string) {
    let index = this.multiSelectors.findIndex(selector => selector.id === id);
    this.multiSelectors.splice(index, 1);
  }

  private completeSelectors() {
    for (let selector of this.selectors)
      selector.bs.complete();
    for (let selector of this.multiSelectors)
      selector.bs.complete();

    this.selectors = [];
    this.multiSelectors = [];
  }

  private updateSelectors(docs: Map<DocId, T>, force = false) {
    for (let selector of this.selectors) {
      let effected = force || !!this._get(selector.filter, docs);
      if (effected) selector.bs.next(this.get(selector.filter, selector.indexValue));
    }

    for (let selector of this.multiSelectors) {
      let effected = force || this._getMany(<any[]>selector.filter, docs).length > 0;
      if (effected) selector.bs.next(this.getMany(<any>selector.filter, selector.indexValues));
    }
  }

  get docs() {
    return this.toArray(this.map);
  }

  get count() {
    return this.map.size;
  }

  private _get(id: DocId, map: Map<DocId, T>): T;
  private _get(index: keyof T, value: DocId, map: Map<DocId, T>): T;
  private _get(filter: (doc: T) => boolean, map: Map<DocId, T>): T;
  private _get(filter: DocId | ((doc: T) => boolean) | keyof T, val: Map<DocId, T> | DocId, map?: Map<DocId, T>): T {
    if (typeof filter === "function") {
      for (const doc of this.toArray(<Map<DocId, T>>val))
        if (filter(doc)) return doc;
    } else if (map) {
      return map.get(this.indexes[<string>filter].get(<DocId>val));
    } else {
      return (<Map<DocId, T>>val).get(<DocId>filter);
    }
  }

  get(id: DocId): T;
  get(index: keyof T, value: DocId): T;
  get(filter: (doc: T) => boolean): T;
  get(filter: DocId | ((doc: T) => boolean) | keyof T, val?: DocId): T {
    return val !== undefined ? this._get(<any>filter, val, this.map) : this._get(<any>filter, this.map);
  }

  has(id: DocId): boolean;
  has(index: keyof T, value: DocId): boolean;
  has(filter: (doc: T) => boolean): boolean;
  has(filter: DocId | ((doc: T) => boolean) | keyof T, val?: DocId): boolean {
    return val !== undefined ? !!this._get(<any>filter, val, this.map) : !!this._get(<any>filter, this.map);
  }

  private _getMany(ids: DocId[], map: Map<DocId, T>): T[];
  private _getMany(index: keyof T, values: DocId[], map: Map<DocId, T>): T[];
  private _getMany(filter: (doc: T) => boolean, map: Map<DocId, T>): T[];
  private _getMany(filter: DocId[] | ((doc: T) => boolean) | keyof T, values: DocId[] | Map<DocId, T>, map?: Map<DocId, T>): T[] {
    let result: T[] = [];

    if (Array.isArray(filter)) {
      for (let id of filter) {
        let doc = map.get(id);
        doc && result.push(doc);
      }
    } else if (typeof filter === 'function') {
      for (const doc of this.toArray(map))
        filter(doc) && result.push(doc);
    } else {
      for (let val of values) {
        let doc = map.get(this.indexes[<string>filter].get(<DocId>val));
        doc && result.push(doc);
      }
    }

    return result;
  }

  getMany(ids: DocId[]): T[];
  getMany(index: keyof T, values: DocId[]): T[];
  getMany(filter: (doc: T) => boolean): T[];
  getMany(filter: DocId[] | ((doc: T) => boolean) | keyof T, values?: DocId[]): T[] {
    return values !== undefined ? this._getMany(<any>filter, values, this.map) : this._getMany(<any>filter, this.map);
  }

  select(id: DocId): Observable<T>;
  select(index: keyof T, value: DocId): Observable<T>;
  select(filter: (doc: T) => boolean): Observable<T>;
  select(filter: DocId | ((doc: T) => boolean) | keyof T, val?: DocId): Observable<T> {
    let id = Unique.Get();
    let doc = this.get(<any>filter, val);
    let bs = new BehaviorSubject<T>(doc);
    let o = bs.pipe(finalize(() => {
      bs.complete();
      this.removeSelector(id);
    }));

    this.selectors.push({ id, filter, bs, o, indexValue: val });
    return o;
  }

  selectMany(id: DocId[]): Observable<T[]>;
  selectMany(index: keyof T, values: DocId[]): Observable<T[]>;
  selectMany(filter: (doc: T) => boolean): Observable<T[]>;
  selectMany(filter: DocId[] | ((doc: T) => boolean) | keyof T, values?: DocId[]): Observable<T[]> {
    let id = Unique.Get();
    let docs = this.getMany(<any>filter, values);
    let bs = new BehaviorSubject<T[]>(docs);
    let o = bs.pipe(finalize(() => {
      bs.complete();
      this.removeMultiSelector(id)
    }));

    this.multiSelectors.push({ id, filter, bs, o, indexValues: values });
    return o;
  }

  protected insert(docs: T[], mode: 'merge' | 'overwrite' | 'skip' = 'skip') {
    let map = this.map;
    for (let doc of docs) {
      if (map.has(doc[this.id])) {
        if (mode === 'skip') continue;
        if (mode === 'merge') {
          let curr = map.get(doc[this.id])
          Object.assign(doc, curr);
          continue;
        }
      }

      map.set(doc[this.id], doc);

      for (let index in this.indexes)
        this.indexes[index].set(doc[index], doc[this.id]);
    }

    this.dataBS.next(map);
    this.updateSelectors(this.toMap(docs));
    return this;
  }

  protected removeOne(id: DocId): MapStore<T>
  protected removeOne(filter: (doc: T) => boolean): MapStore<T>
  protected removeOne(id: DocId | ((doc: T) => boolean)) {
    let map = this.map;
    let doc: T;
    if (typeof id === "function") doc = this.toArray(map).find(_doc => id(_doc));
    else doc = map.get(id);

    if (doc) {
      map.delete(doc[<DocId>this.id]);

      for (let index in this.indexes) this.indexes[index].delete(doc[index]);

      this.dataBS.next(map);
      this.updateSelectors(this.toMap([doc]));
    }

    return this;
  }

  protected removeMany(ids: DocId[]): MapStore<T>
  protected removeMany(filter: (doc: T) => boolean): MapStore<T>
  protected removeMany(ids: DocId[] | ((doc: T) => boolean)) {
    let map = this.map;
    let deleted: Map<DocId, T> = new Map();
    if (Array.isArray(ids)) {
      for (let id of ids) {
        let doc = map.get(id);
        if (doc) {
          deleted.set(id, doc);
          for (let index in this.indexes) this.indexes[index].delete(doc[index]);
          map.delete(id);
        }
      }

    } else {
      for (let doc of this.toArray(map)) {
        if (ids(doc)) {
          deleted.set(doc[this.id], doc);
          for (let index in this.indexes) this.indexes[index].delete(doc[index]);
          map.delete(doc[this.id]);
        }
      }
    }

    if (deleted.size > 0) {
      this.dataBS.next(map);
      this.updateSelectors(deleted);
    }

    return this;
  }

  protected updateOne(id: DocId, update: Partial<T>) {
    let map = this.map;
    let currDoc = map.get(id);

    if (!currDoc)
      return this;

    for (let key of Object.keys(update)) {
      if (this.indexes[key] !== undefined) {
        this.indexes[key].delete(currDoc[key]);
        this.indexes[key].set(update[key], currDoc[this.id]);
      }
    }

    Object.assign(currDoc, update);

    this.dataBS.next(map);
    this.updateSelectors(this.toMap([currDoc]));
    return this;
  }

  protected updateMany(update: Partial<T>[]) {
    let map = this.map;
    let updated = new Map<DocId, T>();

    for (let doc of update) {
      let id = doc[this.id];
      if (!id) continue;
      let currDoc = map.get(id);
      if (!currDoc) continue;

      for (let key of Object.keys(update)) {
        if (this.indexes[key] !== undefined) {
          this.indexes[key].delete(currDoc[key]);
          this.indexes[key].set(update[key], currDoc[this.id]);
        }
      }

      Object.assign(currDoc, doc);
      updated.set(currDoc[this.id], currDoc);
    }

    if (updated.size > 0) {
      this.dataBS.next(map);
      this.updateSelectors(updated);
    }

    return this;
  }

  protected replaceOne(doc: T, id?: DocId) {
    id = id || doc[this.id];
    let map = this.map;
    let oldDoc = map.get(id);

    if (oldDoc) {
      map.delete(id);
      map.set(doc[this.id], doc);

      for (let index in this.indexes) {
        this.indexes[index].delete(oldDoc[index]);
        this.indexes[index].set(doc[index], doc[this.id]);
      }

      this.dataBS.next(map);
      this.updateSelectors(this.toMap([oldDoc, doc]));
    }

    return this;
  }

  protected replaceAll(docs: T[]) {
    let map = this.toMap(docs);

    let indexes = Object.keys(this.indexes) as (keyof T)[];
    this.indexes = {};
    for (let index of indexes) this.addIndex(index, docs);

    this.dataBS.next(map);
    this.updateSelectors(null, true);
    return this;
  }

  protected clear() {
    this.dataBS.next(new Map());

    let indexes = Object.keys(this.indexes) as (keyof T)[];
    this.indexes = {};
    for (let index of indexes) this.addIndex(index, null);

    this.updateSelectors(null, true);
    this.completeSelectors();
    return this;
  }
}