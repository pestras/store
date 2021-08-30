// Copyright (c) 2021 Pestras
// 
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

import { BehaviorSubject, combineLatest, Observable } from "rxjs";
import { distinctUntilChanged, filter, map, shareReplay } from 'rxjs/operators';
import { ActiveDocumnet } from "./active-document";
import { distinctUntilObjChanged } from "./operators/distinctUntilObjChanged";

/**
 * Array store, manages the state of array of Objects providing crud
 * apis and change emitters
 */
export class ArrayStore<T = any> {

  // Private Members
  // ----------------------------------------------------------------------------------------------
  /** Idle state behavior subject */
  private _idleSub = new BehaviorSubject<boolean>(false);

  /** Active document change behavior subject */
  private _activeSub = new BehaviorSubject<number>(null);

  /** data behavior subject */
  private _dataSub = new BehaviorSubject<T[]>(null);

  /** Data emitter */
  private _docs$ = combineLatest([this._idleSub, this._dataSub])
    .pipe(filter(([idle]) => idle), map(([, data]) => data));

  /**
   * Get single document by index
   * @param index **number** : *document index*
   * @returns **T**
   */
  private _doc(index: number): T;
  /**
   * Get single document by filter
   * @param filter **(doc: T) => boolean** : *document filter*
   * @returns **T**
   */
  private _doc(filter: (doc: T) => boolean): T;
  private _doc(filter: number | ((doc: T) => boolean)) {
    let docs = this._dataSub.getValue();

    if (typeof filter === 'number')
      return docs[filter];

    for (let doc of docs)
      if (filter(doc))
        return doc;

    return null;
  }

  /** 
   * Get all documents
   * @returns **T[]**
   */
  private _docs(): T[];
  /**
  * Get documents by indexs
  * @param index **number** : *document index*
  * @returns **T**
  */
  private _docs(indexs: number[]): T[];
  /**
   * Get documents by filter
   * @param filter **(doc: T) => boolean** : *documents filter*
   * @returns **T[]**
   */
  private _docs(filter: (doc: T) => boolean): T[];
  private _docs(filter?: number[] | ((doc: T) => boolean)) {
    let result: T[] = [];
    let docs = this._dataSub.getValue();

    if (!filter)
      return docs;

    if (Array.isArray(filter))
      return filter.map(i => docs[i]);

    for (let doc of docs)
      if (filter(doc))
        result.push(doc);

    return result;
  }

  // Protected Members
  // ----------------------------------------------------------------------------------------------
  protected onChange?(data: T[], type: 'add' | 'update' | 'replace' | 'remove' | 'clear'): void;
  
  /**
   * Creates a clone of an input document
   * @param doc **T** : *input document data*
   * @returns **T**
   */
  protected map(doc: T): T {
    return !!doc ? Object.assign({}, doc) : null;
  };

  /** Idle state setter */
  protected set idle(val: boolean) {
    this._idleSub.next(val);
  }

  /**
  * Set new active document
  * @param index **number** : *document index*
  */
  protected setActive(index: number): void {
    this._activeSub.next(index);
  }

  /**
   * add new document, with the ability to replace old document by index
   * @param doc **T** : *new document*
   * @param index **number?** : *add document on specific index*
   * @param replace **number?** : *number of documents to replace starting from the index*
   * @returns **T**
   */
  protected add(doc: T, index?: number, replace = 0): T {
    let docs = this._dataSub.getValue();

    if (typeof index !== "number")
      docs.splice(index, replace, this.map(doc));
    else
      docs.push(this.map(doc));

    this.onChange && this.onChange([doc], 'add');
    this._dataSub.next(docs);

    return doc;
  }

  /**
   * add new documents, with the ability to replace old documents by index
   * @param docs **T[]** : *new documents*
   * @param index **number?** : *add documents on specific index*
   * @param replace **number?** : *number of documents to replace starting from the index*
   * @returns **T[]**
   */
  protected insertMany(docs: T[], index?: number, replace?: number): T[] {
    let currDocs = this._dataSub.getValue();

    if (typeof index !== "number")
      currDocs.splice(index, replace, ...docs.map(doc => this.map(doc)));
    else
      currDocs.push(...docs.map(doc => this.map(doc)));

    this.onChange && this.onChange(docs, 'add');
    this._dataSub.next(currDocs);

    return docs;
  }

  /**
   * Update document by index
   * @param index **number** : *Document index*
   * @param update **Partial\<T\>** : *update*
   * @returns  **T**
   */
  protected update(index: number, update: Partial<T>): T {
    let currDocs = this._dataSub.getValue();
    let doc = currDocs[index];

    if (!doc)
      return null;

    Object.assign(doc, update);

    this.onChange && this.onChange([doc], 'update');
    this._dataSub.next(currDocs);

    return doc;
  }

  /**
   * Update documents by list of indexes
   * @param indexes **number[]** : *documents indexes
   * @param update **Partial\<T\>** : *update*
   * @returns **T[]**
   */
  protected updateMany(indexes: number[], update: Partial<T>): T[];
  /**
   * Update documents by filter
   * @param filter **(doc: T) => boolean** : *document filter*
   * @param update **Partial\<T\>** : *update*
   * @returns **T[]**
   */
  protected updateMany(filter: (doc: T) => boolean, update: Partial<T>): T[]
  protected updateMany(filter: Partial<T> | number[] | ((doc: T) => boolean), update?: Partial<T>): T[] {
    let currDocs = this._dataSub.getValue();
    let docs = this._docs(<number[]>filter);

    if (docs.length === 0)
      return [];

    for (let doc of docs)
      Object.assign(doc, update);

    this.onChange && this.onChange(docs, 'update');
    this._dataSub.next(currDocs);
    return docs;
  }

  /**
   * Update all documents
   * @param update **Partial\<T\>** : *update*
   * @returns **T[]**
   */
  protected updateAll(update: Partial<T>): T[] {
    let currDocs = this._dataSub.getValue();

    if (currDocs.length === 0)
      return [];

    for (let doc of currDocs)
      Object.assign(doc, update);

    this.onChange && this.onChange(currDocs, 'update');
    this._dataSub.next(currDocs);
    return currDocs;
  }

  /**
   * Clear store then add the new documents.
   * @param docs **T[]** : *Array of new documents* 
   * @returns **T[]**
   */
  protected replaceAll(docs: T[]): T[] {
    this.onChange && this.onChange(docs, 'replace');
    this._dataSub.next(docs.map(doc => this.map(doc)));
    return docs;
  }

  /**
   * Delete document by index
   * @param index **number** : *Document index*
   * @returns **T**
   */
  protected removeOne(index: number): T {
    let docs = this._dataSub.getValue();

    if (!docs[index])
      return null;

    let removed = docs.splice(index, 1);

    this.onChange && this.onChange(removed, 'remove');
    this._dataSub.next(docs);
    return removed[0];
  }

  /**
   * Remove documents by indexes
   * @param indexs **number[]** : *documents indexes*
   * @returns **T[]**
   */
  protected removeMany(indexs: number[]): T[];
  /**
   * Remove documents by filter
   * @param filter **(doc: T) => boolean** : *documents filter*
   * @returns **T[]**
   */
  protected removeMany(filter: (doc: T) => boolean): T[];
  protected removeMany(filter: number[] | ((doc: T) => boolean)): T[] {
    let docs = this._dataSub.getValue();
    let deleted: T[] = [];
    let indexes: number[];

    if (typeof filter === 'function') {
      for (let [i, doc] of docs.entries())
        if (filter(doc))
          indexes.push(i);

    } else {
      indexes = filter;
    }

    if (indexes.length === 0)
      return [];

    indexes.sort((a, b) => a - b);

    for (let i = indexes.length - 1; i >= 0; i--)
      deleted.push(docs.splice(i, 1)[0]);

    this.onChange && this.onChange(deleted, 'remove');
    this._dataSub.next(docs);
    return deleted;
  }

  /** Clear all documents */
  protected clear(): void {
    this.onChange && this.onChange([], 'clear');
    this._dataSub.next([]);
  }

  // Public Members
  // ----------------------------------------------------------------------------------------------
  /** Idle state emitter */
  public readonly idle$ = this._idleSub
    .pipe(distinctUntilChanged(), shareReplay(1));

  /** Active document initializer */
  public readonly active = new ActiveDocumnet<T>(this.map, combineLatest([this._activeSub, this._dataSub])
    .pipe(map(([index]) => this.doc(index))));

  /** 
   * Idle state getter
   * @returns **boolean**
    */
  public get isIdle() {
    return this._idleSub.getValue();
  }

  /** 
   * Current documents count getter
   * @returns **number**
   */
  public get length() {
    return this._dataSub.getValue().length;
  }

  /** Documents count change observable */
  public readonly count$ = this._dataSub
    .pipe(map(data => data?.length || 0), distinctUntilChanged(), shareReplay(1));

  /**
   * Get single document by index
   * @param index **number** : *document index*
   * @returns **T**
   */
  public doc(index: number): T;
  /**
   * Get single document by filter
   * @param filter **(doc: T) => boolean** : *document filter*
   * @returns **T**
   */
  public doc(filter: (doc: T) => boolean): T;
  public doc(filter: number | ((doc: T) => boolean)) {
    return this._doc(<any>filter);
  }

  /**
   * Check single document exists by index
   * @param index **number** : *document index*
   * @returns **boolean**
   */
  public has(index: number): boolean;
  /**
   * Check single document exists by filter
   * @param filter **(doc: T) => boolean** : *document filter*
   * @returns **boolean**
   */
  public has(filter: (doc: T) => boolean): boolean;
  public has(filter: number | ((doc: T) => boolean)) {
    return this._doc(<any>filter) !== undefined;
  }

  /** Get all documents */
  public docs(): T[];
  /**
   * Get documents by indexes
   * @param indexes **number[]** : *Array of documents indexes*
   * @returns **T[]**
   */
  public docs(indexes: number[]): T[];
  /**
   * get documents by filter
   * @param filter **(doc: T) => boolean** : *documents filter*
   * @returns **T[]**
   */
  public docs(filter: (doc: T) => boolean): T[];
  public docs(filter?: number[] | ((doc: T) => boolean)) {
    return this._docs(<any>filter);
  }

  /**
   * Subscribe to a single document change by index
   * @param index **number** :  *document index*
   * @param keys **(keyof T)[]?** : *specific fields to watch*
   * @returns **Observable\<T\>**
   */
  public doc$(index: number, keys?: (keyof T)[]): Observable<T>;
  /**
   * Subscribe to a single document change by filter
   * @param filter **(doc: T) => boolean** : *document filter*
   * @param keys **(keyof T)[]?** *specific fields to watch*
   * @returns **Observable\<T\>**
   */
  public doc$(filter: (doc: T) => boolean, keys?: (keyof T)[]): Observable<T>;
  public doc$(filter: number | ((doc: T) => boolean), keys?: (keyof T)[]) {
    return this._docs$
      .pipe(map(() => this._doc(<any>filter)), distinctUntilObjChanged(<string[]>keys), shareReplay(1));
  }

  /**
   * Subscribe to a single document existance by index
   * @param index **number** : *document index*
   * @returns **Observable\<boolean\>**
   */
  public has$(index: number): Observable<boolean>;
  /**
   * Subscribe to a single document existance by filter
   * @param filter **(doc: T) => boolean** : *document filter*
   * @returns **Observable\<boolean\>**
   */
  public has$(filter: (doc: T) => boolean): Observable<boolean>;
  public has$(filter: number | ((doc: T) => boolean)) {
    return this._docs$.pipe(
      map(() => this._doc(<any>filter)),
      distinctUntilObjChanged(),
      map(Boolean),
      shareReplay(1)
    );
  }

  /**
   * Subscribe to multiple documents change by indexes
   * @param indexes **number[]** : *array of documents indexes*
   * @returns **Observable\<T[]\>**
   */
  public docs$(indexes: number[]): Observable<T[]>;
  /**
   * Subscribe to multiple documents change y filter
   * @param filter **(doc: T) => boolean** : *documents filter*
   * @returns **Observable\<T[]\>**
   */
  public docs$(filter: (doc: T) => boolean): Observable<T[]>;
  public docs$(filter?: number[] | ((doc: T) => boolean)) {
    return this._docs$.pipe(map(() => this._docs(<any>filter)), shareReplay(1));
  }
}