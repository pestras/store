import { Unique } from 'tools-box/unique';
import { Observable, BehaviorSubject } from 'rxjs';
import { filter, map, finalize } from 'rxjs/operators';

interface Selector<T> {
  id: string;
  filter: (doc: T) => boolean,
  bs: BehaviorSubject<T>;
  o: Observable<T>;
}

interface MultiSelector<T> {
  id: string;
  filter: (doc: T) => boolean,
  bs: BehaviorSubject<T[]>;
  o: Observable<T[]>;
}

export class ListStore<T> {
  private listBS = new BehaviorSubject<T[]>(null);
  private selectors: Selector<T>[] = [];
  private multiSelectors: MultiSelector<T>[] = [];

  readonly select$ = this.listBS.pipe(filter(data => !!data));
  readonly count$ = this.select$.pipe(map(data => data.length));

  constructor(list?: T[]) {
    if (list) this.listBS.next(list);
  }

  get list() { return this.listBS.getValue(); }

  get count() { return this.list.length; }

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

  private updateSelectors(docs: T[], force = false) {
    for (let selector of this.selectors) {
      let effected = force || !!this._get(selector.filter, docs);
      if (effected) selector.bs.next(this.get(selector.filter));
    }

    for (let selector of this.multiSelectors) {
      let effected = force || this._getMany(selector.filter, docs).length > 0;
      if (effected) selector.bs.next(this.getMany(selector.filter));
    }
  }

  private _get(filter: (doc: T) => boolean, list: T[]) {
    return list.find(doc => filter(doc));
  }

  get(filter: (doc: T) => boolean) {
    return this._get(filter, this.list);
  }

  private _getByIndex(index: number, list: T[]) {
    return list[index];
  }

  getByIndex(index: number) {
    return this.list[index];
  }

  _getMany(filter: (doc: T) => boolean, list: T[]) {
    return list.filter(doc => filter(doc));
  }

  getMany(filter: (doc: T) => boolean) {
    return this._getMany(filter, this.list);
  }

  select(filter: (doc: T) => boolean) {
    let id = Unique.Get();
    let doc = this.get(filter);
    let bs = new BehaviorSubject<T>(doc);
    let o = bs.pipe(finalize(() => {
      bs.complete();
      this.removeSelector(id);
    }));

    this.selectors.push({ id, filter: filter, bs, o });
    return o;
  }

  selectMany(filter: (doc: T) => boolean): Observable<T[]> {
    let id = Unique.Get();
    let docs = this.getMany(filter);
    let bs = new BehaviorSubject<T[]>(docs);
    let o = bs.pipe(finalize(() => {
      bs.complete();
      this.removeMultiSelector(id)
    }));

    this.multiSelectors.push({ id, filter: filter, bs, o });
    return o;
  }

  protected insert(docs: T[]) {
    let list = this.list.concat(docs);
    this.listBS.next(list);
    this.updateSelectors(docs);
    return this;
  }

  protected removeOne(index: number): ListStore<T>;
  protected removeOne(filter: (doc: T) => boolean): ListStore<T>;
  protected removeOne(filter: number | ((doc: T) => boolean)) {
    let list = this.list;
    let removed: T;

    if (typeof filter === "number")
      removed = list.splice(filter, 1)[0];
    else
      for (let i = 0; i < list.length; i++)
        if (filter(list[i])) {
          removed = list.splice(i--, 1)[0];
          break;
        }

    if (!!removed) {
      this.listBS.next(list);
      this.updateSelectors([removed]);
    }

    return this;
  }

  protected remove(filter: (doc: T) => boolean) {
    let list = this.list;
    let removed: T[] = [];

    for (let i = 0; i < list.length; i++) {
      if (filter(list[i])) {
        removed.push(list[i]);
        list.splice(i--, 1);
      }
    }

    if (removed.length > 0) {
      this.listBS.next(list);
      this.updateSelectors(removed);
    }

    return this;
  }

  protected updateOne(index: number, update: Partial<T>): ListStore<T>;
  protected updateOne(filter: (doc: T) => boolean, update: Partial<T>): ListStore<T>;
  protected updateOne(filter: number | ((doc: T) => boolean), update: Partial<T>) {
    let list = this.list;
    let updated: T;

    if (typeof filter === "number") {
      let doc = list[filter];
      if (!!doc) {
        Object.assign(doc, update);
        updated = doc;
      }
    } else {
      for (let i = 0; i < list.length; i++) {
        if (filter(list[i])) {
          Object.assign(list[i], update);
          updated = list[i];
          break;
        }
      }
    }

    if (!!updated) {
      this.listBS.next(list);
      this.updateSelectors([updated]);
    }

    return this;
  }

  protected updateMany(filter: (doc: T) => boolean, update: Partial<T>) {
    let list = this.list;
    let updated: T[] = [];

    for (let i = 0; i < list.length; i++) {
      if (filter(list[i])) {
        Object.assign(list[i], update);
        updated.push(list[i])
      }
    }

    if (updated.length > 0) {
      this.listBS.next(list);
      this.updateSelectors(updated);
    }

    return this;
  }

  protected replaceOne(index: number, doc: T): ListStore<T>;
  protected replaceOne(filter: (doc: T) => boolean, doc: T): ListStore<T>;
  protected replaceOne(filter: number | ((doc: T) => boolean), doc: T) {
    let list = this.list;
    let replaced: T;

    if (typeof filter === "number") {
      if (list[filter]) {
        replaced = list[filter];
        list[filter] = doc;
      }
    } else {
      for (let i = 0; i < list.length; i++) {
        if (filter(list[i])) {
          replaced = list[i];
          list[i] = doc;
        }
      }
    }

    if (!!replaced) {
      this.listBS.next(list);
      this.updateSelectors([replaced, doc]);
    }

    return this;
  }

  protected replaceAll(docs: T[]) {
    this.listBS.next(docs);
    this.updateSelectors(null, true);
  }

  protected clear() {
    this.listBS.next([]);
    this.updateSelectors(null, true);
    this.completeSelectors();
    return this;
  }
}