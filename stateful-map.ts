import { Observable, BehaviorSubject } from 'rxjs';
import { filter, map, finalize } from 'rxjs/operators';
import { Unique } from 'tools-box/unique';

export type DocId = string | number;

export class DocState {
  loading = false;
  synced = true;
  selected = false;
}

export class Doc<T, U extends DocState> {
  id: DocId;
  active = false;
  doc: T;
  state: U;
  lastChange = new Date();

  constructor(id: DocId, docs: T, state: U) {
    this.id = id;
    this.doc = docs;
    this.state = state;
    this.lastChange = new Date();
  }
}

interface Selector<T, U extends DocState> {
  id: string;
  filter: any | ((doc: Doc<T, U>) => boolean) | keyof T;
  indexValue?: DocId,
  bs: BehaviorSubject<Doc<T, U>>;
  o: Observable<Doc<T, U>>;
}

interface MultiSelector<T, U extends DocState> {
  id: string;
  filter: any[] | ((doc: Doc<T, U>) => boolean) | keyof T;
  indexValues?: DocId[];
  bs: BehaviorSubject<Doc<T, U>[]>;
  o: Observable<Doc<T, U>[]>;
}

export class StatefulMapStore<T, U extends DocState = DocState> {
  private id: DocId;
  private dataBS = new BehaviorSubject<Map<DocId, Doc<T, U>>>(null);
  private loadingBS = new BehaviorSubject<boolean>(true);
  private selectors: Selector<T, U>[] = [];
  private multiSelectors: MultiSelector<T, U>[] = [];
  private indexes: { [key: string]: Map<DocId, DocId> } = {};
  private activeBS = new BehaviorSubject<Doc<T, U>>(null);
  private StateFac: new() => U;

  readonly select$ = this.dataBS.pipe(filter(data => !!data), map(data => this.toArray(data)));
  readonly count$ = this.select$.pipe(map(data => data.length));
  readonly active$ = this.activeBS.asObservable();
  readonly loading$ = this.loadingBS.asObservable();

  constructor(
    id: keyof T,
    data?: T[],
    conf: { indexes?: (keyof T)[], stateFac?: new() => U } = {}
  ) {
    this.id = <DocId>id;
    if (data) this.dataBS.next(this.toMap(data));

    if (conf.stateFac) this.StateFac = conf.stateFac;
    else this.StateFac = <new() => U>DocState;

    if (conf.indexes && conf.indexes.length > 0) {
      for (let index of conf.indexes)
        if (index !== id) this.addIndex(index, data);
    }
  }

  private toArray(data: Map<DocId, Doc<T, U>>) {
    return Array.from(data.values());
  }

  private toMap(data: T[]) {
    let map = new Map<DocId, Doc<T, U>>();
    for (let doc of data) {
      map.set(
        doc[this.id],
        new Doc<T, U>(doc[this.id], doc, new this.StateFac())
      );
    }
    return map;
  }

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

  private get map() {
    return this.dataBS.getValue() || new Map<DocId, Doc<T, U>>();
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

  private updateSelectors(docs: Map<DocId, Doc<T, U>>, force = false) {
    for (let selector of this.selectors) {
      let effected = force || !!this._get(docs, selector.filter);
      if (effected) selector.bs.next(this.get(selector.filter, selector.indexValue));
    }

    for (let selector of this.multiSelectors) {
      let effected = force || this._getMany(docs, <any[]>selector.filter).length > 0;
      if (effected) selector.bs.next(this.getMany(<any>selector.filter, selector.indexValues));
    }
  }

  private get activeId() {
    return this.activeBS.getValue()?.id;
  }

  get docs() {
    return this.toArray(this.map);
  }

  get count() {
    return this.map.size;
  }

  get active() {
    return this.activeBS.getValue();
  }

  protected set loading(val: boolean) { this.loadingBS.next(val); }

  private _get(map: Map<DocId, Doc<T, U>>, id: DocId): Doc<T, U>;
  private _get(map: Map<DocId, Doc<T, U>>, filter: (doc: Doc<T, U>) => boolean): Doc<T, U>;
  private _get(map: Map<DocId, Doc<T, U>>, index: keyof T, value: DocId): Doc<T, U>;
  private _get(map: Map<DocId, Doc<T, U>>, filter: DocId | ((doc: Doc<T, U>) => boolean) | keyof T, val?: DocId): Doc<T, U> {
    if (typeof filter === "function") {
      for (const doc of this.toArray(map))
        if (filter(doc)) return doc;
    } else if (val) {
      return map.get(this.indexes[<string>filter].get(val));
    } else {
      return map.get(<DocId>filter);
    }
  }

  get(id: DocId): Doc<T, U>;
  get(index: keyof T, value: DocId): Doc<T, U>;
  get(filter: (doc: Doc<T, U>) => boolean): Doc<T, U>;
  get(filter: DocId | ((doc: Doc<T, U>) => boolean) | keyof T, val?: DocId): Doc<T, U> {
    return val !== undefined ? this._get(this.map, <any>filter, val) : this._get(this.map, <any>filter);
  }

  has(id: DocId): boolean;
  has(index: keyof T, value: DocId): boolean;
  has(filter: (doc: Doc<T, U>) => boolean): boolean;
  has(filter: DocId | ((doc: Doc<T, U>) => boolean) | keyof T, val?: DocId): boolean {
    return val !== undefined ? !!this._get(this.map, <any>filter, val) : !!this._get(this.map, <any>filter);
  }

  private _getMany(map: Map<DocId, Doc<T, U>>, ids: DocId[]): Doc<T, U>[];
  private _getMany(map: Map<DocId, Doc<T, U>>, filter: (doc: Doc<T, U>) => boolean): Doc<T, U>[];
  private _getMany(map: Map<DocId, Doc<T, U>>, index: keyof T, values: DocId[]): Doc<T, U>[];
  private _getMany(map: Map<DocId, Doc<T, U>>, filter: DocId[] | ((doc: Doc<T, U>) => boolean) | keyof T, values?: DocId[]): Doc<T, U>[] {
    let result: Doc<T, U>[] = [];

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

  getMany(ids: DocId[]): Doc<T, U>[];
  getMany(filter: (doc: Doc<T, U>) => boolean): Doc<T, U>[];
  getMany(index: keyof T, values: DocId[]): Doc<T, U>[];
  getMany(filter: DocId[] | ((doc: Doc<T, U>) => boolean) | keyof T, values?: DocId[]): Doc<T, U>[] {
    return values !== undefined ? this._getMany(this.map, <any>filter, values) : this._getMany(this.map, <any>filter);
  }

  select(id: DocId): Observable<Doc<T, U>>;
  select(filter: (doc: Doc<T, U>) => boolean): Observable<Doc<T, U>>;
  select(index: keyof T, value: DocId): Observable<Doc<T, U>>;
  select(filter: DocId | ((doc: Doc<T, U>) => boolean) | keyof T, val?: DocId): Observable<Doc<T, U>> {
    let id = Unique.Get();
    let doc = this.get(<any>filter, val);
    let bs = new BehaviorSubject<Doc<T, U>>(doc);
    let o = bs.pipe(finalize(() => {
      bs.complete();
      this.removeSelector(id);
    }));

    this.selectors.push({ id, filter, bs, o, indexValue: val });
    return o;
  }

  selectMany(id: DocId[]): Observable<Doc<T, U>[]>;
  selectMany(filter: (doc: Doc<T, U>) => boolean): Observable<Doc<T, U>[]>;
  selectMany(index: keyof T, values: DocId[]): Observable<Doc<T, U>[]>;
  selectMany(filter: DocId[] | ((doc: Doc<T, U>) => boolean) | keyof T, values?: DocId[]): Observable<Doc<T, U>[]> {
    let id = Unique.Get();
    let docs = this.getMany(<any>filter, values);
    let bs = new BehaviorSubject<Doc<T, U>[]>(docs);
    let o = bs.pipe(finalize(() => {
      bs.complete();
      this.removeMultiSelector(id)
    }));

    this.multiSelectors.push({ id, filter, bs, o, indexValues: values });
    return o;
  }

  protected setActive(id: DocId): StatefulMapStore<T, U>
  protected setActive(index: keyof T, value: DocId): StatefulMapStore<T, U>
  protected setActive(id: DocId | keyof T = null, value?: DocId): StatefulMapStore<T, U> {
    if (!id) {
      this.activeBS.next(null);
      return this;
    }

    let doc: Doc<T, U>;
    if (value) doc = this.map.get(this.indexes[<string>id].get(value));
    else doc = this.map.get(<DocId>id);

    if (!doc) return this;

    doc.active = true;
    this.activeBS.next(doc);
    return this;
  }

  protected insert(docs: T[], mode: 'merge' | 'overwrite' | 'skip' = 'skip'): StatefulMapStore<T, U> {
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

      map.set(doc[this.id], new Doc<T, U>(doc[this.id], doc, new this.StateFac()));

      for (let index in this.indexes)
        this.indexes[index].set(doc[index], doc[this.id]);
    }

    this.dataBS.next(map);
    this.updateSelectors(this.toMap(docs));
    return this;
  }

  protected removeOne(id: DocId): StatefulMapStore<T, U>
  protected removeOne(filter: (doc: T) => boolean): StatefulMapStore<T, U>
  protected removeOne(id: DocId | ((doc: T) => boolean)): StatefulMapStore<T, U> {
    let map = this.map;
    let doc: Doc<T, U>;
    let activeId = this.activeId;
    
    if (typeof id === "function") doc = this.toArray(map).find(_doc => (<Function>id)(_doc.doc));
    else doc = map.get(id);

    if (!doc) return this;

    map.delete(doc.id);
    this.dataBS.next(map);
    if (doc.id = activeId) this.activeBS.next(null);
    this.updateSelectors(map);
    return this;
  }

  protected removeMany(ids: DocId[]): StatefulMapStore<T, U>
  protected removeMany(filter: (doc: Doc<T, U>) => boolean): StatefulMapStore<T, U>
  protected removeMany(ids: DocId[] | ((doc: Doc<T, U>) => boolean)): StatefulMapStore<T, U> {
    let map = this.map;
    let deleted: Map<DocId, Doc<T, U>> = new Map();
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
      if (deleted.has(this.activeId)) this.activeBS.next(null);
      this.updateSelectors(deleted);
    }

    return this;
  }

  protected updateOne(id: DocId, update: Partial<T>, state?: Partial<U>): StatefulMapStore<T, U> {
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

    Object.assign(currDoc.doc, update);
    !!state && Object.assign(currDoc.state, state);
    currDoc.lastChange = new Date();

    this.dataBS.next(map);
    if (currDoc.id === this.activeId) this.activeBS.next(currDoc);
    this.updateSelectors(this.toMap([currDoc.doc]));
    return this;
  }

  protected updateMany(update: Partial<T>[], state: Partial<U>): StatefulMapStore<T, U> {
    let map = this.map;
    let updated = new Map<DocId, Doc<T, U>>();

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

      Object.assign(currDoc.doc, doc);
      !!state && Object.assign(currDoc.state, state);
      currDoc.lastChange = new Date();
      updated.set(currDoc[this.id], currDoc);
    }

    if (updated.size > 0) {
      this.dataBS.next(map);
      if (updated.has(this.activeId)) this.activeBS.next(map.get(this.activeId));
      this.updateSelectors(updated);
    }

    return this;
  }

  protected updateState(ids: DocId[], state: Partial<U>): StatefulMapStore<T, U> {
    let map = this.map;
    let changed = new Map<DocId, Doc<T, U>>();

    for (let id of ids) {
      let doc = map.get(id);
      if (!doc) continue;
      Object.assign(doc.state, state);
      changed.set(id, doc);
    }

    if (changed.size > 0) {
      this.dataBS.next(map);
      if (changed.has(this.activeId)) this.activeBS.next(map.get(this.activeId));
      this.updateSelectors(changed);
    }

    return this;
  }

  protected replaceOne(doc: T, id?: DocId) {
    let map = this.map;
    let activeId = this.activeId;
    let oldDoc = map.get(id || doc[this.id]);

    if (oldDoc) {
      map.delete(id);
      map.set(doc[this.id], new Doc(doc[this.id], doc, new this.StateFac()));

      for (let index in this.indexes) {
        this.indexes[index].delete(oldDoc[index]);
        this.indexes[index].set(doc[index], doc[this.id]);
      }

      this.dataBS.next(map);
      if (id === activeId) this.activeBS.next(null)
      else if (doc[this.id] === activeId) this.activeBS.next(map.get(activeId));
      this.updateSelectors(this.toMap([oldDoc.doc, doc]));
    }

    return this;
  }

  protected replaceAll(docs: T[]) {
    let activeId = this.activeId;
    let map = this.toMap(docs);

    let indexes = Object.keys(this.indexes) as (keyof T)[];
    this.indexes = {};
    for (let index of indexes) this.addIndex(index, docs);

    this.dataBS.next(map);
    if (map.has(activeId)) this.activeBS.next(map.get(activeId));
    this.updateSelectors(null, true);
    return this;
  }

  protected clear() {
    this.dataBS.next(new Map());
    this.activeBS.next(null);

    let indexes = Object.keys(this.indexes) as (keyof T)[];
    this.indexes = {};
    for (let index of indexes) this.addIndex(index, null);

    this.updateSelectors(null, true);
    this.completeSelectors();
    return this;
  }
}