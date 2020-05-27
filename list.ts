import { Observable, BehaviorSubject } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { distinctUntilArrChanged } from './operators/distinctUntilArrChanged';
import { distinctUntilObjChanged } from './operators/distinctUntilObjChanged';

export class List<T> {
  private listBS = new BehaviorSubject<T[]>(null);

  readonly docs$ = this.listBS.pipe(filter(data => !!data));
  readonly count$ = this.docs$.pipe(map(data => data.length));

  constructor(list?: T[]) {
    if (list) this.listBS.next(list);
  }

  get docs() { return this.listBS.getValue(); }
  get count() { return this.docs.length; }

  private _get(filter: (doc: T) => boolean, list: T[]) {
    return list.find(doc => filter(doc));
  }

  get(filter: (doc: T) => boolean) {
    return this._get(filter, this.docs);
  }

  getByIndex(index: number) {
    return this.docs[index];
  }

  _getMany(filter: (doc: T) => boolean, list: T[]) {
    return list.filter(doc => filter(doc));
  }

  getMany(filter: (doc: T) => boolean) {
    return this._getMany(filter, this.docs);
  }

  select(filter: (doc: T) => boolean, keys?: (keyof T)[]) {
    return this.docs$.pipe(
      map(docs => docs.filter(doc => filter(doc)[0]),
      distinctUntilObjChanged<T>(<string[]>keys)
    ));
  }

  selectMany(filter: (doc: T) => boolean): Observable<T[]> {
    return this.docs$.pipe(
      map(docs => docs.filter(doc => filter(doc)),
      distinctUntilArrChanged<T>()
    ));
  }

  protected insert(docs: T[]) {
    let list = this.docs.concat(docs);
    this.listBS.next(list);
    return this;
  }

  protected removeOne(index: number): List<T>;
  protected removeOne(filter: (doc: T) => boolean): List<T>;
  protected removeOne(filter: number | ((doc: T) => boolean)) {
    let list = this.docs;
    let removed: T;

    if (typeof filter === "number")
      removed = list.splice(filter, 1)[0];
    else
      for (let i = 0; i < list.length; i++)
        if (filter(list[i])) {
          removed = list.splice(i--, 1)[0];
          break;
        }

    if (!!removed) this.listBS.next(list);

    return this;
  }

  protected remove(filter: (doc: T) => boolean) {
    let list = this.docs;
    let removed: T[] = [];

    for (let i = 0; i < list.length; i++) {
      if (filter(list[i])) {
        removed.push(list[i]);
        list.splice(i--, 1);
      }
    }

    if (removed.length > 0) this.listBS.next(list);

    return this;
  }

  protected updateOne(index: number, update: Partial<T>): List<T>;
  protected updateOne(filter: (doc: T) => boolean, update: Partial<T>): List<T>;
  protected updateOne(filter: number | ((doc: T) => boolean), update: Partial<T>) {
    let list = this.docs;
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

    if (!!updated) this.listBS.next(list);

    return this;
  }

  protected updateMany(filter: (doc: T) => boolean, update: Partial<T>) {
    let list = this.docs;
    let updated: T[] = [];

    for (let i = 0; i < list.length; i++) {
      if (filter(list[i])) {
        Object.assign(list[i], update);
        updated.push(list[i])
      }
    }

    if (updated.length > 0) this.listBS.next(list);

    return this;
  }

  protected replaceOne(index: number, doc: T): List<T>;
  protected replaceOne(filter: (doc: T) => boolean, doc: T): List<T>;
  protected replaceOne(filter: number | ((doc: T) => boolean), doc: T) {
    let list = this.docs;
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

    if (!!replaced) this.listBS.next(list);

    return this;
  }

  protected replaceAll(docs: T[]) {
    this.listBS.next(docs);
  }

  protected clear() {
    this.listBS.next([]);
    return this;
  }
}